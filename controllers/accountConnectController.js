const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');
const nodemailer = require('nodemailer');
const User = require('../models/userModel'); // Your User Model
const querystring = require('querystring');
require("dotenv").config();
const mongoose = require("mongoose");



// Google OAuth Setup
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI2;

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI;

const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// 1. API to Generate Google OAuth URL
exports.connectGoogle = async (req, res) => {
    const userId = req.user._id;
    console.log(userId);
    
    const type = req.body.type; // Default to 'default' if not specified
    try {
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const scopes = [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/gmail.send',  // ✅ Required for sending email
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/contacts.readonly',  // ✅ Add this
        ];

        const params = querystring.stringify({
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: 'code',
            scope: scopes.join(' '),
            access_type: 'offline',
            prompt: 'consent',
            // state: userId,   // ✅ Pass User ID here, not email
            state: JSON.stringify({ userId, type }),
        });

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

        res.json({ status: 'success', url: authUrl });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to generate Google OAuth URL', error });
    }
};

// 2. Google OAuth Callback API
exports.googleCallback = async (req, res) => {
    const { code, state } = req.query;
    // const userId = state;

    let userId, type;
    try {
        const parsedState = JSON.parse(state);
        userId = parsedState.userId;
        type = parsedState.type;
    } catch (e) {
        return res.status(400).json({ status: 'error', message: 'Invalid state parameter' });
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        const googleUser = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });

        const user = await User.findById(userId);
        if (!user) {
            return res.send(`<script>window.opener.postMessage({ status: 'error', message: 'User not found' }, '*'); window.close();</script>`);
        }

        // Save Google info
        user.googleId = googleUser.data.id;
        user.googleEmail = googleUser.data.email;
        user.googleAccessToken = tokens.access_token;
        user.googleRefreshToken = tokens.refresh_token;
        user.googleConnected = true;
        await user.save();

        // ✅ Send Google details back to frontend main window using postMessage
        const resultData = {
            status: 'success',
            message: 'Google Connected',
            googleId: user.googleId,
            googleEmail: user.googleEmail,
            googleAccessToken: user.googleAccessToken,
            googleRefreshToken: user.googleRefreshToken,
            googleConnected: user.googleConnected
        };

        //     if (type === 'mobile') {
        //         return res.send(`
        //     <html>
        //     <body>
        //         <script>
        //             window.ReactNativeWebView?.postMessage(${JSON.stringify(resultData)});
        //             window.close();
        //         </script>
        //     </body>
        //     </html>
        // `);
        //     }

        if (type === "mobile") {
            // Instead of sending HTML with JS, redirect directly
            const redirectUrl = `contactsManagement://google-auth?status=success&googleId=${user.googleId}&googleEmail=${user.googleEmail}&accessToken=${user.googleAccessToken}&refreshToken=${user.googleRefreshToken}`;
            return res.redirect(redirectUrl);
        }



        return res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Google Connected</title>
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
        <div class="success">Google Account Connected Successfully! You can close this window.</div>
        <script>
            window.opener.postMessage(${JSON.stringify(resultData)}, '*');
            window.close();
        </script>
    </body>
    </html>
`);


    } catch (error) {
        if (type === "mobile") {
            return res.redirect(
                `contactsManagement://google-auth?status=error&message=${encodeURIComponent(error.message)}`
            );
        }
        return res.send(`
            <script>
                window.opener.postMessage({ status: 'error', message: 'Google callback failed', error: '${error.message}' }, '*');
                window.close();
            </script>
        `);
    }
};

exports.connectMicrosoft = async (req, res) => {
    const userId = req.user._id;

    const params = querystring.stringify({
        client_id: MICROSOFT_CLIENT_ID,
        response_type: 'code',
        redirect_uri: MICROSOFT_REDIRECT_URI,
        response_mode: 'query',
        scope: 'User.Read Mail.Send offline_access',
        state: userId,
    });

    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;

    res.json({ status: 'success', url: authUrl });
};

exports.microsoftCallback = async (req, res) => {
    const { code, state } = req.query;
    const userId = state;

    try {
        const tokenResponse = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', new URLSearchParams({
            client_id: MICROSOFT_CLIENT_ID,
            client_secret: MICROSOFT_CLIENT_SECRET,
            code,
            redirect_uri: MICROSOFT_REDIRECT_URI,
            grant_type: 'authorization_code',
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        const userProfile = await axios.get('https://graph.microsoft.com/v1.0/me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        user.microsoftId = userProfile.data.id;
        user.microsoftEmail = userProfile.data.mail || userProfile.data.userPrincipalName;
        user.microsoftAccessToken = accessToken;
        user.microsoftConnected = true;
        await user.save();

        const resultData = {
            status: 'success',
            message: 'Microsoft Connected',
            microsoftId: user.microsoftId,
            microsoftEmail: user.microsoftEmail,
            microsoftAccessToken: user.microsoftAccessToken,
            microsoftConnected: user.microsoftConnected
        };

        // res.json({ status: 'success', message: 'Microsoft account connected', user });

        return res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Microsoft Connected</title>
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
        <div class="success">Microsoft account connected Successfully! You can close this window.</div>
        <script>
            window.opener.postMessage(${JSON.stringify(resultData)}, '*');
            window.close();
        </script>
    </body>
    </html>
`);

    } catch (error) {
        // res.status(500).json({ status: 'error', message: 'Microsoft OAuth failed', error: error.message });
        return res.send(`
            <script>
                window.opener.postMessage({ status: 'error', message: 'Microsoft OAuth failed', error: '${error.message}' }, '*');
                window.close();
            </script>
        `);
    }
};

exports.connectSMTP = async (req, res) => {
    const userId = req.user._id;

    try {
        // ✅ Find user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = req.body;

        // ✅ Create SMTP transporter
        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: true,  // Using SSL/TLS
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS
            }
        });

        // ✅ Verify SMTP connection (without sending mail)
        await transporter.verify();

        // ✅ Save SMTP details to user document
        user.smtpId = new mongoose.Types.ObjectId();
        user.smtpHost = SMTP_HOST;
        user.smtpPort = SMTP_PORT;
        user.smtpUser = SMTP_USER;
        user.smtpPass = SMTP_PASS;
        user.smtpSecure = true;
        user.smtpConnected = true;

        await user.save();

        res.json({
            status: 'success',
            message: 'SMTP Mail Connected',
            data: {
                smtpId: user.smtpId,
                smtpHost: user.smtpHost,
                smtpPort: user.smtpPort,
                smtpUser: user.smtpUser,
                smtpSecure: user.smtpSecure,
                smtpConnected: user.smtpConnected
            }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'SMTP OAuth failed', error: error.message });
    }
};