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

    console.log(`${tag} userId=${userId} requestedExt=${requestedExtension || "(primary)"}`);

    const user = await User.findById(userId).select(
      "firstname lastname email extensionStatus PBXDetails assignedExtensions createdByWhichCompanyAdmin"
    );

    const hasPrimaryExt    = !!user?.PBXDetails?.PBX_EXTENSION_NUMBER;
    const hasAssignedExts  = !!(user?.assignedExtensions?.length);

    if (!user || (!hasPrimaryExt && !hasAssignedExts)) {
      console.log(`${tag} ❌ User or PBX extension not configured`);
      return res.status(400).json({ status: "error", message: "User/Extension not configured" });
    }

    console.log(`${tag} primaryExt=${user.PBXDetails?.PBX_EXTENSION_NUMBER} primaryUrl=${user.PBXDetails?.PBX_BASE_URL} primaryDevice=${user.PBXDetails?.assignedDeviceId}`);
    console.log(`${tag} assignedExtensions=${JSON.stringify(user.assignedExtensions || [])}`);

    if (user.extensionStatus !== true && !hasAssignedExts) {
      console.log(`${tag} ❌ Extension is disabled`);
      return res.status(400).json({ status: "error", message: "Your extension is disabled!" });
    }

    // Determine which extension + PBX config to use.
    let extensionNumber = user.PBXDetails?.PBX_EXTENSION_NUMBER;
    let pbxBaseUrl      = user.PBXDetails?.PBX_BASE_URL;
    let deviceId        = user.PBXDetails?.assignedDeviceId;

    // Fallback: if no primary PBXDetails extension, use first assignedExtensions entry.
    // This covers agents whose extension was assigned by a company admin (not directly by superadmin).
    if (!extensionNumber && hasAssignedExts) {
      const first = user.assignedExtensions[0];
      extensionNumber = first.extensionNumber;
      if (first.PBX_BASE_URL)     pbxBaseUrl = first.PBX_BASE_URL;
      if (first.assignedDeviceId) deviceId   = first.assignedDeviceId;
      console.log(`${tag} ℹ️ Using assignedExtensions[0] as primary: ext=${extensionNumber} deviceId=${deviceId}`);
    }

    if (requestedExtension && requestedExtension !== extensionNumber) {
      const assigned = (user.assignedExtensions || []).find(
        (e) => e.extensionNumber === String(requestedExtension)
      );
      console.log(`${tag} Lookup assigned ext "${requestedExtension}":`, assigned || "NOT FOUND in assignedExtensions");
      if (assigned) {
        extensionNumber = assigned.extensionNumber;
        if (assigned.PBX_BASE_URL)     pbxBaseUrl = assigned.PBX_BASE_URL;
        if (assigned.assignedDeviceId) deviceId   = assigned.assignedDeviceId;
      } else {
        console.log(`${tag} ⚠️  Extension "${requestedExtension}" not found in assignedExtensions — using primary config`);
      }
    }

    // Derive pbxBaseUrl from device record when: different device than primary, OR pbxBaseUrl is null.
    const primaryDeviceId = (user.PBXDetails?.assignedDeviceId || "").toString();
    if (deviceId && (!pbxBaseUrl || deviceId.toString() !== primaryDeviceId)) {
      const superAdmins = await User.find({ role: "superadmin" }).select("PBXDevices");
      for (const admin of superAdmins) {
        const dev = (admin.PBXDevices || []).find(
          (d) => d.deviceId.toString() === deviceId.toString()
        );
        if (dev?.PBX_BASE_URL) {
          pbxBaseUrl = dev.PBX_BASE_URL;
          console.log(`${tag} ℹ️ Derived pbxBaseUrl from device record: ${pbxBaseUrl}`);
          break;
        }
      }
    }

    console.log(`${tag} Resolved → ext=${extensionNumber} url=${pbxBaseUrl} deviceId=${deviceId}`);

    // If the target extension is on a different PBX URL but has no explicit deviceId,
    // we cannot safely guess which device credentials to use — require explicit assignment.
    const normUrl = (u) => (u || "").replace(/\/+$/, "").toLowerCase();
    if (
      pbxBaseUrl &&
      user.PBXDetails.PBX_BASE_URL &&
      normUrl(pbxBaseUrl) !== normUrl(user.PBXDetails.PBX_BASE_URL) &&
      !deviceId
    ) {
      console.log(`${tag} ❌ Different PBX URL but no deviceId assigned`);
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
          console.log(`${tag} ℹ️ Recovered deviceId via URL match: ${deviceId}`);
          break;
        }
      }
    }

    if (!deviceId) {
      // Fallback 3: try every registered PBX device — use the first one that can actually
      // sign for this extension. Return immediately with the working signature to avoid
      // a second sign call (which can fail with 10004 on some PBX setups).
      console.log(`${tag} ℹ️ Trying all superadmin devices to find one that signs ext ${extensionNumber}`);
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
              console.log(`${tag} ✅ Device discovered + signature obtained for ext ${extensionNumber} via device ${dev.deviceId}`);
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
            console.log(`${tag} device ${dev.deviceId} rejected ext ${extensionNumber}: errcode=${testRes.data.errcode}`);
          } catch (devErr) {
            console.log(`${tag} device ${dev.deviceId} error: ${devErr.message}`);
          }
        }
      }
    }

    if (!deviceId) {
      console.log(`${tag} ❌ deviceId is null — no device found for ext ${extensionNumber}`);
      return res.status(400).json({
        status: "error",
        message: "No PBX device assigned. Please contact your administrator.",
      });
    }

    console.log(`${tag} Fetching SDK token for deviceId=${deviceId} ...`);
    let accessToken;
    try {
      accessToken = await getDeviceToken(deviceId, "sdk");
      console.log(`${tag} Got access token: ${accessToken ? accessToken.slice(0, 12) + "..." : "null"}`);
    } catch (tokenErr) {
      console.error(`${tag} ❌ getDeviceToken failed:`, tokenErr.message);
      throw tokenErr;
    }

    const signatureUrl = `${pbxBaseUrl}/sign/create?access_token=${accessToken}`;
    console.log(`${tag} Calling PBX sign URL: ${pbxBaseUrl}/sign/create (token hidden)`);

    let signResponse;
    try {
      signResponse = await axios.post(signatureUrl, {
        username: extensionNumber,
        sign_type: "sdk",
        expire_time: 0,
      });
      console.log(`${tag} PBX sign response errcode=${signResponse.data?.errcode} errmsg=${signResponse.data?.errmsg}`);

      if (signResponse.data.errcode === 10004) {
        console.log(`${tag} Token expired (10004), refreshing...`);
        const YeastarSDKToken = require("../models/YeastarSDKToken");
        await YeastarSDKToken.deleteOne({ deviceId });

        accessToken = await getDeviceToken(deviceId, "sdk");
        console.log(`${tag} Retrying with new token...`);

        const retryUrl = `${pbxBaseUrl}/sign/create?access_token=${accessToken}`;
        signResponse = await axios.post(retryUrl, {
          username: extensionNumber,
          sign_type: "sdk",
          expire_time: 0,
        });
        console.log(`${tag} Retry sign response errcode=${signResponse.data?.errcode}`);
      }
    } catch (apiErr) {
      console.error(`${tag} ❌ PBX sign API call failed:`, apiErr.message, "status:", apiErr.response?.status, "data:", JSON.stringify(apiErr.response?.data || {}));
      throw apiErr;
    }

    const signData = signResponse.data;
    if (signData.errcode !== 0) {
      console.error(`${tag} ❌ PBX returned error: errcode=${signData.errcode} errmsg=${signData.errmsg}`);
      throw new Error(signData.errmsg || "Failed to create login signature");
    }

    const signature = signData.data?.sign;
    const pbxURL = (pbxBaseUrl || "").replace(/\/openapi\/v[0-9.]+$/i, "");

    console.log(`${tag} ✅ Signature obtained. pbxURL=${pbxURL} ext=${extensionNumber}`);

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
    console.error(`${tag} ❌ Unhandled error:`, err.message, err.stack?.split("\n")[1]);
    return res.status(500).json({ status: "error", message: err.message });
  }
}

module.exports = { getYeastarLoginSignature };
