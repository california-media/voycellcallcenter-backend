const User = require("../models/userModel");
const { getZohoDomainConfig } = require("../utils/zohoDomain");
const oauth = require("../services/zohoOAuth.service");
const { syncZoho } = require("../services/zohoSync.service");
const { getZohoCurrentUser } = require("../services/zohoApi.service");


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
  if (user.zoho?.connected) {
    return res.send("Zoho already connected");
  }

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
  user.zoho.connected = true;
  await user.save();
  const zohoUser = await getZohoCurrentUser(user);

  await User.findByIdAndUpdate(user._id, {
    "zoho.userId": zohoUser.id,
    "zoho.timezone": zohoUser.time_zone,
  });

  // await syncZoho(user);

  res.send("Zoho Connected Successfully");
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
        user.zoho.connected = false;
        user.zoho.userId = undefined;
        user.zoho.timezone = undefined;

        await user.save();

        res.json({ status: 'success', message: 'Zoho Disconnected' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to disconnect Zoho account', error: error.message });
    }
};