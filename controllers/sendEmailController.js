const { google } = require('googleapis');
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();
const User = require('../models/userModel'); // Your Mongoose User Model

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

exports.sendEmail = async (req, res) => {
    const {
        emailProvider,
        fromEmail,
        fromGoogleRefreshToken, // we ignore client-provided token as source-of-truth, but validate if provided
        fromMicrosoftAccessToken,
        to,
        subject,
        text,
        html,
    } = req.body;

    const userId = req.user?._id;

    // Basic validation
    if (!emailProvider) {
        return res.status(400).json({ status: "error", message: "Missing required field: emailProvider (google|microsoft|smtp)." });
    }
    if (!to) {
        return res.status(400).json({ status: "error", message: "Missing required field: to (recipient email)." });
    }
    if (!subject) {
        return res.status(400).json({ status: "error", message: "Missing required field: subject." });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(to).trim())) {
        return res.status(400).json({ status: "error", message: "Invalid recipient email format in 'to'." });
    }
    if (!userId) {
        return res.status(401).json({ status: "error", message: "Authentication required." });
    }

    try {
        // Always load latest user record from DB
        const user = await User.findById(userId).exec();
        if (!user) {
            return res.status(401).json({ status: "error", message: "Authenticated user not found." });
        }

        const provider = String(emailProvider || "").toLowerCase();

        // ---------- GOOGLE ----------
        // if (provider === "google") {
        //   // server-side token + email are authoritative
        //   if (!user.googleConnected || !user.googleRefreshToken || !user.googleEmail) {
        //     return res.status(401).json({
        //       status: "error",
        //       message: "Google account not connected on server. Please connect your Google account from the web dashboard before sending email.",
        //     });
        //   }

        //   // If client supplies a fromEmail, ensure it matches server email
        //   if (fromEmail && fromEmail.trim().toLowerCase() !== user.googleEmail.trim().toLowerCase()) {
        //     return res.status(400).json({
        //       status: "error",
        //       message: "Provided fromEmail does not match the connected Google account. Use the connected Google email or reconnect.",
        //     });
        //   }

        //   // Use server's refresh token
        //   const refreshToken = user.googleRefreshToken;
        //   const finalFrom = user.googleEmail;

        //   // Build OAuth2 client
        //   const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
        //   oAuth2Client.setCredentials({ refresh_token: refreshToken });

        //   // Try to get new access token using refresh token
        //   let accessToken;
        //   try {
        //     const atResponse = await oAuth2Client.getAccessToken();
        //     // getAccessToken returns an object { token } or a string in some versions
        //     accessToken = typeof atResponse === "string" ? atResponse : atResponse?.token || null;

        //     if (!accessToken) {
        //       throw new Error("No access token returned from Google.");
        //     }

        //     // Save the fresh access token to DB (optional but helpful)
        //     user.googleAccessToken = accessToken;
        //     await user.save();
        //   } catch (err) {
        //     // token refresh failed: mark google as disconnected and clear tokens to prevent future misuse
        //     console.error("Google token refresh error:", err?.response?.data || err?.message || err);

        //     try {
        //       user.googleConnected = false;
        //       user.googleRefreshToken = null;
        //       user.googleAccessToken = null;
        //       await user.save();
        //     } catch (saveErr) {
        //       console.error("Failed to clear google tokens in DB:", saveErr);
        //     }

        //     return res.status(401).json({
        //       status: "error",
        //       message: "Google authentication failed. Please reconnect your Google account.",
        //       error: err?.response?.data?.error || err?.message || err,
        //     });
        //   }

        //   // Compose email and send via nodemailer (OAuth2)
        //   try {
        //     const transporter = nodemailer.createTransport({
        //       service: "gmail",
        //       auth: {
        //         type: "OAuth2",
        //         user: finalFrom,
        //         clientId: CLIENT_ID,
        //         clientSecret: CLIENT_SECRET,
        //         refreshToken: refreshToken,
        //         accessToken: accessToken,
        //       },
        //     });

        //     const mailOptions = {
        //       from: finalFrom,
        //       to,
        //       subject,
        //       text: text || "",
        //       html: html || "",
        //     };

        //     await transporter.sendMail(mailOptions);

        //     return res.status(200).json({ status: "success", message: "Email sent successfully via Google." });
        //   } catch (sendErr) {
        //     console.error("Gmail send error:", sendErr?.response || sendErr?.message || sendErr);

        //     // If it's an auth-related failure, clear tokens so client must reconnect
        //     const errMsg = sendErr?.message || sendErr;
        //     if (String(errMsg).toLowerCase().includes("invalid") || String(errMsg).toLowerCase().includes("token")) {
        //       try {
        //         user.googleConnected = false;
        //         user.googleRefreshToken = null;
        //         user.googleAccessToken = null;
        //         await user.save();
        //       } catch (saveErr) {
        //         console.error("Failed to clear google tokens after send error:", saveErr);
        //       }
        //       return res.status(401).json({
        //         status: "error",
        //         message: "Google authentication failed while sending. Please reconnect your Google account.",
        //         error: errMsg,
        //       });
        //     }

        //     return res.status(500).json({
        //       status: "error",
        //       message: "Failed to send email via Google.",
        //       error: sendErr?.response?.data || sendErr?.message || sendErr,
        //     });
        //   }
        // }

        if (provider === "google") {
            if (!user.googleConnected || !user.googleRefreshToken || !user.googleEmail) {
                return res.status(401).json({
                    status: "error",
                    message: "Google account not connected. Please connect your Google account before sending email.",
                });
            }

            const refreshToken = user.googleRefreshToken;
            const finalFrom = user.googleEmail;

            // Ensure fromEmail matches the connected Google account
            if (fromEmail && fromEmail.trim().toLowerCase() !== finalFrom.trim().toLowerCase()) {
                return res.status(400).json({
                    status: "error",
                    message: "Provided fromEmail does not match the connected Google account.",
                });
            }

            // Create OAuth2 client
            const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
            oAuth2Client.setCredentials({ refresh_token: refreshToken });

            // Validate refresh token by attempting to get a fresh access token
            let accessToken;
            try {
                const tokenResponse = await oAuth2Client.getAccessToken();
                accessToken = tokenResponse?.token || tokenResponse;
                if (!accessToken) throw new Error("Failed to obtain Google access token.");
            } catch (err) {
                console.error("Google token refresh error:", err);
                user.googleConnected = false;
                user.googleRefreshToken = null;
                user.googleAccessToken = null;
                await user.save();
                return res.status(401).json({
                    status: "error",
                    message: "Google authentication failed. Please reconnect your Google account.",
                    error: err?.message || err,
                });
            }

            try {
                // Use Gmail API instead of SMTP
                const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

                const messageParts = [
                    `From: ${finalFrom}`,
                    `To: ${to}`,
                    `Subject: ${subject}`,
                    "MIME-Version: 1.0",
                    "Content-Type: text/html; charset=UTF-8",
                    "",
                    html || text || "",
                ];

                const message = messageParts.join("\n");
                const encodedMessage = Buffer.from(message)
                    .toString("base64")
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_")
                    .replace(/=+$/, "");

                await gmail.users.messages.send({
                    userId: "me",
                    requestBody: { raw: encodedMessage },
                });

                return res.status(200).json({
                    status: "success",
                    message: "Email Sent",
                });
            } catch (sendErr) {
                console.error("Gmail API send error:", sendErr?.response?.data || sendErr?.message || sendErr);

                const errMsg = sendErr?.message || sendErr;
                if (String(errMsg).toLowerCase().includes("invalid") || String(errMsg).toLowerCase().includes("auth")) {
                    user.googleConnected = false;
                    user.googleRefreshToken = null;
                    user.googleAccessToken = null;
                    await user.save();
                    return res.status(401).json({
                        status: "error",
                        message: "Google authentication failed while sending. Please reconnect your Google account.",
                        error: errMsg,
                    });
                }

                return res.status(500).json({
                    status: "error",
                    message: "Failed to send email via Google.",
                    error: sendErr?.response?.data || sendErr?.message || sendErr,
                });
            }
        }

        // ---------- MICROSOFT ----------
        else if (provider === "microsoft") {
            if (!user.microsoftConnected || !user.microsoftAccessToken || !user.microsoftEmail) {
                return res.status(401).json({
                    status: "error",
                    message: "Microsoft account not connected. Please connect your Microsoft account before sending email.",
                });
            }

            // If client provides fromEmail, ensure it matches
            if (fromEmail && fromEmail.trim().toLowerCase() !== user.microsoftEmail.trim().toLowerCase()) {
                return res.status(400).json({
                    status: "error",
                    message: "Provided fromEmail does not match the connected Microsoft account.",
                });
            }

            const finalAccessToken = user.microsoftAccessToken;
            const finalFrom = user.microsoftEmail;

            // Validate token first
            try {
                await axios.get("https://graph.microsoft.com/v1.0/me", {
                    headers: { Authorization: `Bearer ${finalAccessToken}` },
                });
            } catch (err) {
                console.error("Microsoft token validation error:", err?.response?.data || err?.message || err);

                // Clear stored Microsoft token/connection
                try {
                    user.microsoftConnected = false;
                    user.microsoftAccessToken = null;
                    await user.save();
                } catch (saveErr) {
                    console.error("Failed to clear microsoft tokens in DB:", saveErr);
                }

                return res.status(401).json({
                    status: "error",
                    message: "Microsoft authentication failed or token expired. Please reconnect your Microsoft account.",
                    error: err?.response?.data || err?.message || err,
                });
            }

            // Build payload and send
            const emailContent = {
                message: {
                    subject,
                    body: {
                        contentType: html ? "HTML" : "Text",
                        content: html || text || "",
                    },
                    toRecipients: [{ emailAddress: { address: to } }],
                    from: { emailAddress: { address: finalFrom } },
                },
                saveToSentItems: true,
            };

            try {
                await axios.post("https://graph.microsoft.com/v1.0/me/sendMail", emailContent, {
                    headers: { Authorization: `Bearer ${finalAccessToken}`, "Content-Type": "application/json" },
                });

                return res.status(200).json({ status: "success", message: "Email Sent" });
            } catch (sendErr) {
                console.error("Microsoft sendMail error:", sendErr?.response?.data || sendErr?.message || sendErr);

                // If token invalid, clear and return 401
                const status = sendErr?.response?.status;
                if (status === 401 || status === 403) {
                    try {
                        user.microsoftConnected = false;
                        user.microsoftAccessToken = null;
                        await user.save();
                    } catch (saveErr) {
                        console.error("Failed to clear microsoft tokens after send error:", saveErr);
                    }

                    return res.status(401).json({
                        status: "error",
                        message: "Microsoft authentication failed while sending. Please reconnect your Microsoft account.",
                        error: sendErr?.response?.data || sendErr?.message || sendErr,
                    });
                }

                return res.status(500).json({
                    status: "error",
                    message: "Failed to send email via Microsoft.",
                    error: sendErr?.response?.data || sendErr?.message || sendErr,
                });
            }
        }

        // ---------- SMTP ----------
        else if (provider === "smtp") {
            if (!user.smtpConnected) {
                return res.status(401).json({
                    status: "error",
                    message: "SMTP not connected for this user. Please connect your SMTP account before sending email.",
                });
            }
            if (!user.smtpHost || !user.smtpPort || !user.smtpUser || !user.smtpPass) {
                return res.status(400).json({ status: "error", message: "Incomplete SMTP configuration on the server for this user." });
            }

            // fromEmail must match smtp user (prevent arbitrary from)
            if (fromEmail && fromEmail.trim().toLowerCase() !== String(user.smtpUser).trim().toLowerCase()) {
                return res.status(400).json({
                    status: "error",
                    message: "Provided fromEmail does not match the connected SMTP user. Use the SMTP account email or reconnect SMTP.",
                });
            }

            const transporter = nodemailer.createTransport({
                host: user.smtpHost,
                port: user.smtpPort,
                secure: !!user.smtpSecure,
                auth: { user: user.smtpUser, pass: user.smtpPass },
            });

            // verify first
            try {
                await transporter.verify();
            } catch (verifyErr) {
                console.error("SMTP verify error:", verifyErr?.response || verifyErr?.message || verifyErr);
                // Clear SMTP connection
                try {
                    user.smtpConnected = false;
                    await user.save();
                } catch (saveErr) {
                    console.error("Failed to clear smtpConnected in DB:", saveErr);
                }
                return res.status(401).json({
                    status: "error",
                    message: "SMTP authentication failed. Please reconnect or check SMTP credentials on the web dashboard.",
                    error: verifyErr?.message || verifyErr,
                });
            }

            const mailOptions = {
                from: `"Contacts Management" <${user.smtpUser}>`,
                to,
                subject,
                text: text || "",
                html: html || "",
            };

            try {
                await transporter.sendMail(mailOptions);
                return res.status(200).json({ status: "success", message: "Email Sent." });
            } catch (sendErr) {
                console.error("SMTP sendMail error:", sendErr?.response || sendErr?.message || sendErr);
                // If auth error, clear smtpConnected
                if (String(sendErr?.message || "").toLowerCase().includes("auth")) {
                    try {
                        user.smtpConnected = false;
                        await user.save();
                    } catch (saveErr) {
                        console.error("Failed to clear smtpConnected after send failure:", saveErr);
                    }
                    return res.status(401).json({
                        status: "error",
                        message: "SMTP authentication failed while sending. Please reconnect or re-enter credentials.",
                        error: sendErr?.message || sendErr,
                    });
                }
                return res.status(500).json({
                    status: "error",
                    message: "Failed to send email via SMTP.",
                    error: sendErr?.response?.data || sendErr?.message || sendErr,
                });
            }
        }

        // Unknown provider
        else {
            return res.status(400).json({ status: "error", message: "Invalid emailProvider. Allowed: google, microsoft, smtp." });
        }
    } catch (outerErr) {
        console.error("Send Email Error (outer):", outerErr);
        return res.status(500).json({
            status: "error",
            message: "Failed to send email due to an internal error.",
            error: outerErr?.message || outerErr,
        });
    }
};