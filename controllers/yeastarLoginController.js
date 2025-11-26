const axios = require("axios");
const User = require("../models/userModel");
const yeastarSDKToken = require("../models/YeastarSDKToken");
const moment = require("moment");

// const { getValidToken } = require("../utils/yeastarClient");

const YEASTAR_BASE_URL = process.env.YEASTAR_BASE_URL?.trim();
const YEASTAR_SDK_ACCESS_ID = process.env.YEASTAR_SDK_ACCESS_ID?.trim();
const YEASTAR_SDK_ACCESS_KEY = process.env.YEASTAR_SDK_ACCESS_KEY?.trim();

/**
 * Get valid access token for Linkus SDK API calls
 */

async function loginToYeastar() {
  const url = `${YEASTAR_BASE_URL}/get_token`;
  console.log("🔑 Logging into Yeastar:", url);

  try {
    const res = await axios.post(url, {
      username: YEASTAR_SDK_ACCESS_ID,
      password: YEASTAR_SDK_ACCESS_KEY,
    });
    const data = res.data;

    if (data.access_token && data.refresh_token) {
      console.log("✅ Yeastar login success. Token received.");

      // Store new token in DB
      await yeastarSDKToken.deleteMany({});
      const expiry = moment()
        .add(data.expires_in || 1800, "seconds")
        .toDate();

      await yeastarSDKToken.create({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: expiry,
      });

      return data.access_token;
    }

    console.error("❌ Unexpected Yeastar login response:", data);
    throw new Error(data.errmsg || "Yeastar login failed");
  } catch (err) {
    console.error("❌ Yeastar login error:", err.response?.data || err.message);
    throw err;
  }
}

/**
 * ♻️ Step 2: Refresh the token if expired
 */
async function refreshYeastarToken(oldRefreshToken) {
  const url = `${YEASTAR_BASE_URL}/refresh_token`;
  console.log("♻️ Refreshing Yeastar access token...");

  try {
    const res = await axios.post(url, {
      refresh_token: oldRefreshToken,
    });
    const data = res.data;

    if (data.access_token) {
      console.log("✅ Yeastar token refreshed successfully.");

      const expiry = moment()
        .add(data.expires_in || 1800, "seconds")
        .toDate();

      await yeastarSDKToken.deleteMany({});
      await yeastarSDKToken.create({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: expiry,
      });

      return data.access_token;
    }

    throw new Error("Refresh token failed");
  } catch (err) {
    console.error(
      "❌ Yeastar refresh failed:",
      err.response?.data || err.message
    );
    throw err;
  }
}

/**
 * 🧠 Step 4: Get valid token from DB (relogin if invalid)
 */
async function getValidToken() {
  const existing = await yeastarSDKToken.findOne();

  // If no token in DB → login
  if (!existing) {
    console.log("⚠️ No Yeastar token in DB — logging in...");
    return await loginToYeastar();
  }

  // Check if time expired
  const now = new Date();
  if (existing.expires_at && now > existing.expires_at) {
    console.log("⚠️ Yeastar token expired — refreshing...");
    try {
      return await refreshYeastarToken(existing.refresh_token);
    } catch (err) {
      console.log("⚠️ Refresh failed, relogging...");
      return await loginToYeastar();
    }
  }

  return existing.access_token;
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
      "extensionNumber sipSecret firstname lastname email extensionStatus"
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

    if (user.extensionStatus === false) {
      return res.status(400).json({
        status: "error",
        message:
          "Not Activated Calling Facility.",
      });
    }

    console.log(user);

    // Get valid access token
    const accessToken = await getValidToken();

    console.log(accessToken);

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
        // username: user.extensionNumber, // Extension number is used for SDK login
        username: "1010",
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
