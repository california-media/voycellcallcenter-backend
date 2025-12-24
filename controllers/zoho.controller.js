const User = require("../models/userModel");
const { getZohoDomainConfig } = require("../utils/zohoDomain");
const oauth = require("../services/zohoOAuth.service");
const { syncZoho } = require("../services/zohoSync.service");
const { getZohoCurrentUser } = require("../services/zohoApi.service");
const axios = require("axios");

exports.connectZoho = async (req, res) => {
  try {
    const userId = req.user._id.toString(); // ✅ authenticated here
    const { dc } = req.body;

    console.log(userId);


    if (!dc) {
      return res.status(400).json({ message: "DC is required" });
    }

    const domain = getZohoDomainConfig(dc);

    await User.findByIdAndUpdate(userId, {
      "zoho.dc": dc,
      "zoho.accountsUrl": domain.accountsUrl,
      "zoho.apiBaseUrl": domain.apiBaseUrl
    });

    const url = oauth.getAuthURL({
      accountsUrl: domain.accountsUrl,
      redirectUri: process.env.ZOHO_REDIRECT_URI,
      state: userId // ✅ PASS USER ID
    });

    console.log(url);


    return res.json({
      status: "success",
      url
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "error",
      message: "Failed to generate Zoho auth URL"
    });
  }
};

exports.zohoCallback = async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send("Invalid Zoho callback");
  }

  const user = await User.findById(state);
  if (!user) return res.status(404).send("User not found");

  // 🚨 PREVENT DOUBLE EXCHANGE
  if (user.zoho?.isConnected) {
    const resultData = {
      status: 'success',
      message: 'Zoho already connected'
    };
    return res.send(` <!DOCTYPE html>
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
        <div class="success">Zoho CRM Already Connected! You can close this window.</div>
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
    </html>`);
  }

  try {
    let tokens;
    try {
      tokens = await oauth.getTokens({
        code,
        accountsUrl: user.zoho.accountsUrl,
        redirectUri: process.env.ZOHO_REDIRECT_URI
      });
    } catch (err) {
      console.error("Zoho token error:", err.message);
      return res.status(500).send("Zoho token exchange failed");
    }

    user.zoho.accessToken = tokens.access_token;
    user.zoho.refreshToken = tokens.refresh_token;
    user.zoho.isConnected = true;
    await user.save();
    const zohoUser = await getZohoCurrentUser(user);

    await User.findByIdAndUpdate(user._id, {
      "zoho.userId": zohoUser.id,
      "zoho.timezone": zohoUser.time_zone,
    });

    // await syncZoho(user);

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

    // res.json({ status: 'success', message: 'Microsoft account connected', user });

    return res.send(`
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
`);
  } catch (err) {
    console.error("Zoho callback error:", err.message);
    return res.send(`
            <script>
                window.opener.postMessage({ status: 'error', message: 'Zoho OAuth failed', error: '${err.message}' }, '*');
                window.close();
            </script>
        `);
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
