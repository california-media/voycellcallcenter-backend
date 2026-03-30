// controllers/hubspot.controller.js
const User = require("../models/userModel");
const oauth = require("../services/hubspotOAuth.service");
const { getHubSpotCurrentUser } = require("../services/hubspotApi.service");
// const { getConfig } = require("../utils/getConfig");

exports.connectHubSpot = async (req, res) => {
  try {
    // const {HUBSPOT_REDIRECT_URI2} = getConfig()
    const userId = req.user._id.toString();

    const url = oauth.getAuthURL({
      redirectUri: process.env.HUBSPOT_REDIRECT_URI2,
      // redirectUri: HUBSPOT_REDIRECT_URI2,
      state: userId,
    });
 console.log("HubSpot Auth URL:", url);
    return res.json({ status: "success", url });
  } catch (err) {
    return res.status(500).json({ status: "error", message: "Auth URL generation failed" });
  }
};

exports.hubspotCallback = async (req, res) => {
  // const {HUBSPOT_REDIRECT_URI2} = getConfig()
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send("Invalid HubSpot callback");
  }

  try {
    const user = await User.findById(state);
    if (!user) return res.status(404).send("User not found");

    // 1. Exchange code for tokens
    const tokens = await oauth.getTokens({
      code,
      redirectUri: process.env.HUBSPOT_REDIRECT_URI2,
      // redirectUri: HUBSPOT_REDIRECT_URI2,
    });

    // 2. Save tokens to DB
    user.hubspot = {
      ...user.hubspot,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      isConnected: true,
      apiBaseUrl: "https://api.hubapi.com",
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    };

    await user.save();

    // 3. Fetch HubSpot portal/user info
    const hubspotUser = await getHubSpotCurrentUser(user);

    await User.findByIdAndUpdate(user._id, {
      "hubspot.userId": String(hubspotUser.hub_id),
      "hubspot.email": hubspotUser.user,
    });

    const resultData = {
      status: "success",
      message: "HubSpot Connected",
      hubspotPortalId: hubspotUser.hub_id,
      hubspotEmail: hubspotUser.user,
      hubspotConnected: true,
    };

    // 4. Return popup-close page (same pattern as Zoho)
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>HubSpot Connected</title>
          <style>
              body { font-family: Arial, sans-serif; text-align: center; padding-top: 50px; }
              .success { color: green; font-size: 18px; margin-bottom: 20px; }
          </style>
      </head>
      <body>
          <div class="success">HubSpot CRM connected successfully! You can close this window.</div>
          <script>
          try {
              if (window.opener) {
                  window.opener.postMessage(${JSON.stringify(resultData)}, '*');
              } else {
                  console.warn("No opener window found");
              }
          } catch (e) {
              console.error("postMessage failed", e);
          }
          window.close();
          </script>
      </body>
      </html>
    `);
  } catch (err) {
    return res.send(`
      <script>
        window.opener.postMessage({ status: 'error', message: 'HubSpot OAuth failed', error: '${err.message}' }, '*');
        window.close();
      </script>
    `);
  }
};

exports.disconnectHubSpot = async (req, res) => {
  const userId = req.user._id;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    user.hubspot.accessToken = undefined;
    user.hubspot.refreshToken = undefined;
    user.hubspot.isConnected = false;
    user.hubspot.userId = undefined;
    user.hubspot.email = undefined;
    user.hubspot.timezone = undefined;
    user.hubspot.tokenExpiresAt = undefined;

    await user.save();

    return res.json({ status: "success", message: "HubSpot CRM Disconnected" });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Failed to disconnect HubSpot",
      error: error.message,
    });
  }
};

exports.testHubSpotConnection = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    const { getClient } = require("../services/hubspotApi.service");
    const client = await getClient(user);

    const response = await client.get("/crm/v3/objects/contacts?limit=1");

    return res.json({ success: true, hubspotData: response.data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};