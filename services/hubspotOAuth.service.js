// services/hubspotOAuth.service.js
const axios = require("axios");
// const { getConfig } = require("../utils/getConfig");

const HUBSPOT_AUTH_BASE = "https://app-eu1.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";

// const SCOPES = [
//   "crm.objects.contacts.read",
//   "crm.objects.contacts.write",
//   "crm.objects.deals.read",
//   "crm.objects.deals.write",
//   "crm.objects.notes.read",
//   "crm.objects.notes.write",
//   "crm.objects.meetings.read",
//   "crm.objects.meetings.write",
//   "oauth",
// ].join(" ");
const SCOPES = "crm.objects.contacts.read crm.objects.contacts.write";

/**
 * Build HubSpot OAuth authorization URL
 */
// exports.getAuthURL = ({ redirectUri, state }) => {
//   const params = new URLSearchParams({
//     client_id: process.env.HUBSPOT_CLIENT_ID,
//     redirect_uri: redirectUri,
//     scope: SCOPES,
//     state,
//   });

//   return `${HUBSPOT_AUTH_BASE}?${params.toString()}`;
// };

exports.getAuthURL = ({ redirectUri, state }) => {
  // const {HUBSPOT_CLIENT_ID} = getConfig()
  const url =
    `https://app-eu1.hubspot.com/oauth/authorize` +
    `?client_id=${process.env.HUBSPOT_CLIENT_ID}` +
    // `?client_id=${HUBSPOT_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent("crm.objects.contacts.read crm.objects.contacts.write")}` +
    `&state=${state}`;

  return url;
};


// exports.getAuthURL = ({ redirectUri, state }) => {
//   const params = new URLSearchParams({
//     client_id: process.env.HUBSPOT_CLIENT_ID,
//     redirect_uri: redirectUri,
//     scope: SCOPES,
//     state,
//   });

//   return `https://app.hubspot.com/oauth/authorize?${params.toString()}`;
// };

/**
 * Exchange authorization code for tokens
 */
exports.getTokens = async ({ code, redirectUri }) => {
  // const {HUBSPOT_CLIENT_ID} = getConfig()
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.HUBSPOT_CLIENT_ID,
    // client_id: HUBSPOT_CLIENT_ID,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET,
    redirect_uri: redirectUri,
    code,
  });

  const response = await axios.post(HUBSPOT_TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return response.data;
  // Returns: { access_token, refresh_token, expires_in, token_type }
};

/**
 * Refresh an expired access token
 */
exports.refreshAccessToken = async (refreshToken) => {
  // const {HUBSPOT_CLIENT_ID} = getConfig()

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.HUBSPOT_CLIENT_ID,
    // client_id: HUBSPOT_CLIENT_ID,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  const response = await axios.post(HUBSPOT_TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return response.data;
};