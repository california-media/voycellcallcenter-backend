const axios = require("axios");
const { getConfig } = require("../utils/getConfig");

// const PIPEDRIVE_AUTH_BASE = "https://oauth.pipedrive.com/marketplace/oauth/authorize";
const PIPEDRIVE_AUTH_BASE = "https://oauth.pipedrive.com/oauth/authorize";
const PIPEDRIVE_TOKEN_URL = "https://oauth.pipedrive.com/oauth/token";

/**
 * Build Pipedrive OAuth authorization URL
 */
exports.getAuthURL = ({ redirectUri, state }) => {

  // const {PIPEDRIVE_CLIENT_ID} = getConfig()
  const PIPEDRIVE_CLIENT_ID = process.env.PIPEDRIVE_CLIENT_ID;

  // const url =
  //   `${PIPEDRIVE_AUTH_BASE}` +
  //   // `?client_id=${process.env.PIPEDRIVE_CLIENT_ID}` +
  //   `?client_id=${PIPEDRIVE_CLIENT_ID}` +
  //   `&redirect_uri=${encodeURIComponent(redirectUri)}` +
  //   `&state=${state}`;

  const url =
    `${PIPEDRIVE_AUTH_BASE}` +  // ✅ fixed
    `?client_id=${PIPEDRIVE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +                          // ✅ added
    `&state=${state}`;

  return url;
};

/**
 * Exchange authorization code for tokens
 * Pipedrive requires Basic Auth (client_id:client_secret base64 encoded)
 */
exports.getTokens = async ({ code, redirectUri }) => {
  // const {PIPEDRIVE_CLIENT_ID} = getConfig()
  const PIPEDRIVE_CLIENT_ID = process.env.PIPEDRIVE_CLIENT_ID;

  const credentials = Buffer.from(
    // `${process.env.PIPEDRIVE_CLIENT_ID}:${process.env.PIPEDRIVE_CLIENT_SECRET}`
    `${PIPEDRIVE_CLIENT_ID}:${process.env.PIPEDRIVE_CLIENT_SECRET}`
  ).toString("base64");

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  console.log("[Pipedrive OAuth] Exchanging token...");

  try {
    const response = await axios.post(
      PIPEDRIVE_TOKEN_URL,
      params.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${credentials}`,
        },
      }
    );
    return response.data;
    // Returns: { access_token, refresh_token, expires_in, token_type, api_domain }
  } catch (err) {
    console.error("[Pipedrive OAuth] Token exchange failed:", err?.response?.data || err.message);
    throw err;
  }
};

/**
 * Refresh an expired access token
 */
exports.refreshAccessToken = async (refreshToken) => {
  // const { PIPEDRIVE_CLIENT_ID } = getConfig()
  const PIPEDRIVE_CLIENT_ID = process.env.PIPEDRIVE_CLIENT_ID;

  const credentials = Buffer.from(
    // `${process.env.PIPEDRIVE_CLIENT_ID}:${process.env.PIPEDRIVE_CLIENT_SECRET}`
    `${PIPEDRIVE_CLIENT_ID}:${process.env.PIPEDRIVE_CLIENT_SECRET}`
  ).toString("base64");

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  console.log("[Pipedrive OAuth] Refreshing access token...");

  try {
    const response = await axios.post(
      PIPEDRIVE_TOKEN_URL,
      params.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${credentials}`,
        },
      }
    );
    console.log("[Pipedrive OAuth] Token refreshed successfully");
    return response.data;
  } catch (err) {
    console.error("[Pipedrive OAuth] Token refresh failed:", err?.response?.data || err.message);
    throw err;
  }
};