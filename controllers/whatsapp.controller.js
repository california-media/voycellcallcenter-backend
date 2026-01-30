const axios = require("axios");
const User = require("../models/userModel");
const mongoose = require("mongoose");
// const { emitMessage } = require("../socketServer");
const { META_GRAPH_URL } = require("../config/whatsapp");
const WsConnection = require("../models/wsConnection");
const WhatsAppMessage = require("../models/whatsappMessage");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const { downloadMetaMedia } = require("../services/metaMedia");
const { uploadWhatsAppMediaToS3 } = require("../utils/uploadWhatsAppMedia");
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

/** STEP 4: Webhook to receive messages
 */
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

// Initialize AWS Lambda client 
const lambdaClient = new LambdaClient({
    region: "eu-north-1"
});

/** Helper: Normalize WhatsApp number
 */
function normalizeWhatsAppNumber(waId) {
    // Example: 917046658651 → countryCode: 91, number: 7046658651
    return {
        countryCode: waId.slice(0, 2),
        number: waId.slice(2)
    };
}

/** Helper: Find name from CRM (Contact/Lead) based on WhatsApp ID
 */
async function findNameFromCRM({ userId, role, waId }) {

    console.log("findNameFromCRM userId", userId);
    console.log("findNameFromCRM role", role);
    console.log("findNameFromCRM waId", waId);

    const { countryCode, number } = normalizeWhatsAppNumber(waId);

    // 🔹 Query helper
    const phoneQuery = {
        phoneNumbers: {
            $elemMatch: {
                countryCode,
                number
            }
        }
    };

    // ==============================
    // 👤 AGENT FLOW
    // ==============================
    if (role === "user") {
        const contact =
            await Contact.findOne({ ...phoneQuery, createdBy: userId }) ||
            await Lead.findOne({ ...phoneQuery, createdBy: userId });

        if (contact) {
            return `${contact.firstname || ""} ${contact.lastname || ""}`.trim();
        }

        return null;
    }

    // ==============================
    // 👑 COMPANY ADMIN FLOW
    // ==============================
    if (role === "companyAdmin") {
        // 1️⃣ Check admin’s own contacts/leads
        let record =
            await Contact.findOne({ ...phoneQuery, createdBy: userId }) ||
            await Lead.findOne({ ...phoneQuery, createdBy: userId });

        if (record) {
            return `${record.firstname || ""} ${record.lastname || ""}`.trim();
        }

        console.log("record is found in company admin", record);


        // 2️⃣ Check agents under this admin
        const agentIds = await User.find(
            { createdByWhichCompanyAdmin: userId },
            { _id: 1 }
        ).lean();

        const agentIdList = agentIds.map(a => a._id);

        console.log("agentIdList of this company admin", agentIdList);


        record =
            await Contact.findOne({
                ...phoneQuery,
                createdBy: { $in: agentIdList }
            }) ||
            await Lead.findOne({
                ...phoneQuery,
                createdBy: { $in: agentIdList }
            });

        console.log("record found in its company admin agent", record);

        if (record) {
            return `${record.firstname || ""} ${record.lastname || ""}`.trim();
        }
    }

    return null;
}

/** Helper: Parse WhatsApp message content
 */
// function parseWhatsAppMessage(msg) {
//     let messageType = msg.type;
//     let content = {};

//     switch (msg.type) {
//         case "text":
//             content.text = msg.text?.body || "";
//             break;

//         case "image":
//             content = {
//                 mediaId: msg.image.id,
//                 caption: msg.image.caption || "",
//                 mimeType: msg.image.mime_type,
//                 sha256: msg.image.sha256
//             };
//             break;

//         case "video":
//             content = {
//                 mediaId: msg.video.id,
//                 caption: msg.video.caption || "",
//                 mimeType: msg.video.mime_type
//             };
//             break;

//         case "audio":
//             content = {
//                 mediaId: msg.audio.id,
//                 mimeType: msg.audio.mime_type,
//                 voice: msg.audio.voice || false
//             };
//             break;

//         case "document":
//             content = {
//                 mediaId: msg.document.id,
//                 filename: msg.document.filename,
//                 mimeType: msg.document.mime_type
//             };
//             break;

//         case "sticker":
//             content = {
//                 mediaId: msg.sticker.id,
//                 animated: msg.sticker.animated
//             };
//             break;

//         case "contacts":
//             content = {
//                 contacts: msg.contacts
//             };
//             break;

//         case "location":
//             content = {
//                 latitude: msg.location.latitude,
//                 longitude: msg.location.longitude,
//                 address: msg.location.address,
//                 name: msg.location.name
//             };
//             break;

