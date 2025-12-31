const axios = require('axios');
const User = require('../models/userModel');
const { createTokenforUser } = require("../services/authentication");
const jwt = require("jsonwebtoken");

// 1. START OAUTH
exports.startAuth = (req, res) => {
    const state = req.user._id; 
    const authUrl = `https://oauth.pipedrive.com/oauth/authorize?client_id=${process.env.PIPEDRIVE_CLIENT_ID}&redirect_uri=${process.env.PIPEDRIVE_REDIRECT_URI}&state=${state}`;
    res.redirect(authUrl);
};

// 2. OAUTH CALLBACK
exports.handleCallback = async (req, res) => {
    const { code, state } = req.query;
    try {
        const response = await axios.post('https://oauth.pipedrive.com/oauth/token', 
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: process.env.PIPEDRIVE_REDIRECT_URI,
            }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${process.env.PIPEDRIVE_CLIENT_ID}:${process.env.PIPEDRIVE_CLIENT_SECRET}`).toString('base64')}`
            }
        });

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
        res.status(500).send("Authentication failed");
    }
};

// 3. THE BRIDGE (Fixes "SDK not defined" and starts the Handshake)
exports.pipedriveBridge = (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>VoyCell Loading...</title>
        <script src="https://cdn.jsdelivr.net/npm/@pipedrive/app-extensions-sdk@0/dist/index.umd.js"></script>
    </head>
    <body style="background: #f7f7f7; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif;">
        <div style="text-align: center;">
            <div style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 30px; height: 30px; animation: spin 2s linear infinite; margin: 0 auto 10px;"></div>
            <p>Opening VoyCell...</p>
        </div>
        <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>

        <script>
            (async function() {
                try {
                    // 1. Perform Handshake (Prevents the 10-second timeout error)
                    const sdk = await new AppExtensionsSDK().initialize();
                    
                    // 2. Get the JWT token from Pipedrive URL
                    const urlParams = new URLSearchParams(window.location.search);
                    const token = urlParams.get('token'); 

                    // 3. Redirect to your embed logic with the token
                    window.location.href = "/api/pipedrive/embed?jwt=" + token;
                } catch (e) {
                    console.error("SDK Error:", e);
                    document.body.innerHTML = "Error connecting to Pipedrive.";
                }
            })();
        </script>
    </body>
    </html>`;
    res.send(html);
};

// 4. THE EMBED LOGIC (Fixes "JWT Missing")
exports.embed = async (req, res) => {
    try {
        const pipedriveJwt = req.query.jwt; // Now provided by the bridge

        if (!pipedriveJwt) return res.status(400).send("JWT missing");

        const decoded = jwt.verify(pipedriveJwt, process.env.PIPEDRIVE_CLIENT_SECRET);
        const user = await User.findOne({ "pipedrive.userId": decoded.user_id });

        if (!user) return res.status(401).send("User not connected to Voycell");

        const sessionToken = createTokenforUser(user);
        return res.redirect(`https://app.voycell.com/app?token=${sessionToken}`);
    } catch (error) {
        return res.status(401).send("Invalid JWT");
    }
};