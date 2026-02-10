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
    const userId = req.user._id; // From authentication middleware

    // Fetch user from database
    const user = await User.findById(userId).select(
      "firstname lastname email extensionStatus PBXDetails"
    );

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    if (!user.PBXDetails.PBX_EXTENSION_NUMBER) {
      return res.status(400).json({
        status: "error",
        message:
          "Extension not configured for this user. Please contact support.",
      });
    }

    if (user.extensionStatus === false) {
      return res.status(400).json({
        status: "error",
        message: "Not Activated Calling Facility.",
      });
    }

    console.log(user);

    const deviceId = user.PBXDetails.assignedDeviceId;

    // Get valid access token
    const accessToken = await getDeviceToken(deviceId, "sdk");

    console.log(accessToken);

    console.log(
      "🔑 Requesting login signature for extension:",
      user.PBXDetails.PBX_EXTENSION_NUMBER
    );
    console.log("🔑 User email:", user.email);
    console.log("🔑 Access token:", accessToken);

    // Request login signature from Yeastar for this user
    // API endpoint: POST /openapi/v1.0/sign/create?access_token={token}
    // Note: username can be either email or extension number depending on PBX config
    const signatureUrl = `${user.PBXDetails.PBX_BASE_URL}/sign/create?access_token=${accessToken}`;
    console.log("🔑 Signature URL:", signatureUrl);

    const signResponse = await axios.post(signatureUrl, {
      username: user.PBXDetails.PBX_EXTENSION_NUMBER,
      // username: "1010",
      sign_type: "sdk",
      expire_time: 0, // No expiration
    });

    console.log(
      "📋 Signature response:",
      JSON.stringify(signResponse.data, null, 2)
    );

    const signData = signResponse.data;

    if (signData.errcode !== 0) {
      console.error("❌ Signature creation failed:", signData);
      throw new Error(signData.errmsg || "Failed to create login signature");
    }

    const signature = signData.data?.sign;

    console.log(signature);

    if (!signature) {
      throw new Error("No signature returned from Yeastar");
    }

    // Extract base URL from YEASTAR_BASE_URL
    // e.g., https://cmedia.ras.yeastar.com/openapi/v1.0 -> https://cmedia.ras.yeastar.com
    const baseUrl = user.PBXDetails.PBX_BASE_URL || "";
    const pbxURL = baseUrl.replace(/\/openapi\/v[0-9.]+$/i, "");

    console.log(
      "✅ Generated Yeastar login signature for:",
      user.email,
      "Extension:",
      user.PBXDetails.PBX_EXTENSION_NUMBER,
      "PBX URL:",
      pbxURL
    );

    return res.status(200).json({
      status: "success",
      data: {
        username: user.PBXDetails.PBX_EXTENSION_NUMBER, // Extension number is used for SDK login
        // username: "1010",
        secret: signature, // Login signature from Yeastar API
        pbxURL: pbxURL, // PBX URL without /openapi/v1.0
        userInfo: {
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          extensionNumber: user.PBXDetails.PBX_EXTENSION_NUMBER,
        },
      },
    });
  } catch (err) {
    console.error("❌ Error generating Yeastar login signature:");
    console.error("  - Error message:", err.message);
    console.error("  - Response status:", err.response?.status);
    console.error(
      "  - Response data:",
      JSON.stringify(err.response?.data, null, 2)
    );

    return res.status(500).json({
      status: "error",
      message: "Failed to generate login signature",
      error: err.message,
      details: err.response?.data,
    });
  }
}

module.exports = { getYeastarLoginSignature };
