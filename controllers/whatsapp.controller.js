const axios = require("axios");
const User = require("../models/userModel");
const mongoose = require("mongoose");
const { META_GRAPH_URL } = require("../config/whatsapp");
const WsConnection = require("../models/wsConnection");
const WhatsAppMessage = require("../models/whatsappMessage");
const WabaTemplate = require("../models/wabaTemplateModel");
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
function parseWhatsAppMessage(msg) {
    const messageType = msg.type;
    let content = {};

    // 🔹 TEXT
    if (messageType === "text") {
        content.text = msg.text?.body;
    }

    // 🔹 MEDIA (image, video, audio, document, sticker, voice)
    if (
        ["image", "video", "audio", "document", "sticker", "voice"].includes(messageType)
    ) {
        const media = msg[messageType];

        content.mediaId = media?.id;
        content.mimeType = media?.mime_type;
        content.caption = media?.caption || "";
        content.sha256 = media?.sha256;

        // document only
        if (messageType === "document") {
            content.fileName = media?.filename;
        }

        // voice / audio
        if (messageType === "voice" || messageType === "audio") {
            content.isVoice = messageType === "voice";
            content.duration = media?.duration;
        }
    }

    // 🔹 CONTACTS ✅ (THIS IS YOUR ISSUE)
    if (messageType === "contacts") {
        content.contacts = msg.contacts || [];
    }

    // 🔹 LOCATION
    if (messageType === "location") {
        content.latitude = msg.location?.latitude;
        content.longitude = msg.location?.longitude;
        content.address = msg.location?.address;
        content.name = msg.location?.name;
    }

    // 🔹 INTERACTIVE (buttons / list)
    if (messageType === "interactive") {
        content.interactiveType = msg.interactive?.type;

        if (msg.interactive?.button_reply) {
            content.interactiveId = msg.interactive.button_reply.id;
            content.interactiveTitle = msg.interactive.button_reply.title;
        }

        if (msg.interactive?.list_reply) {
            content.interactiveId = msg.interactive.list_reply.id;
            content.interactiveTitle = msg.interactive.list_reply.title;
        }
    }

    // 🔹 TEMPLATE MESSAGE
    if (messageType === "template") {
        content.templateName = msg.template?.name;
        content.templateLanguage = msg.template?.language?.code;
        content.templateParams =
            msg.template?.components?.flatMap(c => c.parameters) || [];
    }

    return { messageType, content };
}

