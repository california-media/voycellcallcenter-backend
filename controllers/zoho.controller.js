const User = require("../models/userModel");
const oauth = require("../services/zohoOAuth.service");
const { syncZoho } = require("../services/zohoSync.service");
const { getZohoCurrentUser } = require("../services/zohoApi.service");
const axios = require("axios");

exports.connectZoho = async (req, res) => {
  try {
    const userId = req.user._id.toString();

    // We always start at the global .com; Zoho handles the internal redirect
    const accountsUrl = "https://accounts.zoho.com";

    const url = oauth.getAuthURL({
      accountsUrl: accountsUrl,
      redirectUri: process.env.ZOHO_REDIRECT_URI,
      state: userId
    });

    return res.json({ status: "success", url });
  } catch (err) {
    return res.status(500).json({ status: "error", message: "Auth URL generation failed" });
  }
};

exports.zohoCallback = async (req, res) => {
  // Zoho sends 'location' and 'accounts-server' in the query params
  const { code, state, location, "accounts-server": accountsServer } = req.query;

  if (!code || !state) {
    return res.status(400).send("Invalid Zoho callback");
  }

  try {
    const user = await User.findById(state);
    if (!user) return res.status(404).send("User not found");

    // Use the accountsServer provided by Zoho callback, fallback to .com if missing
    const finalAccountsUrl = accountsServer || "https://accounts.zoho.com";

    // 1. Exchange tokens using the CORRECT DC URL
    const tokens = await oauth.getTokens({
      code,
      accountsUrl: finalAccountsUrl,
      redirectUri: process.env.ZOHO_REDIRECT_URI
    });

    // 2. Save DC info and tokens
    // api_domain is usually returned in the token response (e.g., https://www.zohoapis.eu)
    user.zoho = {
      ...user.zoho,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      isConnected: true,
      dc: location, // e.g., "eu"
      accountsUrl: finalAccountsUrl, // e.g., "https://accounts.zoho.eu"
      apiBaseUrl: tokens.api_domain // This is the API endpoint for this user
    };

    await user.save();

    // 3. Fetch user details from the specific DC
    const zohoUser = await getZohoCurrentUser(user);

    await User.findByIdAndUpdate(user._id, {
      "zoho.userId": zohoUser.id,
      "zoho.timezone": zohoUser.time_zone,
    });

    // const resultData = { status: 'success', message: 'Zoho Connected' };

    const resultData = {
      status: 'success',
      message: 'Zoho Connected',
      zohoId: user.zoho.userId,
      zohoEmail: user.zoho.email,
      zohoAccessToken: user.zoho.accessToken,
      zohoRefreshToken: user.zoho.refreshToken,
      zohoConnected: user.zoho.isConnected,
      zohoTimezone: user.zoho.timezone,
      zohoDc: user.zoho.dc,
      zohoAccountsUrl: user.zoho.accountsUrl,
      zohoApiBaseUrl: user.zoho.apiBaseUrl,
    };

    return res.send(
      `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Zoho CRM Connected</title>
        <style>
            body { 
                font-family: Arial, sans-serif; 
                text-align: center; 
                padding-top: 50px; 
            }
            .success { color: green; font-size: 18px; margin-bottom: 20px; }
        </style>
    </head>
    <body>
        <div class="success">Zoho CRM connected Successfully! You can close this window.</div>
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
      `
    ); // Clean helper for HTML response

  } catch (err) {
    return res.send(`
      <script>
                window.opener.postMessage({ status: 'error', message: 'Zoho OAuth failed', error: '${err.message}' }, '*');
                window.close();
      </script>`);
  }
};

exports.disconnectZoho = async (req, res) => {
  const userId = req.user._id;

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Clear Zoho account details
    user.zoho.accessToken = undefined;
    user.zoho.refreshToken = undefined;
    user.zoho.isConnected = false;
    user.zoho.userId = undefined;
    user.zoho.timezone = undefined;
    user.zoho.dc = undefined;
    user.zoho.accountsUrl = undefined;
    user.zoho.apiBaseUrl = undefined;

    await user.save();

    res.json({ status: 'success', message: 'Zoho CRM Disconnected' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Failed to disconnect Zoho account', error: error.message });
  }
};

exports.testZohoConnection = async (req, res) => {
  const user = await User.findById(req.user._id);

  const zohoRes = await axios.get(
    `${user.zoho.apiBaseUrl}/crm/v2/Leads?per_page=1`,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${user.zoho.accessToken}`,
      },
      timeout: 10000,
    }
  );

  return res.json({
    success: true,
    zohoData: zohoRes.data,
  });
};