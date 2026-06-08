const axios = require("axios");
const User = require("../models/userModel");
const getDeviceToken = require("../services/yeastarTokenService").getDeviceToken;
const moment = require("moment");

/**
 * Get login signature for Yeastar Linkus SDK
 * This signature is required for WebRTC authentication
 */

async function getYeastarLoginSignature(req, res) {
  const tag = `[getSignature ${Date.now()}]`;
  try {
    const userId = req.user._id;
    const { extensionNumber: requestedExtension } = req.body || {};

    const user = await User.findById(userId).select(
      "firstname lastname email extensionStatus PBXDetails assignedExtensions createdByWhichCompanyAdmin"
    );

    const hasPrimaryExt    = !!user?.PBXDetails?.PBX_EXTENSION_NUMBER;
    const enabledAssigned  = (user?.assignedExtensions || []).filter((e) => e.enabled !== false);
    const hasAssignedExts  = enabledAssigned.length > 0;

    if (!user || (!hasPrimaryExt && !hasAssignedExts)) {
      return res.status(400).json({ status: "error", message: "User/Extension not configured" });
    }

    if (user.extensionStatus !== true && !hasAssignedExts) {
      return res.status(400).json({ status: "error", message: "Your extension is disabled!" });
    }

    // Determine which extension + PBX config to use.
    let extensionNumber = user.PBXDetails?.PBX_EXTENSION_NUMBER;
    let pbxBaseUrl      = user.PBXDetails?.PBX_BASE_URL;
    let deviceId        = user.PBXDetails?.assignedDeviceId;

    // Fallback: if no primary PBXDetails extension, use first assignedExtensions entry.
    // This covers agents whose extension was assigned by a company admin (not directly by superadmin).
    if (!extensionNumber && hasAssignedExts) {
      const first = enabledAssigned[0];
      extensionNumber = first.extensionNumber;
      if (first.PBX_BASE_URL)     pbxBaseUrl = first.PBX_BASE_URL;
      if (first.assignedDeviceId) deviceId   = first.assignedDeviceId;
    }

    if (requestedExtension && requestedExtension !== extensionNumber) {
      const assigned = enabledAssigned.find(
        (e) => e.extensionNumber === String(requestedExtension)
      );
      if (assigned) {
        extensionNumber = assigned.extensionNumber;
        if (assigned.PBX_BASE_URL)     pbxBaseUrl = assigned.PBX_BASE_URL;
        if (assigned.assignedDeviceId) deviceId   = assigned.assignedDeviceId;
      }
    }

    // Always derive pbxBaseUrl from device record — it's the authoritative source.
    // PBXDetails.PBX_BASE_URL can be stale/wrong if device was moved or re-assigned.
    if (deviceId) {
      const superAdmins = await User.find({ role: "superadmin" }).select("PBXDevices");
      for (const admin of superAdmins) {
        const dev = (admin.PBXDevices || []).find(
          (d) => d.deviceId && d.deviceId.toString() === deviceId.toString()
        );
        if (dev?.PBX_BASE_URL) {
          pbxBaseUrl = dev.PBX_BASE_URL;
          break;
        }
      }
    }

    // If the target extension is on a different PBX URL but has no explicit deviceId,
    // we cannot safely guess which device credentials to use — require explicit assignment.
    const normUrl = (u) => (u || "").replace(/\/+$/, "").toLowerCase();
    if (
      pbxBaseUrl &&
      user.PBXDetails.PBX_BASE_URL &&
      normUrl(pbxBaseUrl) !== normUrl(user.PBXDetails.PBX_BASE_URL) &&
      !deviceId
    ) {
      return res.status(400).json({
        status: "error",
        message: `Extension ${extensionNumber} is on a different PBX but has no device assigned. Ask your administrator to assign a device to this extension in company settings.`,
      });
    }

    if (!deviceId && pbxBaseUrl) {
      // Fallback 1: URL-match from superadmin PBXDevices (fast, no extra PBX call)
      const superAdmins = await User.find({ role: "superadmin" }).select("PBXDevices").lean();
      for (const sa of superAdmins) {
        const match = (sa.PBXDevices || []).find(
          (d) => d.PBX_BASE_URL && normUrl(d.PBX_BASE_URL) === normUrl(pbxBaseUrl)
        );
        if (match) {
          deviceId = match.deviceId;
          break;
        }
      }
    }

    if (!deviceId) {
      // Fallback 3: try every registered PBX device — use the first one that can actually
      // sign for this extension. Return immediately with the working signature to avoid
      // a second sign call (which can fail with 10004 on some PBX setups).
      const superAdmins = await User.find({ role: "superadmin" }).select("PBXDevices").lean();
      for (const sa of superAdmins) {
        for (const dev of (sa.PBXDevices || [])) {
          if (!dev.PBX_BASE_URL || !dev.deviceId) continue;
          try {
            const testToken = await getDeviceToken(dev.deviceId.toString(), "sdk");
            const testRes   = await axios.post(
              `${dev.PBX_BASE_URL}/sign/create?access_token=${testToken}`,
              { username: extensionNumber, sign_type: "sdk", expire_time: 0 }
            );
            if (testRes.data.errcode === 0) {
              const signature = testRes.data.data?.sign;
              const pbxURL    = dev.PBX_BASE_URL.replace(/\/openapi\/v[0-9.]+$/i, "");
              return res.status(200).json({
                status: "success",
                data: {
                  username: extensionNumber,
                  secret: signature,
                  pbxURL,
                  userInfo: {
                    firstname: user.firstname,
                    lastname:  user.lastname,
                    email:     user.email,
                    extensionNumber,
                  },
                },
              });
            }
          } catch (devErr) {
            // device unavailable — try next
          }
        }
      }
    }

    if (!deviceId) {
      return res.status(400).json({
        status: "error",
        message: "No PBX device assigned. Please contact your administrator.",
      });
    }

    let accessToken;
    try {
      accessToken = await getDeviceToken(deviceId, "sdk");
    } catch (tokenErr) {
      throw tokenErr;
    }

    const signatureUrl = `${pbxBaseUrl}/sign/create?access_token=${accessToken}`;

    let signResponse;
    try {
      signResponse = await axios.post(signatureUrl, {
        username: extensionNumber,
        sign_type: "sdk",
        expire_time: 0,
      });

      if (signResponse.data.errcode === 10004) {
        const YeastarSDKToken = require("../models/YeastarSDKToken");
        // Expire the access_token but KEEP refresh_token so getDeviceToken uses refresh path (not full login)
        await YeastarSDKToken.updateOne(
          { deviceId },
          { $set: { access_token: null, expires_at: new Date(0) } }
        );

        accessToken = await getDeviceToken(deviceId, "sdk");

        const retryUrl = `${pbxBaseUrl}/sign/create?access_token=${accessToken}`;
        signResponse = await axios.post(retryUrl, {
          username: extensionNumber,
          sign_type: "sdk",
          expire_time: 0,
        });
      }
    } catch (apiErr) {
      throw apiErr;
    }

    const signData = signResponse.data;
    if (signData.errcode !== 0) {
      // Primary device failed even after token refresh — try every registered PBX device
      const superAdmins2 = await User.find({ role: "superadmin" }).select("PBXDevices").lean();
      for (const sa of superAdmins2) {
        for (const dev of (sa.PBXDevices || [])) {
          if (!dev.PBX_BASE_URL || !dev.deviceId) continue;
          if (dev.deviceId.toString() === (deviceId || "").toString()) continue; // already tried
          try {
            const testToken = await getDeviceToken(dev.deviceId.toString(), "sdk");
            const testRes = await axios.post(
              `${dev.PBX_BASE_URL}/sign/create?access_token=${testToken}`,
              { username: extensionNumber, sign_type: "sdk", expire_time: 0 }
            );
            if (testRes.data.errcode === 0) {
              const signature = testRes.data.data?.sign;
              const pbxURL2 = dev.PBX_BASE_URL.replace(/\/openapi\/v[0-9.]+$/i, "");
              return res.status(200).json({
                status: "success",
                data: {
                  username: extensionNumber,
                  secret: signature,
                  pbxURL: pbxURL2,
                  userInfo: {
                    firstname: user.firstname,
                    lastname: user.lastname,
                    email: user.email,
                    extensionNumber,
                  },
                },
              });
            }
          } catch (devErr) {
            // device unavailable — try next
          }
        }
      }
      throw new Error(signData.errmsg || "Failed to create login signature");
    }

    const signature = signData.data?.sign;
    const pbxURL = (pbxBaseUrl || "").replace(/\/openapi\/v[0-9.]+$/i, "");

    return res.status(200).json({
      status: "success",
      data: {
        username: extensionNumber,
        secret: signature,
        pbxURL: pbxURL,
        userInfo: {
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          extensionNumber: extensionNumber,
        },
      },
    });

  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
}

module.exports = { getYeastarLoginSignature };