function getAttachmentName(msg, mimeType) {
    const ext = mimeType?.split("/")[1] || "bin";

    switch (msg.type) {
        case "document":
            return msg.document?.filename || `document_${Date.now()}.${ext}`;

        case "image":
            return `image_${Date.now()}.${ext}`;

        case "video":
            return `video_${Date.now()}.${ext}`;

        case "audio":
            return `audio_${Date.now()}.${ext}`;

        case "voice":
            return `voice_${Date.now()}.ogg`;

        case "sticker":
            return `sticker_${Date.now()}.webp`;

        default:
            return `file_${Date.now()}.${ext}`;
    }
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
            let attachmentName = "";
            let mimeType = "";
            let fileSize = 0;

            if (content.mediaId) {
                // const { buffer, mimeType } = await downloadMetaMedia({
                //     mediaId: content.mediaId,
                //     accessToken: user.whatsappWaba.accessToken
                // });

                const downloaded = await downloadMetaMedia({
                    mediaId: content.mediaId,
                    accessToken: user.whatsappWaba.accessToken
                });

                mimeType = downloaded.mimeType;
                fileSize = downloaded.buffer.length;

                attachmentName = getAttachmentName(msg, mimeType);

                // const s3Url = await uploadWhatsAppMediaToS3({
                //     userId: user._id,
                //     messageType,
                //     buffer,
                //     mimeType
                // });

                const s3Url = await uploadWhatsAppMediaToS3({
                    userId: user._id,
                    messageType,
                    buffer: downloaded.buffer,
                    mimeType,
                    originalName: attachmentName
                });

                s3dataurl = s3Url; // ✅ THIS is gold
                // enrich content (VERY IMPORTANT)
                content.mimeType = mimeType;
                content.fileName = attachmentName;
                content.fileSize = fileSize;
                content.mediaUrl = s3Url;
                content.sha256 = msg[messageType]?.sha256;
                content.isVoice = msg.type === "voice";
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
                attachmentName: attachmentName,
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
                attachmentName,
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

        // let mediaId = null;
        let mediaId = null;
        let s3dataurl = "";
        let mimeType = null;
        let fileSize = null;
        let attachmentName = "";

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

            // 🔥 NEW: upload same file to S3
            s3dataurl = await uploadWhatsAppMediaToS3({
                userId,
                messageType: type,
                buffer: file.buffer,
                mimeType: file.mimetype,
                originalName: file.originalname
            });

            mimeType = file.mimetype;
            fileSize = file.size;
            console.log("s3dataurl", s3dataurl);

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

        attachmentName = file?.originalname || "";

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
            s3dataurl: s3dataurl,
            attachmentName: attachmentName,
            content: {
                text,
                mediaId,
                fileSize,
                mimeType: mimeType,
                fileName: attachmentName,
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
            status: "success",
            mediaId,            // 👈 optional, useful
            metaMessageId,
            message: "Message sent successfully",
            s3dataurl,
            attachmentName: attachmentName,
            fileSize,
            data: response.data
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
};

function resolveTemplate(template, params) {
    let headerText = "";
    let bodyText = "";
    let buttons = [];

    for (const component of template.components) {

        // HEADER
        if (component.type === "HEADER" && component.text) {
            headerText = component.text;
            if (params.header?.length) {
                params.header.forEach((val, i) => {
                    headerText = headerText.replace(`{{${i + 1}}}`, val);
                });
            }
        }

        // BODY (NAMED PARAMS)
        if (component.type === "BODY" && component.text) {
            bodyText = component.text;

            if (component.example?.body_text_named_params?.length) {
                component.example.body_text_named_params.forEach(p => {
                    bodyText = bodyText.replace(
                        `{{${p.param_name}}}`,
                        params.body?.[p.param_name] ?? ""
                    );
                });
            }
        }

        // BUTTONS
        if (component.type === "BUTTONS") {
            buttons = component.buttons || [];
        }
    }

    return {
        header: headerText,
        body: bodyText,
        buttons,
    };
}
/**
 * SEND WHATSAPP TEMPLATE MESSAGE (FINAL & SAFE)
 */
exports.sendTemplateMessage = async (req, res) => {
    console.log("\n========== SEND TEMPLATE MESSAGE START ==========");

    try {
        const { to, templateId, name, params = {} } = req.body;
        const userId = req.user._id;

        /* ───────── BASIC VALIDATION ───────── */
        if (!to || !templateId) {
            return res.status(400).json({
                success: false,
                message: "`to` and `templateId` are required",
            });
        }

        /* ───────── USER / WABA ───────── */
        const user = await User.findById(userId);
        if (!user?.whatsappWaba) {
            return res.status(400).json({
                success: false,
                message: "WhatsApp WABA not connected",
            });
        }

        const { phoneNumberId, accessToken, wabaId, phoneNumber } = user.whatsappWaba;

        console.log("🔑 WABA DETAILS", {
            phoneNumberId,
            wabaId,
            hasToken: !!accessToken,
        });

        /* ───────── TEMPLATE FETCH ───────── */
        const template = await WabaTemplate.findOne({
            _id: templateId,
            user: userId,
            status: "APPROVED",
        });

        if (!template) {
            return res.status(404).json({
                success: false,
                message: "Approved template not found",
            });
        }

        console.log("📄 TEMPLATE FOUND", {
            name: template.name,
            language: template.language,
            templateWabaId: template.wabaId,
        });

        /* 🔥 CRITICAL SAFETY CHECK */
        if (String(template.wabaId) !== String(wabaId)) {
            throw new Error(
                "Template WABA ID does not match sender WABA ID"
            );
        }

        /* ───────── BUILD COMPONENTS ───────── */
        const components = [];

        for (const component of template.components) {

            /* ───── BODY COMPONENT ───── */
            if (component.type === "BODY") {

                const namedParams =
                    component.example?.body_text_named_params || [];

                const positionalParams =
                    component.example?.body_text || [];

                // 🔹 Named params (your template case)
                if (namedParams.length) {

                    if (!Array.isArray(params.body)) {
                        throw new Error("params.body must be ARRAY");
                    }

                    if (params.body.length !== namedParams.length) {
                        throw new Error(
                            `Expected ${namedParams.length} body params, got ${params.body.length}`
                        );
                    }

                    components.push({
                        type: "body",
                        parameters: namedParams.map((metaParam, index) => ({
                            type: "text",
                            parameter_name: metaParam.param_name, // 🔥 REQUIRED
                            text: String(params.body[index]),
                        })),
                    });
                }

                // 🔹 Positional params
                else if (positionalParams.length) {

                    if (!Array.isArray(params.body)) {
                        throw new Error("params.body must be ARRAY");
                    }

                    components.push({
                        type: "body",
                        parameters: params.body.map(val => ({
                            type: "text",
                            text: String(val),
                        })),
                    });
                }
            }

            /* ───── HEADER (TEXT ONLY) ───── */
            if (component.type === "HEADER" && component.format === "TEXT") {

                const headerVars =
                    (component.text?.match(/{{\d+}}/g) || []).length;

                if (headerVars > 0) {
                    if (!Array.isArray(params.header)) {
                        throw new Error("params.header must be ARRAY");
                    }

                    if (params.header.length !== headerVars) {
                        throw new Error(
                            `Expected ${headerVars} header params, got ${params.header.length}`
                        );
                    }

                    components.push({
                        type: "header",
                        parameters: params.header.map(val => ({
                            type: "text",
                            text: String(val),
                        })),
                    });
                }
            }

            /* ───── BUTTONS ───── */
            if (component.type === "BUTTONS" && params.buttons?.length) {
                params.buttons.forEach((btn, index) => {
                    components.push({
                        type: "button",
                        sub_type: btn.type || "quick_reply",
                        index: String(index),
                        parameters:
                            btn.type === "url"
                                ? [{ type: "text", text: btn.value }]
                                : [{ type: "payload", payload: btn.payload }],
                    });
                });
            }
        }

        /* ───────── META PAYLOAD ───────── */
        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: template.name,
                language: { code: template.language },
                components,
            },
        };

        console.log("📤 META PAYLOAD");
        console.dir(payload, { depth: null });

        /* ───────── SEND TO META ───────── */
        const response = await axios.post(
            `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
            }
        );

        console.log("✅ META RESPONSE", response.data);


        const resolvedTemplate = resolveTemplate(template, params);
        console.log("Resolved template preview:", resolvedTemplate);

        const metaMessageId = response.data?.messages?.[0]?.id;
        const message = response.data?.messages?.[0] || {};

        /* ───────────── SAVE MESSAGE ───────────── */
        await WhatsAppMessage.create({
            userId,
            phoneNumberId,
            conversationId: to,
            senderName: name || to,
            senderWabaId: wabaId,
            direction: "outgoing",
            from: phoneNumber,
            to,
            messageType: "template",

            content: {
                template: {
                    name: template.name,
                    language: template.language,

                    // FULL TEMPLATE FROM DB
                    components: template.components,

                    // VALUES USED
                    params,

                    // FINAL USER-VISIBLE MESSAGE
                    resolved: resolvedTemplate,
                },
            },

            metaMessageId,
            status: "sent",
            messageTimestamp: new Date(),
            raw: response.data,
        });


        return res.json({
            success: true,
            message: "Template message sent successfully",
            metaMessageId: response.data?.messages?.[0]?.id,
            payload,
            data: response.data,
        });

    } catch (error) {
        console.error("❌ SEND TEMPLATE ERROR");
        console.dir(error.response?.data || error.message, { depth: null });

        return res.status(400).json({
            success: false,
            message:
                error.response?.data?.error?.message ||
                error.message ||
                "Failed to send template",
        });
    } finally {
        console.log("========== SEND TEMPLATE MESSAGE END ==========\n");
    }
};

/**
 * STEP 7: Get WhatsApp Conversations
 */
exports.getWhatsappConversations = async (req, res) => {
    try {
        const userId = req.user._id;
        const type = req.body.type || "history"; // chats | history

        const now = new Date();
        const before24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const conversations = await WhatsAppMessage.aggregate([
            /* 1️⃣ Only current user */
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
                },
            },

            /* 2️⃣ Latest messages first */
            {
                $sort: { messageTimestamp: -1 },
            },

            /* 3️⃣ Group by conversation */
            {
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
                            s3dataurl: "$s3dataurl",
                            messageType: "$messageType",
                            content: "$content",
                            status: "$status",
                            messageTimestamp: "$messageTimestamp",
                        },
                    },

                    /* collect only incoming timestamps */
                    incomingTimestamps: {
                        $push: {
                            $cond: [
                                { $eq: ["$direction", "incoming"] },
                                "$messageTimestamp",
                                null,
                            ],
                        },
                    },
                },
            },

            /* 4️⃣ Get last incoming message time */
            {
                $addFields: {
                    lastIncomingMessageTime: {
                        $max: {
                            $filter: {
                                input: "$incomingTimestamps",
                                as: "ts",
                                cond: { $ne: ["$$ts", null] },
                            },
                        },
                    },
                },
            },

            /* 5️⃣ FINAL lastMessageTime (incoming → fallback outgoing) */
            {
                $addFields: {
                    lastMessageTime: {
                        $ifNull: [
                            "$lastIncomingMessageTime",
                            { $max: "$messages.messageTimestamp" },
                        ],
                    },

                    hasIncoming: {
                        $gt: [
                            {
                                $size: {
                                    $filter: {
                                        input: "$incomingTimestamps",
                                        as: "ts",
                                        cond: { $ne: ["$$ts", null] },
                                    },
                                },
                            },
                            0,
                        ],
                    },
                },
            },

            /* 6️⃣ Oldest → newest inside chat */
            {
                $addFields: {
                    messages: { $reverseArray: "$messages" },
                },
            },

            /* 7️⃣ Shape response */
            {
                $project: {
                    _id: 0,
                    from: 1,
                    lastMessageTime: 1,
                    hasIncoming: 1,
                    messages: 1,
                },
            },

            /* 8️⃣ Chats / History filter */
            ...(type === "chats"
                ? [{ $match: { lastMessageTime: { $gte: before24Hours } } }]
                : type === "history"
                    ? [{ $match: { lastMessageTime: { $lt: before24Hours } } }]
                    : []),

            /* 9️⃣ Latest conversation on top */
            {
                $sort: { lastMessageTime: -1 },
            },
        ]);

        res.json({
            success: true,
            message: "Chats received successfully",
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
