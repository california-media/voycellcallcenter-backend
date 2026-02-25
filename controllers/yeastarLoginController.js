const axios = require("axios");
const User = require("../models/userModel");
const getDeviceToken = require("../services/yeastarTokenService").getDeviceToken;
const moment = require("moment");

/**
 * Get login signature for Yeastar Linkus SDK
 * This signature is required for WebRTC authentication
 */

async function getYeastarLoginSignature(req, res) {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("firstname lastname email extensionStatus PBXDetails");

    if (!user || !user.PBXDetails.PBX_EXTENSION_NUMBER) {
      return res.status(400).json({ status: "error", message: "User/Extension not configured" });
    }

    const deviceId = user.PBXDetails.assignedDeviceId;

    // 1️⃣ Initial attempt to get token (from DB or fresh)
    let accessToken = await getDeviceToken(deviceId, "sdk");

    let signResponse;
    const signatureUrl = `${user.PBXDetails.PBX_BASE_URL}/sign/create?access_token=${accessToken}`;

    try {
      signResponse = await axios.post(signatureUrl, {
        username: user.PBXDetails.PBX_EXTENSION_NUMBER,
        sign_type: "sdk",
        expire_time: 0,
      });

      // 2️⃣ CHECK FOR EXPIRED ERROR FROM YEASTAR
      if (signResponse.data.errcode === 10004) {
        // Delete the bad token from DB so getDeviceToken is forced to login fresh
        const YeastarSDKToken = require("../models/YeastarSDKToken");
        await YeastarSDKToken.deleteOne({ deviceId });

        // Get a brand new token
        accessToken = await getDeviceToken(deviceId, "sdk");

        // Retry the signature request
        const retryUrl = `${user.PBXDetails.PBX_BASE_URL}/sign/create?access_token=${accessToken}`;
        signResponse = await axios.post(retryUrl, {
          username: user.PBXDetails.PBX_EXTENSION_NUMBER,
          sign_type: "sdk",
          expire_time: 0,
        });
      }
    } catch (apiErr) {
      throw apiErr;
    }

    const signData = signResponse.data;
    if (signData.errcode !== 0) {
      throw new Error(signData.errmsg || "Failed to create login signature");
    }

    // ... rest of your formatting logic (pbxURL, etc.)
    const signature = signData.data?.sign;
    const pbxURL = (user.PBXDetails.PBX_BASE_URL || "").replace(/\/openapi\/v[0-9.]+$/i, "");

    return res.status(200).json({
      status: "success",
      data: {
        username: user.PBXDetails.PBX_EXTENSION_NUMBER,
        secret: signature,
        pbxURL: pbxURL,
        userInfo: {
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          extensionNumber: user.PBXDetails.PBX_EXTENSION_NUMBER,
        },
      },
    });

  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
}

module.exports = { getYeastarLoginSignature };
