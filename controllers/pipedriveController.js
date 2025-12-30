const axios = require('axios');
const User = require('../models/userModel');
const { createTokenforUser } = require("../services/authentication");
const jwt = require("jsonwebtoken");

// controller/pipedriveController.js
exports.startAuth = (req, res) => {
  // Pass the current user's ID as the 'state' so we can identify them later
  const state = req.user._id;
  const authUrl = `https://oauth.pipedrive.com/oauth/authorize?client_id=${process.env.PIPEDRIVE_CLIENT_ID}&redirect_uri=${process.env.PIPEDRIVE_REDIRECT_URI}&state=${state}`;
  res.redirect(authUrl);
};

exports.handleCallback = async (req, res) => {
  const { code, state } = req.query; // 'state' is the userId we passed above

  try {
    const response = await axios.post('https://oauth.pipedrive.com/oauth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.PIPEDRIVE_REDIRECT_URI,
      }), {
      headers: {
        // Must be application/x-www-form-urlencoded
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.PIPEDRIVE_CLIENT_ID}:${process.env.PIPEDRIVE_CLIENT_SECRET}`).toString('base64')}`
      }
    });

    // Use 'state' instead of 'req.user._id' to find the user
    await User.findByIdAndUpdate(state, {
      pipedrive: {
        isConnected: true,
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        tokenExpiresAt: new Date(Date.now() + response.data.expires_in * 1000),
        apiDomain: response.data.api_domain
      }
    });

    res.send("<h1>Success!</h1><p>VoyCell is now connected to Pipedrive.</p>");
  } catch (error) {
    console.error("OAuth Error:", error.response ? error.response.data : error.message);
    res.status(500).send("Authentication failed");
  }
};

exports.embed = async (req, res) => {
  try {
    // API Gateway query params
    const pipedriveJwt = req.query?.jwt;

    if (!pipedriveJwt) {
      return res.status(400).send("JWT missing");
    }

    // Verify JWT using Pipedrive Client Secret
    const decoded = jwt.verify(
      pipedriveJwt,
      process.env.PIPEDRIVE_CLIENT_SECRET
    );

    const pipedriveUserId = decoded.user_id;

    // Find Voycell user mapped to Pipedrive
    const user = await User.findOne({
      "pipedrive.userId": pipedriveUserId
    });

    if (!user) {
      return res
        .status(401)
        .send("This Pipedrive user is not connected to Voycell");
    }

    // Generate Voycell login token
    const sessionToken = createTokenforUser(user);

    // Redirect iframe to Voycell app
    return res.redirect(
      `https://app.voycell.com/app?token=${sessionToken}`
    );
  } catch (error) {
    console.error("Pipedrive embed error:", error);
    return res.status(401).send("Invalid or expired JWT");
  }
};

// controller/pipedriveController.js
exports.pipedriveBridge = (req, res) => {
  // This is a tiny HTML bridge that satisfies Pipedrive's SDK requirement
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <script src="https://cdn.jsdelivr.net/npm/@pipedrive/app-extensions-sdk@latest/dist/index.js"></script>
    </head>
    <body>
        <p>Loading VoyCell...</p>
        <script>
            (async function() {
                try {
                    // 1. Tell Pipedrive "I am here!" (The Handshake)
                    const sdk = await new AppExtensionsSDK().initialize();
                    
                    // 2. Redirect to your actual embed logic
                    // We pass the JWT token forward so your 'embed' controller can see it
                    const urlParams = new URLSearchParams(window.location.search);
                    window.location.href = "https://nf6fp9tcn6.execute-api.eu-north-1.amazonaws.com/api/pipedrive/embed?" + urlParams.toString();
                } catch (e) {
                    console.error("Pipedrive SDK failed", e);
                }
            })();
        </script>
    </body>
    </html>`;
  res.send(html);
};
