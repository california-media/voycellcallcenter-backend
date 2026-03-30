const User = require("../models/userModel");
const oauth = require("../services/pipedriveOAuth.service");
const { getPipedriveCurrentUser } = require("../services/pipedriveApi.service");
// const { getConfig } = require("../utils/getConfig");

exports.connectPipedrive = async (req, res) => {
  try {

    // const { PIPEDRIVE_REDIRECT_URI, PIPEDRIVE_CLIENT_ID } = getConfig()
    const userId = req.user._id.toString();

    const PIPEDRIVE_REDIRECT_URI = process.env.PIPEDRIVE_REDIRECT_URI;


    const url = oauth.getAuthURL({
      // redirectUri: process.env.PIPEDRIVE_REDIRECT_URI,
      redirectUri: PIPEDRIVE_REDIRECT_URI,
      state: userId,
    });

    // const url = `https://oauth.pipedrive.com/oauth/authorize?client_id=${PIPEDRIVE_CLIENT_ID}&redirect_uri=${encodeURIComponent(PIPEDRIVE_REDIRECT_URI)}&state=${userId}`;


    console.log("[Pipedrive] Auth URL:", url);
    return res.json({ status: "success", url });
  } catch (err) {
    return res.status(500).json({ status: "error", message: "Auth URL generation failed" });
  }
};

exports.pipedriveCallback = async (req, res) => {
  const { code, state } = req.query;
  // const { PIPEDRIVE_REDIRECT_URI } = getConfig()
  const PIPEDRIVE_REDIRECT_URI = process.env.PIPEDRIVE_REDIRECT_URI;

  console.log("[Pipedrive Callback] code:", code ? "EXISTS" : "MISSING");
  console.log("[Pipedrive Callback] state:", state);

  if (!code || !state) {
    return res.status(400).send("Invalid Pipedrive callback");
  }

  try {
    const user = await User.findById(state);
    if (!user) return res.status(404).send("User not found");

    // 1. Exchange code for tokens
    const tokens = await oauth.getTokens({
      code,
      // redirectUri: process.env.PIPEDRIVE_REDIRECT_URI,
      redirectUri: PIPEDRIVE_REDIRECT_URI,
    });

    console.log("[Pipedrive Callback] Tokens received, api_domain:", tokens.api_domain);

    // 2. Save tokens — use api_domain returned by Pipedrive as the base URL
    user.pipedrive = {
      ...user.pipedrive,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      isConnected: true,
      apiBaseUrl: tokens.api_domain || "https://api.pipedrive.com",
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    };

    await user.save();

    // 3. Fetch current user info from Pipedrive
    const pipedriveUser = await getPipedriveCurrentUser(user);

    await User.findByIdAndUpdate(user._id, {
      "pipedrive.userId": String(pipedriveUser.id),
      "pipedrive.email": pipedriveUser.email,
      "pipedrive.companyDomain": pipedriveUser.company_domain,
    });

    const resultData = {
      status: "success",
      message: "Pipedrive Connected",
      pipedriveConnected: true,
      pipedriveUserId: pipedriveUser.id,
      pipedriveEmail: pipedriveUser.email,
    };

    // 4. Same popup-close pattern as Zoho/HubSpot
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Pipedrive Connected</title>
          <style>
              body { font-family: Arial, sans-serif; text-align: center; padding-top: 50px; }
              .success { color: green; font-size: 18px; margin-bottom: 20px; }
          </style>
      </head>
      <body>
          <div class="success">Pipedrive CRM connected successfully! You can close this window.</div>
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
    console.error("[Pipedrive Callback] Error:", err?.response?.data || err.message);
    return res.send(`
      <script>
        window.opener.postMessage({
          status: 'error',
          message: 'Pipedrive OAuth failed',
          error: '${err.message}'
        }, '*');
        window.close();
      </script>
    `);
  }
};

exports.disconnectPipedrive = async (req, res) => {
  const userId = req.user._id;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    user.pipedrive.accessToken = undefined;
    user.pipedrive.refreshToken = undefined;
    user.pipedrive.isConnected = false;
    user.pipedrive.userId = undefined;
    user.pipedrive.email = undefined;
    user.pipedrive.companyDomain = undefined;
    user.pipedrive.tokenExpiresAt = undefined;

    await user.save();

    return res.json({ status: "success", message: "Pipedrive CRM Disconnected" });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Failed to disconnect Pipedrive",
      error: error.message,
    });
  }
};

exports.testPipedriveConnection = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const { getClient } = require("../services/pipedriveApi.service");
    const client = await getClient(user);

    const response = await client.get("/v1/persons?limit=1");
    return res.json({ success: true, pipedriveData: response.data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};