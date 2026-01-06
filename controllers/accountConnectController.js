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

const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_REDIRECT_URI2 = process.env.ZOHO_REDIRECT_URI;
const ZOHO_ACCOUNTS_URL = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";

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

exports.connectZoom = async (req, res) => {
    const userId = req.user._id;

    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.ZOOM_CLIENT_ID,
        redirect_uri: process.env.ZOOM_REDIRECT_URI,
        state: JSON.stringify({ userId }),
    });

    res.json({
        status: "success",
        url: `https://zoom.us/oauth/authorize?${params.toString()}`,
    });
};

exports.zoomCallback = async (req, res) => {
    const { code, state } = req.query;
    const { userId } = JSON.parse(state);

    try {
        const tokenRes = await axios.post(
            "https://zoom.us/oauth/token",
            null,
            {
                params: {
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: process.env.ZOOM_REDIRECT_URI,
                },
                auth: {
                    username: process.env.ZOOM_CLIENT_ID,
                    password: process.env.ZOOM_CLIENT_SECRET,
                },
            }
        );

        const { access_token, refresh_token, expires_in } = tokenRes.data;

        const zoomUser = await axios.get("https://api.zoom.us/v2/users/me", {
            headers: { Authorization: `Bearer ${access_token}` },
        });



        await User.findByIdAndUpdate(userId, {
            zoom: {
                isConnected: true,
                userId: zoomUser.data.id,
                email: zoomUser.data.email,
                accessToken: access_token,
                refreshToken: refresh_token,
                tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
            },
        });

        const user = await User.findById(userId);

        const resultData = {
            status: 'success',
            message: 'Zoom Connected',
            zoomId: user.zoom.userId,
            zoomEmail: user.zoom.email,
            zoomAccessToken: user.zoom.accessToken,
            zoomRefreshToken: user.zoom.refreshToken,
            zoomConnected: user.zoom.isConnected,
        };

        console.log(resultData);


        return res.send(`
          <!DOCTYPE html>
    <html>
    <head>
        <title>Zoom Connected</title>
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
        <div class="success">Zoom Account Connected Successfully! You can close this window.</div>
        <script>
            window.opener.postMessage(${JSON.stringify(resultData)}, '*');
            window.close();
        </script>
    </body>
    </html>
    `);
    } catch (err) {
        return res.send(`
      <script>
        window.opener.postMessage({ status: "error", message: "Zoom auth failed" }, "*");
        window.close();
      </script>
    `);
    }
};


// exports.connectZoho = async (req, res) => {
//     try {
//         const userId = req.user._id;
//         const type = req.body.type || "web";

//         const user = await User.findById(userId);
//         if (!user) {
//             return res.status(404).json({ status: "error", message: "User not found" });
//         }

//         const scopes = [
//             "ZohoCRM.modules.ALL",
//             "ZohoMail.accounts.READ",
//             "ZohoCalendar.calendar.ALL",
//             "ZohoContacts.contacts.READ",
//         ];

//         const params = querystring.stringify({
//             client_id: ZOHO_CLIENT_ID,
//             response_type: "code",
//             redirect_uri: ZOHO_REDIRECT_URI,
//             scope: scopes.join(","),
//             access_type: "offline",
//             prompt: "consent",
//             state: JSON.stringify({ userId, type }),
//         });

//         const authUrl = `${ZOHO_ACCOUNTS_URL}/oauth/v2/auth?${params}`;

//         return res.json({
//             status: "success",
//             url: authUrl,
//         });
//     } catch (error) {
//         res.status(500).json({
//             status: "error",
//             message: "Failed to generate Zoho OAuth URL",
//             error: error.message,
//         });
//     }
// };

// exports.zohoCallback = async (req, res) => {
//     const { code, state } = req.query;

//     let userId, type;
//     try {
//         const parsed = JSON.parse(state);
//         userId = parsed.userId;
//         type = parsed.type;
//     } catch {
//         return res.status(400).json({ status: "error", message: "Invalid state" });
//     }

//     try {
//         // 🔑 Exchange code for tokens
//         const tokenResponse = await axios.post(
//             `${process.env.ZOHO_ACCOUNTS_URL}/oauth/v2/token`,
//             null,
//             {
//                 params: {
//                     grant_type: "authorization_code",
//                     client_id: process.env.ZOHO_CLIENT_ID,
//                     client_secret: process.env.ZOHO_CLIENT_SECRET,
//                     redirect_uri: process.env.ZOHO_REDIRECT_URI,
//                     code,
//                 },
//             }
//         );

//         const { access_token, refresh_token } = tokenResponse.data;

//         // 🔍 Fetch Zoho user info
//         const userInfo = await axios.get(
//             "https://www.zohoapis.com/oauth/user/info",
//             {
//                 headers: {
//                     Authorization: `Zoho-oauthtoken ${access_token}`,
//                 },
//             }
//         );

//         const user = await User.findById(userId);
//         if (!user) throw new Error("User not found");

//         // 💾 Save Zoho details
//         user.zohoId = userInfo.data.ZUID;
//         user.zohoEmail = userInfo.data.Email;
//         user.zohoAccessToken = access_token;
//         user.zohoRefreshToken = refresh_token;
//         user.zohoConnected = true;

//         await user.save();

//         const resultData = {
//             status: "success",
//             zohoId: user.zohoId,
//             zohoEmail: user.zohoEmail,
//             zohoConnected: true,
//         };

//         // 📱 Mobile deep link
//         if (type === "mobile") {
//             return res.redirect(
//                 `contactsManagement://zoho-auth?status=success&email=${user.zohoEmail}`
//             );
//         }

//         // 🌐 Web popup
//         return res.send(`
//       <html>
//         <body>
//           <script>
//             window.opener.postMessage(${JSON.stringify(resultData)}, '*');
//             window.close();
//           </script>
//           <p>Zoho Account Connected Successfully</p>
//         </body>
//       </html>
//     `);
//     } catch (error) {
//         if (type === "mobile") {
//             return res.redirect(
//                 `contactsManagement://zoho-auth?status=error&message=${encodeURIComponent(error.message)}`
//             );
//         }

//         return res.send(`
//       <script>
//         window.opener.postMessage({ status: 'error', message: '${error.message}' }, '*');
//         window.close();
//       </script>
//     `);
//     }
// };
