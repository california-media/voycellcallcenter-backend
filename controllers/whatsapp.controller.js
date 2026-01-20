const axios = require("axios");
const User = require("../models/userModel");
const mongoose = require("mongoose");
// const { emitMessage } = require("../socketServer");
const { META_GRAPH_URL } = require("../config/whatsapp");
const WsConnection = require("../models/wsConnection");
const WhatsAppMessage = require("../models/whatsappMessage");
const dotenv = require("dotenv");
dotenv.config();

const {
    META_APP_ID,
    META_APP_SECRET,
    META_WHATSAPP_REDIRECT_URI,
    WHATSAPP_VERIFY_TOKEN,
    FRONTEND_URL,
} = process.env;

/**
 * STEP 1: Redirect user to Meta (Connect WhatsApp)
 */
exports.connectWhatsApp = (req, res) => {
    const userId = req.user._id;

    const url =
        `https://www.facebook.com/v23.0/dialog/oauth?` +
        `client_id=${META_APP_ID}` +
        `&redirect_uri=${META_WHATSAPP_REDIRECT_URI}` +
        `&scope=business_management,whatsapp_business_management,whatsapp_business_messaging` +
        `&response_type=code` +
        `&state=${userId}`;

    // res.redirect(url);
    res.json({ status: 'success', url: url });
};

/**
 * STEP 2: OAuth Callback
 */
exports.whatsappCallback = async (req, res) => {
    try {
        const { code, state: userId } = req.query;

        // Exchange code for access token
        const tokenRes = await axios.get(
            `${META_GRAPH_URL}/oauth/access_token`,
            {
                params: {
                    client_id: META_APP_ID,
                    client_secret: META_APP_SECRET,
                    redirect_uri: META_WHATSAPP_REDIRECT_URI,
                    code,
                },
            }
        );

        console.log("tokenRes = " + tokenRes);


        const accessToken = tokenRes.data.access_token;

        console.log("accessToken = " + accessToken);

        // Get Business
        const businessRes = await axios.get(
            `${META_GRAPH_URL}/me/businesses`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        console.log("businessRes = " + businessRes);

        const businessAccountId = businessRes.data.data[0].id;

        console.log("businessAccountId = " + businessAccountId);

        // Get WABA
        const wabaRes = await axios.get(
            `${META_GRAPH_URL}/${businessAccountId}/owned_whatsapp_business_accounts`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        console.log("wabaRes = " + wabaRes);

        const wabaId = wabaRes.data.data[0].id;

        console.log("wabaId = " + wabaId);

        // Get Phone Number ID
        const phoneRes = await axios.get(
            `${META_GRAPH_URL}/${wabaId}/phone_numbers`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        console.log("phoneRes = " + phoneRes);

        const phoneNumberId = phoneRes.data.data[0].id;
        const phoneNumber = phoneRes.data.data[0].display_phone_number;
        console.log("phoneNumberId = " + phoneNumberId);
        console.log("phoneNumber = " + phoneNumber);

        // Save to user
        await User.findByIdAndUpdate(userId, {
            whatsappWaba: {
                isConnected: true,
                wabaId,
                phoneNumberId,
                phoneNumber, // 👈 VERY IMPORTANT
                businessAccountId,
                accessToken,
            },
        });

        // res.redirect(`${FRONTEND_URL}/settings/whatsapp?connected=true`);
        const resultData = {
            status: 'success',
            message: 'WhatsApp connected successfully',
            whatsappWaba: {
                isConnected: true,
                wabaId,
                phoneNumberId,
                phoneNumber, // 👈 VERY IMPORTANT
                businessAccountId,
                accessToken,
            }
        };

        // res.json({ status: 'success', message: 'Microsoft account connected', user });

        return res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Whatsapp Connected</title>
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
        <div class="success">Whatsapp account connected Successfully! You can close this window.</div>
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
        console.error("WhatsApp OAuth Error:", err.response?.data || err);
        // res.redirect(`${FRONTEND_URL}/settings/whatsapp?error=true`);
        return res.send(`
            <script>
                window.opener.postMessage({ status: 'error', message: 'WhatsApp OAuth failed', error: '${err.response?.data || err.message}' }, '*');
                window.close();
            </script>
        `);
    }
};

/**
 * STEP 3: Webhook verification
 */
exports.webhookVerify = (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
        console.log("Webhook verified");
        return res.status(200).send(challenge);
    }
    console.log("Invalid webhook verification");
    return res.sendStatus(403);
};


let isConnected = false;
async function connectDB() {
    if (isConnected) return;
    await mongoose.connect(process.env.MONGO_URL);
    isConnected = true;
}

const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const lambdaClient = new LambdaClient({
    region: "eu-north-1"
});

exports.webhookReceive = async (req, res) => {
    console.log("🔥🔥 WHATSAPP WEBHOOK HIT 🔥🔥");

    try {
        console.log("Forwarding raw payload to WABA Connect...");

        console.log("Invoked waba-connect successfully");
        console.log(responce);
        console.log(req.body);
        console.log(req.body.entry);

        const entry = req.body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;

        if (!value) {
            console.log("No value in webhook");
            return { statusCode: 200 };
        }

        console.log("value.metadata", value.metadata);
        const phoneNumberId = value?.metadata?.phone_number_id?.toString();
        console.log("phoneNumberId:", phoneNumberId);
        console.log("Webhook keys:", Object.keys(value));

        if (!Array.isArray(value.messages) || value.messages.length === 0) {
            console.log("ℹ️ No incoming messages");
            return { statusCode: 200 };
        }

        const user = await User.findOne({
            "whatsappWaba.phoneNumberId": phoneNumberId
        }).select("_id");

        if (!user) {
            console.warn("❌ No user for phoneNumberId:", phoneNumberId);
            return { statusCode: 200 };
        }

        console.log("✅ User found:", user._id);

        const connections = await WsConnection.find({ userId: user._id });

        console.log("connections", connections);

        if (connections.length === 0) {
            console.log("No active WebSocket connections for user:", user._id);
            return { statusCode: 200 };
        }

        for (const msg of value.messages || []) {
            console.log(`� New message from ${msg.from}`);
            // Save to permanent collection
            await WhatsAppMessage.create({
                userId: user._id,
                wabaId: entry.id,
                from: msg.from,
                message: msg,
                timestamp: msg.timestamp
            });

            const eventPayload = {
                whatsappEvent: req.body,          // full Meta webhook
                userId: user._id.toString(),      // user reference
                connections: connections.map(c => ({
                    connectionId: c.connectionId
                }))
            };

            const responce = await lambdaClient.send(new InvokeCommand({
                FunctionName: "waba-webhook",
                InvocationType: "RequestResponse",
                Payload: JSON.stringify(eventPayload)
            }));
            console.log("Invoked waba-webhook successfully");
            console.log(responce);
        }
        res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
        console.error("Webhook Error:", err);
        res.sendStatus(200);
    }
};


exports.sendTextMessage = async (req, res) => {
    console.log("========== SEND TEXT MESSAGE API START ==========");

    try {
        const { to, text } = req.body;
        const userId = req.user?._id;

        console.log("Request body:", { to, text });
        console.log("Authenticated userId:", userId);

        // 1️⃣ Basic validation
        if (!to || !text) {
            console.warn("Validation failed: 'to' or 'text' missing");
            return res.status(400).json({
                success: false,
                message: "'to' and 'text' are required",
            });
        }

        // 2️⃣ Fetch user
        console.log("Fetching user from DB...");
        const user = await User.findById(userId);

        if (!user) {
            console.error("User not found for userId:", userId);
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        const { phoneNumberId, accessToken } = user.whatsappWaba || {};

        console.log("WhatsApp WABA details:", {
            phoneNumberId,
            hasAccessToken: !!accessToken,
        });

        // 3️⃣ Validate WABA config
        if (!phoneNumberId || !accessToken) {
            console.error("WhatsApp WABA configuration missing");
            return res.status(400).json({
                success: false,
                message: "WhatsApp WABA is not configured for this user",
            });
        }

        // 4️⃣ Prepare request
        const url = `${META_GRAPH_URL}/${phoneNumberId}/messages`;

        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: text },
        };

        console.log("Sending WhatsApp message...");
        console.log("Meta API URL:", url);
        console.log("Payload:", payload);

        // 5️⃣ Send message
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
        });

        console.log("WhatsApp API response status:", response.status);
        console.log("WhatsApp API response data:", response.data);

        // 6️⃣ Success response
        res.json({
            success: true,
            message: "Message sent successfully",
            data: response.data,
        });

    } catch (error) {
        console.error("❌ Error while sending WhatsApp message");

        // Axios / Meta API error
        if (error.response) {
            console.error("Meta API error status:", error.response.status);
            console.error("Meta API error data:", error.response.data);

            return res.status(error.response.status).json({
                success: false,
                message: "Failed to send WhatsApp message",
                metaError: error.response.data,
            });
        }

        // Network / unknown error
        console.error("Unexpected error:", error.message);
        console.error(error.stack);

        res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    } finally {
        console.log("========== SEND TEXT MESSAGE API END ==========");
    }
};