//         default:
//             content = { raw: msg };
//     }

//     return { messageType, content };
// }
function parseWhatsAppMessage(msg) {
    const messageType = msg.type;
    let content = {};

    if (msg[messageType]?.id) {
        content.mediaId = msg[messageType].id;
        content.mimeType = msg[messageType].mime_type;
        content.caption = msg[messageType].caption || "";
    }

    if (messageType === "text") {
        content.text = msg.text.body;
    }

    return { messageType, content };
}


/** STEP 4: Webhook to receive messages
 */
exports.webhookReceive = async (req, res) => {
    console.log("🔥🔥 WHATSAPP WEBHOOK HIT 🔥🔥");

    try {
        console.log("Forwarding raw payload to WABA Connect...");

        console.log("Invoked waba-connect successfully");
        console.log(req.body);
        console.log(req.body.entry);

        const entry = req.body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;

        console.log("change", value.contacts);

        const contact = value.contacts?.[0];
        let senderName = "";
        let senderWabaID = "";

        if (contact) {
            senderName = contact.profile?.name || "";
            senderWabaID = contact.wa_id || "";
        }

        console.log("Sender Name:", senderName);
        console.log("Sender WA ID:", senderWabaID);

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
        });

        if (!user) {
            console.warn("❌ No user for phoneNumberId:", phoneNumberId);
            return { statusCode: 200 };
        }

        console.log("✅ User found:", user._id);

        console.log("full user", user);


        const crmName = await findNameFromCRM({
            userId: user._id,
            role: user.role,
            waId: senderWabaID
        });

        // ✅ Final senderName decision
        const finalSenderName = crmName || senderName;

        console.log("Final Sender Name:", finalSenderName);

        const connections = await WsConnection.find({ userId: user._id });

        console.log("connections", connections);

        if (connections.length === 0) {
            console.log("No active WebSocket connections for user:", user._id);
            return { statusCode: 200 };
        }

        for (const msg of value.messages || []) {
            console.log(`� New message from ${msg.from}`);
            // Save to permanent collection
            // await WhatsAppMessage.create({
            //     userId: user._id,
            //     phoneNumberId: phoneNumberId,
            //     from: msg.from,
            //     message: msg,
            //     timestamp: msg.timestamp
            // });

            const { messageType, content } = parseWhatsAppMessage(msg);
            console.log("content.mediaId", content.mediaId);

            let s3dataurl = "";

            if (content.mediaId) {
                const { buffer, mimeType } = await downloadMetaMedia({
                    mediaId: content.mediaId,
                    accessToken: user.whatsappWaba.accessToken
                });

                const s3Url = await uploadWhatsAppMediaToS3({
                    userId: user._id,
                    messageType,
                    buffer,
                    mimeType
                });

                s3dataurl = s3Url; // ✅ THIS is gold
                console.log("final content", content);
            }

            await WhatsAppMessage.create({
                userId: user._id,
                phoneNumberId,
                conversationId: msg.from,
                senderName: finalSenderName,
                senderWabaId: senderWabaID,
                direction: "incoming",
                from: msg.from,
                to: phoneNumberId,
                // messageType: "text",
                // content: {
                //     text: msg.text.body
                // },
                messageType,
                content,
                s3dataurl,
                metaMessageId: msg.id,
                status: "received",
                messageTimestamp: new Date(msg.timestamp * 1000),
                raw: msg
            });

            const eventPayload = {
                whatsappEvent: req.body,          // full Meta webhook
                userId: user._id.toString(),      // user reference
                finalSenderName: finalSenderName,
                s3dataurl,
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

/** STEP 5: Send Text Message
 */
exports.sendTextMessage = async (req, res) => {
    console.log("========== SEND TEXT MESSAGE API START ==========");

    try {
        const { to, text, name } = req.body;
        const userId = req.user?._id;

        console.log("Request body:", { to, text, name });
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
        console.log("response.data.messages", response);

        // 6️⃣ Extract Meta message ID
        const metaMessageId = response.data?.messages?.[0]?.id || null;

        // 7️⃣ Save outgoing message in DB
        await WhatsAppMessage.create({
            userId: user._id,
            phoneNumberId,
            conversationId: to,              // chat grouping
            senderName: name || to, // business name/number
            direction: "outgoing",
            from: user.whatsappWaba.phoneNumber, // business number
            to,
            messageType: "text",
            content: {
                text: text
            },
            metaMessageId,
            status: "sent",
            messageTimestamp: new Date(),
            raw: response.data
        });

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

/** STEP 6: Upload Media
 */

/** Helper: Build WhatsApp message payload
 */
function buildWhatsAppPayload({ to, type, text, mediaId, caption, filename }) {
    const base = {
        messaging_product: "whatsapp",
        to,
        type
    };

    switch (type) {
        case "text":
            return {
                ...base,
                text: { body: text }
            };

        case "image":
            return {
                ...base,
                image: { id: mediaId, caption }
            };

        case "video":
            return {
                ...base,
                video: { id: mediaId, caption }
            };

        case "audio":
            return {
                ...base,
                audio: { id: mediaId }
            };

        case "document":
            return {
                ...base,
                document: {
                    id: mediaId,
                    caption,
                    filename // ✅ THIS FIXES "Untitled"
                }
            };

        case "sticker":
            return {
                ...base,
                sticker: { id: mediaId }
            };

        default:
            throw new Error("Unsupported message type");
    }
}


const fs = require("fs");
const FormData = require("form-data");

exports.sendMessage = async (req, res) => {
    try {
        const { to, type, text, caption, name } = req.body;
        const file = req.file; // multer
        const userId = req.user._id;

        if (!to || !type) {
            return res.status(400).json({ success: false, message: "to & type required" });
        }

        const user = await User.findById(userId);
        const { phoneNumberId, accessToken, phoneNumber } = user.whatsappWaba;

        let mediaId = null;

        // 🔹 STEP 1: Upload media if NOT text
        if (type !== "text") {
            if (!file) {
                return res.status(400).json({
                    success: false,
                    message: "File required for media message"
                });
            }

            const form = new FormData();
            // form.append("file", fs.createReadStream(file.path));
            form.append("file", file.buffer, {
                filename: file.originalname,
                contentType: file.mimetype
            });
            form.append("type", file.mimetype);
            form.append("messaging_product", "whatsapp");

            const uploadRes = await axios.post(
                `${META_GRAPH_URL}/${phoneNumberId}/media`,
                form,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        ...form.getHeaders()
                    }
                }
            );

            mediaId = uploadRes.data.id;
        }

        // 🔹 STEP 2: Build payload
        const payload = buildWhatsAppPayload({
            to,
            type,
            text,
            mediaId,
            caption,
            filename: file?.originalname // 👈 THIS IS KEY
        });

        // 🔹 STEP 3: Send message
        const response = await axios.post(
            `${META_GRAPH_URL}/${phoneNumberId}/messages`,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const metaMessageId = response.data?.messages?.[0]?.id;

        // 🔹 STEP 4: Save to DB
        await WhatsAppMessage.create({
            userId,
            phoneNumberId,
            conversationId: to,
            senderName: name || phoneNumber,
            direction: "outgoing",
            from: phoneNumber,
            to,
            messageType: type,
            content: {
                text,
                mediaId,
                caption
            },
            metaMessageId,
            status: "sent",
            messageTimestamp: new Date(),
            raw: response.data
        });

        // 🔹 cleanup temp file
        if (file?.path) fs.unlinkSync(file.path);

        res.json({
            success: true,
            mediaId,            // 👈 optional, useful
            metaMessageId
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
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

/** STEP 7: Get WhatsApp Conversations
 */
exports.getWhatsappConversations = async (req, res) => {
    try {
        const userId = req.user._id;

        const conversations = await WhatsAppMessage.aggregate([
            {
                // 1️⃣ Only this user's messages
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
                },
            },

            {
                // 2️⃣ Sort messages inside conversation
                $sort: { messageTimestamp: 1 },
            },

            {
                // 3️⃣ Group by conversation (customer number)
                $group: {
                    _id: "$conversationId",
                    from: { $first: "$conversationId" },
                    messages: {
                        $push: {
                            _id: "$_id",
                            direction: "$direction",
                            from: "$from",
                            to: "$to",
                            senderName: "$senderName",
                            senderWabaId: "$senderWabaId",
                            messageType: "$messageType",
                            content: "$content",
                            status: "$status",
                            messageTimestamp: "$messageTimestamp",
                        },
                    },
                },
            },

            {
                // 4️⃣ Rename fields
                $project: {
                    _id: 0,
                    from: 1,
                    messages: 1,
                },
            },

            {
                // 5️⃣ Latest conversation on top
                $sort: {
                    "messages.messageTimestamp": -1,
                },
            },
        ]);

        res.json({
            status: "success",
            message: "chats received",
            data: conversations,
        });
    } catch (error) {
        console.error("❌ Get WhatsApp conversations error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch conversations",
        });
    }
};