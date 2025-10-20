const axios = require("axios");
const User = require("../models/userModel");

const YEASTAR_BASE_URL = process.env.YEASTAR_BASE_URL?.trim();
const YEASTAR_SDK_ACCESS_ID = process.env.YEASTAR_SDK_ACCESS_ID?.trim();
const YEASTAR_SDK_ACCESS_KEY = process.env.YEASTAR_SDK_ACCESS_KEY?.trim();

/**
 * Get valid access token for Linkus SDK API calls
 */
async function getValidToken() {
  // Request new token using SDK AccessID and AccessKey
  console.log("🔐 Requesting new Linkus SDK access token...");
  try {
    const response = await axios.post(`${YEASTAR_BASE_URL}/get_token`, {
      username: YEASTAR_SDK_ACCESS_ID,
      password: YEASTAR_SDK_ACCESS_KEY,
    });

    const data = response.data;

    if (data.errcode !== 0) {
      throw new Error(data.errmsg || "Failed to get access token");
    }

    const access_token = data.access_token;
    const refresh_token = data.refresh_token;
    const expires_in = data.access_token_expire_time || 1800;

    console.log("✅ Linkus SDK access token obtained");
    return access_token;
  } catch (err) {
    console.error("❌ Failed to get access token:", err.message);
    throw new Error("Failed to get access token");
  }
}

/**
 * Get login signature for Yeastar Linkus SDK
 * This signature is required for WebRTC authentication
 */
async function getYeastarLoginSignature(req, res) {
  try {
    const userId = req.user._id; // From authentication middleware

    // Fetch user from database
    const user = await User.findById(userId).select(
      "extensionNumber sipSecret firstname lastname email"
    );

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    if (!user.extensionNumber || !user.sipSecret) {
      return res.status(400).json({
        status: "error",
        message:
          "Extension not configured for this user. Please contact support.",
      });
    }

    // Get valid access token
    const accessToken = await getValidToken();

    console.log(
      "🔑 Requesting login signature for extension:",
      user.extensionNumber
    );
    console.log("🔑 User email:", user.email);
    console.log("🔑 Access token:", accessToken.substring(0, 20) + "...");

    // Request login signature from Yeastar for this user
    // API endpoint: POST /openapi/v1.0/sign/create?access_token={token}
    // Note: username can be either email or extension number depending on PBX config
    const signatureUrl = `${YEASTAR_BASE_URL}/sign/create?access_token=${accessToken}`;
    console.log("🔑 Signature URL:", signatureUrl);

    const signResponse = await axios.post(signatureUrl, {
      username: user.extensionNumber, // Try extension number instead of email
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

    if (!signature) {
      throw new Error("No signature returned from Yeastar");
    }

    // Extract base URL from YEASTAR_BASE_URL
    // e.g., https://cmedia.ras.yeastar.com/openapi/v1.0 -> https://cmedia.ras.yeastar.com
    const baseUrl = YEASTAR_BASE_URL || "";
    const pbxURL = baseUrl.replace(/\/openapi\/v[0-9.]+$/i, "");

    console.log(
      "✅ Generated Yeastar login signature for:",
      user.email,
      "Extension:",
      user.extensionNumber,
      "PBX URL:",
      pbxURL
    );

    return res.status(200).json({
      status: "success",
      data: {
        username: user.extensionNumber, // Extension number is used for SDK login
        secret: signature, // Login signature from Yeastar API
        pbxURL: pbxURL, // PBX URL without /openapi/v1.0
        userInfo: {
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          extensionNumber: user.extensionNumber,
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