/**
 * STEP 6: Send Template Message
 */

exports.sendTemplateMessage = async (req, res) => {
    console.log("========== SEND TEMPLATE MESSAGE API START ==========");

    try {
        const { to, templateName, language, components } = req.body;
        const userId = req.user?._id;

        console.log("Request body:", {
            to,
            templateName,
            language,
            components,
        });
        console.log("Authenticated userId:", userId);

        // 1️⃣ Validation
        if (!to || !templateName) {
            console.warn("Validation failed: 'to' or 'templateName' missing");
            return res.status(400).json({
                success: false,
                message: "'to' and 'templateName' are required",
            });
        }

        // 2️⃣ Fetch user
        console.log("Fetching user from DB...");
        const user = await User.findById(userId);

        if (!user) {
            console.error("User not found for userId:", userId);
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        const { phoneNumberId, accessToken } = user.whatsappWaba || {};

        console.log("WhatsApp WABA details:", {
            phoneNumberId,
            hasAccessToken: !!accessToken,
        });

        // 3️⃣ Validate WABA config
        if (!phoneNumberId || !accessToken) {
            console.error("WhatsApp WABA configuration missing");
            return res.status(400).json({
                success: false,
                message: "WhatsApp WABA is not configured for this user",
            });
        }

        // 4️⃣ Prepare Meta request
        const url = `${META_GRAPH_URL}/${phoneNumberId}/messages`;

        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: language || "en_US",
                },
                components: components || [],
            },
        };

        console.log("Meta API URL:", url);
        console.log("Payload:", JSON.stringify(payload, null, 2));

        // 5️⃣ Send request
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
        });

        console.log("WhatsApp API response status:", response.status);
        console.log("WhatsApp API response data:", response.data);

        // 6️⃣ Success response
        res.json({
            success: true,
            message: "Template message sent successfully",
            data: response.data,
        });

    } catch (error) {
        console.error("❌ Error while sending template message");

        if (error.response) {
            console.error("Meta API error status:", error.response.status);
            console.error("Meta API error data:", error.response.data);

            return res.status(error.response.status).json({
                success: false,
                message: "Failed to send template message",
                metaError: error.response.data,
            });
        }

        console.error("Unexpected error:", error.message);
        console.error(error.stack);

        res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    } finally {
        console.log("========== SEND TEMPLATE MESSAGE API END ==========");
    }
};