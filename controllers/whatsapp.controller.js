const axios = require("axios");
const User = require("../models/userModel");
const mongoose = require("mongoose");
const { META_GRAPH_URL } = require("../config/whatsapp");
const WsConnection = require("../models/wsConnection");
const WhatsAppMessage = require("../models/whatsappMessage");
const WabaTemplate = require("../models/wabaTemplateModel");
const Contact = require("../models/contactModel");
const fs = require("fs");
const FormData = require("form-data");
const Lead = require("../models/leadModel");
const { downloadMetaMedia } = require("../services/metaMedia");
const { uploadWhatsAppMediaToS3, uploadWhatsAppMediaProfileToS3 } = require("../utils/uploadWhatsAppMedia");
const { createCampaignSchedule } = require("../services/awsScheduler");
const dotenv = require("dotenv");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
dotenv.config();

const {
    META_APP_ID,
    META_APP_SECRET,
    META_WHATSAPP_REDIRECT_URI,
    WHATSAPP_VERIFY_TOKEN,
    FRONTEND_URL,
} = process.env;

const updateChatLastMessage = async ({
    userId,
    chatNumber,
    direction,
    timestamp
}) => {

    // Field to update based on direction
    const timeField =
        direction === "incoming"
            ? "whatsappWaba.chats.$.lastIncomingTime"
            : "whatsappWaba.chats.$.lastOutgoingTime";

    // 1️⃣ Try updating existing chat
    const updated = await User.findOneAndUpdate(
        {
            _id: userId,
            "whatsappWaba.chats.chatNumber": chatNumber
        },
        {
            $set: {
                [timeField]: timestamp
            }
        },
        { new: true }
    );

    // 2️⃣ If chat not exist → create new
    if (!updated) {
        await User.findByIdAndUpdate(userId, {
            $push: {
                "whatsappWaba.chats": {
                    chatNumber,
                    lastIncomingTime:
                        direction === "incoming" ? timestamp : null,
                    lastOutgoingTime:
                        direction === "outgoing" ? timestamp : null
                }
            }
        });
    }
};


const parseMetaError = (error, step) => {
    const metaError = error.response?.data?.error;

    if (!metaError) {
        return {
            step,
            message: error.message || "Unknown Meta error"
        };
    }

    let message = metaError.message;

    /* Token errors */
    if (metaError.code === 190) {
        message = "Invalid or expired Access Token";
    }

    /* Permission errors */
    if (metaError.code === 10 || metaError.code === 200) {
        message = "Missing required WhatsApp permissions";
    }

    /* Invalid ID errors */
    if (metaError.code === 100) {
        message = `Invalid ${step} ID`;
    }

    return {
        step,
        message,
        meta: metaError
    };
};

exports.connectWhatsApp = async (req, res) => {
    try {
        const {
            accessToken,
            businessAccountId,
            wabaId,
            phoneNumberId
        } = req.body;

        /* ================================
           1️⃣ VERIFY BUSINESS
        =================================*/
        let businessRes;
        try {
            businessRes = await axios.get(
                `${META_GRAPH_URL}/${businessAccountId}`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
        } catch (error) {
            const parsed = parseMetaError(error, "Business Account");
            return res.status(400).json({
                status: "error",
                // step: parsed.step,
                message: parsed.message,
                // error: parsed.meta
            });
        }

        /* ================================
           2️⃣ VERIFY WABA UNDER BUSINESS
        =================================*/
        let wabaList;
        try {
            wabaList = await axios.get(
                `${META_GRAPH_URL}/${businessAccountId}/owned_whatsapp_business_accounts`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
        } catch (error) {
            const parsed = parseMetaError(error, "WABA fetch");
            return res.status(400).json({
                status: "error",
                // step: parsed.step,
                message: parsed.message,
                // error: parsed.meta
            });
        }

        const wabaExists = wabaList.data.data.find(
            w => w.id === wabaId
        );

        if (!wabaExists) {
            return res.status(400).json({
                status: "error",
                // step: "WABA Validation",
                message: "WABA does not belong to this Business Account"
            });
        }

        /* ================================
           3️⃣ VERIFY PHONE UNDER WABA
        =================================*/
        let phoneList;
        try {
            phoneList = await axios.get(
                `${META_GRAPH_URL}/${wabaId}/phone_numbers`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
        } catch (error) {
            const parsed = parseMetaError(error, "Phone Numbers fetch");
            return res.status(400).json({
                status: "error",
                // step: parsed.step,
                message: parsed.message,
                // error: parsed.meta
            });
        }

        const phoneExists = phoneList.data.data.find(
            p => p.id === phoneNumberId
        );

        if (!phoneExists) {
            return res.status(400).json({
                status: "error",
                // step: "Phone Validation",
                message: "Phone Number does not belong to this WABA"
            });
        }

        /* ================================
           4️⃣ SAVE CONNECTION
        =================================*/
        await User.findByIdAndUpdate(req.user._id, {
            whatsappWaba: {
                isConnected: true,
                businessAccountId,
                wabaId,
                phoneNumberId,
                phoneNumber: phoneExists.display_phone_number,
                accessToken
            }
        });

        return res.json({
            status: "success",
            message: "WABA Connected Successfully"
        });

    } catch (err) {
        return res.status(500).json({
            status: "error",
            step: "Server",
            message: "Internal server error",
            error: err.message
        });
    }
};

exports.disconnectWhatsApp = async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, {
            whatsappWaba: {
                isConnected: false,
                businessAccountId: null,
                wabaId: null,
                phoneNumberId: null,
                phoneNumber: null,
                accessToken: null,
            },
        });
        res.json({
            success: true,
            message: "WABA Disconnected Successfully",
        });
    } catch (err) {
        res.status(400).json({
            success: false,
            error: err.response?.data || err.message,
        });
    }
};

// controllers/whatsapp/getWabaProfile.js
exports.getWabaProfile = async (req, res) => {
    try {
        const userId = req.user._id;
        const user = await User.findById(userId);

        if (!user?.whatsappWaba?.phoneNumberId) {
            return res.status(400).json({
                success: false,
                message: "WABA not connected",
            });
        }

        const { phoneNumberId, accessToken } = user.whatsappWaba;

        /* -------------------------------------------------- */
        /* 0️⃣ GET WABA ID (if not saved) */
        /* -------------------------------------------------- */

        let wabaId = user.whatsappWaba.wabaId;

        if (!wabaId) {
            const wabaRes = await axios.get(
                `${META_GRAPH_URL}/${phoneNumberId}?fields=whatsapp_business_account`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );

            wabaId =
                wabaRes.data?.whatsapp_business_account?.id || null;

            user.whatsappWaba.wabaId = wabaId;
        }

        /* -------------------------------------------------- */
        /* 1️⃣ BUSINESS PROFILE */
        /* -------------------------------------------------- */

        const profileUrl =
            `${META_GRAPH_URL}/${phoneNumberId}` +
            `/whatsapp_business_profile` +
            `?fields=about,address,description,email,profile_picture_url,websites,vertical`;

        const { data: profileRes } = await axios.get(profileUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const profile = profileRes.data?.[0] || {};

        /* -------------------------------------------------- */
        /* 2️⃣ DISPLAY NAME */
        /* -------------------------------------------------- */

        const displayNameUrl =
            `${META_GRAPH_URL}/${phoneNumberId}` +
            `?fields=verified_name,name_status`;

        const { data: displayNameRes } = await axios.get(
            displayNameUrl,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        /* -------------------------------------------------- */
        /* 3️⃣ QUALITY + LIMIT */
        /* -------------------------------------------------- */

        const qualityUrl =
            `${META_GRAPH_URL}/${phoneNumberId}` +
            `?fields=messaging_limit_tier,quality_score`;

        const { data: qualityRes } = await axios.get(qualityUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        /* -------------------------------------------------- */
        /* 4️⃣ ACCOUNT STATUS (WABA LEVEL) */
        /* -------------------------------------------------- */

        let accountStatus = {};

        if (wabaId) {
            const accountUrl =
                `${META_GRAPH_URL}/${wabaId}` +
                `?fields=account_review_status,business_verification_status,status`;

            const { data: accountRes } = await axios.get(
                accountUrl,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );

            accountStatus = accountRes;
        }

        /* -------------------------------------------------- */
        /* SAVE IN DB */
        /* -------------------------------------------------- */

        user.whatsappWaba.profile = {
            displayName: displayNameRes.verified_name || "",
            about: profile.about || "",
            address: profile.address || "",
            description: profile.description || "",
            email: profile.email || "",
            vertical: profile.vertical || "",
            websites: profile.websites || [],
            profilePictureUrl: profile.profile_picture_url || "",
        };

        user.whatsappWaba.displayName =
            displayNameRes.verified_name || "";

        user.whatsappWaba.qualityRating =
            qualityRes.quality_score || "UNKNOWN";

        user.whatsappWaba.messagingLimit =
            qualityRes.messaging_limit_tier || "TIER_1";

        /* 🆕 SAVE ACCOUNT STATUS */

        user.whatsappWaba.accountReviewStatus =
            accountStatus.account_review_status || "UNKNOWN";

        user.whatsappWaba.businessVerificationStatus =
            accountStatus.business_verification_status || "UNKNOWN";

        user.whatsappWaba.status = accountStatus.status || "UNKNOWN";

        await user.save();

        /* -------------------------------------------------- */

        return res.json({
            success: true,
            message: "WABA profile fetched",
            data: user.whatsappWaba,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch WABA profile",
        });
    }
};

const uploadProfilePictureHandleToMeta = async ({
    accessToken,
    fileBuffer,
    fileName,
    mimeType,
    appId,
}) => {
    try {
        /* ───────── START SESSION ───────── */

        const startRes = await axios.post(
            `${META_GRAPH_URL}/${appId}/uploads`,
            null,
            {
                params: {
                    file_name: fileName,
                    file_length: fileBuffer.length,
                    file_type: mimeType,
                    access_token: accessToken,
                },
            }
        );

        if (!startRes.data?.id) {
            throw new Error("Upload session start failed");
        }

        const sessionId = startRes.data.id.replace(
            "upload:",
            ""
        );

        /* ───────── UPLOAD BYTES ───────── */

        const uploadRes = await axios.post(
            `${META_GRAPH_URL}/upload:${sessionId}`,
            fileBuffer,
            {
                headers: {
                    Authorization: `OAuth ${accessToken}`,
                    file_offset: "0",
                    "Content-Type": "application/octet-stream",
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            }
        );

        if (!uploadRes.data?.h) {
            throw new Error("Handle not returned");
        }

        return uploadRes.data.h; // 🔥 4::aW...
    } catch (err) {
        throw err;
    }
};

exports.updateWabaProfile = async (req, res) => {
    try {
        const userId = req.user._id;

        const {
            displayName,
            about,
            address,
            description,
            email,
            vertical,
            websites,
            webhookUrl,
            verifyToken,
        } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        const { phoneNumberId, accessToken, wabaId } =
            user.whatsappWaba;

        if (!wabaId) {
            return res.status(400).json({
                success: false,
                message: "WABA ID missing",
            });
        }

        /* ─────────────────────────────
           1️⃣ UPDATE TEXT PROFILE
        ───────────────────────────── */

        await axios.post(
            `${META_GRAPH_URL}/${phoneNumberId}/whatsapp_business_profile`,
            {
                messaging_product: "whatsapp",
                about,
                address,
                description,
                email,
                vertical,
                websites,
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
            }
        );

        /* ─────────────────────────────
   4️⃣ DISPLAY NAME UPDATE REQUEST
───────────────────────────── */

        if (displayName) {
            const displayNameRes = await axios.post(
                `${META_GRAPH_URL}/${phoneNumberId}`,
                {
                    // messaging_product: "whatsapp",
                    new_display_name: displayName,
                    // phone_number_id: phoneNumberId,
                },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            /* Save requested name locally */

            user.whatsappWaba.displayNameRequested =
                displayName;
        }

        /* ─────────────────────────────
           2️⃣ PROFILE PICTURE HANDLE FLOW
        ───────────────────────────── */

        if (req.file) {
            /* Get buffer from multer */

            let fileBuffer;
            if (req.file.buffer) {
                fileBuffer = req.file.buffer;
            } else {
                fileBuffer = fs.readFileSync(
                    req.file.path
                );
            }

            /* Upload → Get HANDLE */

            const handle =
                await uploadProfilePictureHandleToMeta({
                    accessToken,
                    fileBuffer,
                    fileName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    appId: process.env.META_APP_ID,
                });

            /* Set DP in Meta */

            await axios.post(
                `${META_GRAPH_URL}/${phoneNumberId}/whatsapp_business_profile`,
                {
                    messaging_product: "whatsapp",
                    profile_picture_handle: handle,
                },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            /* Upload same image to S3 */

            const s3Url =
                await uploadWhatsAppMediaProfileToS3({
                    userId,
                    buffer: fileBuffer,
                    mimeType: req.file.mimetype,
                    originalName: "profile",
                });

            /* Save in DB */

            user.whatsappWaba.profilePictureUrl =
                handle;

            user.whatsappWaba.profilePictureS3Url =
                s3Url;
        }

        /* ─────────────────────────────
           3️⃣ SAVE OTHER DATA
        ───────────────────────────── */

        user.whatsappWaba.profile = {
            ...user.whatsappWaba.profile,
            about,
            address,
            description,
            email,
            vertical,
            websites,
        };

        if (webhookUrl)
            user.whatsappWaba.webhook.callbackUrl =
                webhookUrl;

        if (verifyToken)
            user.whatsappWaba.webhook.verifyToken =
                verifyToken;

        await user.save();

        res.json({
            success: true,
            message:
                "WABA profile + picture updated successfully",
            data: user.whatsappWaba,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to update profile",
        });
    }
};

// controllers/whatsapp/refreshToken.js
exports.refreshWabaToken = async (req, res) => {
    try {
        const userId = req.user._id;
        const access_token_waba = req.body.access_token_waba;

        const user = await User.findById(userId);

        const wabaId = user.whatsappWaba.wabaId;
        const businessAccountId = user.whatsappWaba.businessAccountId;

        /* -------- SAVE NEW TOKEN -------- */

        let wabaList;
        try {
            wabaList = await axios.get(
                `${META_GRAPH_URL}/${businessAccountId}/owned_whatsapp_business_accounts`,
                { headers: { Authorization: `Bearer ${access_token_waba}` } }
            );
        } catch (error) {
            const parsed = parseMetaError(error, "WABA fetch");
            return res.status(400).json({
                status: "error",
                // step: parsed.step,
                message: parsed.message,
                // error: parsed.meta
            });
        }

        const wabaExists = wabaList.data.data.find(
            w => w.id === wabaId
        );

        if (!wabaExists) {
            return res.status(400).json({
                status: "error",
                // step: "WABA Validation",
                message: "WABA does not belong to this Business Account"
            });
        }

        user.whatsappWaba.accessToken = access_token_waba;

        // expires in seconds
        // user.whatsappWaba.tokenExpiresAt = new Date(
        //     Date.now() + 60 * 60 * 1000 // 1 hour in milliseconds
        // );

        await user.save();

        res.json({
            success: true,
            message: "Access token refreshed",
            accessToken: access_token_waba,
            // expiresIn: 60 * 60,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to refresh token",
        });
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
        return res.status(200).send(challenge);
    }
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

        // 2️⃣ Check agents under this admin
        const agentIds = await User.find(
            { createdByWhichCompanyAdmin: userId },
            { _id: 1 }
        ).lean();

        const agentIdList = agentIds.map(a => a._id);

        record =
            await Contact.findOne({
                ...phoneQuery,
                createdBy: { $in: agentIdList }
            }) ||
            await Lead.findOne({
                ...phoneQuery,
                createdBy: { $in: agentIdList }
            });
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

/** STEP 4: Webhook to receive messages
 */
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

exports.webhookReceive = async (req, res) => {

    try {
        const entry = req.body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;

        /* ─────────────────────────────────────────────
📌 MESSAGE STATUS UPDATES (sent/delivered/read)
───────────────────────────────────────────── */
        if (Array.isArray(value.statuses) && value.statuses.length > 0) {
            for (const statusObj of value.statuses) {

                const {
                    id: metaMessageId,
                    status,
                    timestamp,
                    recipient_id,
                    conversation,
                    pricing,
                    errors
                } = statusObj;

                const statusDate = new Date(timestamp * 1000);

                // Dynamic timestamp fields
                const statusTimestampUpdate = {
                    messageStatusTimestamp: statusDate
                };

                if (status === "sent") {
                    statusTimestampUpdate.messageSentTimestamp = statusDate;
                }

                if (status === "delivered") {
                    statusTimestampUpdate.messageDeliveredTimestamp = statusDate;
                }

                if (status === "read") {
                    statusTimestampUpdate.messageReadTimestamp = statusDate;
                }

                if (status === "failed") {
                    statusTimestampUpdate.messageFailedTimestamp = statusDate;
                }

                const updated = await WhatsAppMessage.findOneAndUpdate(
                    { metaMessageId },
                    {
                        status,
                        ...statusTimestampUpdate,

                        ...(errors && {
                            error: {
                                code: errors?.[0]?.code,
                                message: errors?.[0]?.title
                            }
                        })
                    },
                    { new: true }
                ).lean();


                if (!updated) {
                    continue;
                }

                const fullMessage = updated;

                /* 🔹 REAL-TIME PUSH (Socket/Lambda) */

                // 1️⃣ Find all users having same phoneNumberId
                const allUsers = await User.find({
                    "whatsappWaba.phoneNumberId": updated.phoneNumberId
                }).select("_id");

                // 2️⃣ Extract all userIds
                const allUserIds = allUsers.map(u => u._id);

                // 3️⃣ Find all websocket connections
                const connections = await WsConnection.find({
                    userId: { $in: allUserIds }
                });

                if (connections.length > 0) {

                    const eventPayload = {
                        type: "message_status_update",
                        metaMessageId,
                        status,
                        recipient_id,
                        conversationId: updated.conversationId,
                        timestamp,
                        message: fullMessage,
                        connections: connections.map(c => ({
                            connectionId: c.connectionId
                        }))
                    };

                    await lambdaClient.send(new InvokeCommand({
                        FunctionName: "waba-webhook",
                        InvocationType: "RequestResponse",
                        Payload: JSON.stringify(eventPayload)
                    }));
                }
            }

            return res.status(200).send("STATUS_UPDATED");
        }

        const contact = value.contacts?.[0];
        let senderName = "";
        let originalName = "";
        let senderWabaID = "";

        if (contact) {
            senderName = contact.profile?.name || "";
            originalName = contact.profile?.name || "";
            senderWabaID = contact.wa_id || "";
        }

        if (!value) {
            return { statusCode: 200 };
        }

        const phoneNumberId = value?.metadata?.phone_number_id?.toString();

        if (!Array.isArray(value.messages) || value.messages.length === 0) {
            return { statusCode: 200 };
        }

        // 1️⃣ Find ALL users (admin + agents)
        const users = await User.find({
            "whatsappWaba.phoneNumberId": phoneNumberId
        }).select("_id role whatsappWaba accessToken");

        if (!users.length) {
            return { statusCode: 200 };
        }

        // 2️⃣ Find company admin (message owner)
        const companyAdmin = users.find(u => u.role === "companyAdmin");

        if (!companyAdmin) {
            return { statusCode: 200 };
        }

        // 3️⃣ Extract all userIds
        const allUserIds = users.map(u => u._id);

        const crmName = await findNameFromCRM({
            userId: companyAdmin._id,
            role: companyAdmin.role,
            waId: senderWabaID
        });

        // ✅ Final senderName decision
        const finalSenderName = crmName || senderName;

        // const connections = await WsConnection.find({ userId: user._id });

        const connections = await WsConnection.find({
            userId: { $in: allUserIds }
        });

        if (connections.length === 0) {
            return { statusCode: 200 };
        }

        for (const msg of value.messages || []) {
            const { messageType, content } = parseWhatsAppMessage(msg);
            let s3dataurl = "";
            let attachmentName = "";
            let mimeType = "";
            let fileSize = 0;

            if (content.mediaId) {
                const downloaded = await downloadMetaMedia({
                    mediaId: content.mediaId,
                    accessToken: companyAdmin.whatsappWaba.accessToken
                });

                mimeType = downloaded.mimeType;
                fileSize = downloaded.buffer.length;

                attachmentName = getAttachmentName(msg, mimeType);

                const s3Url = await uploadWhatsAppMediaToS3({
                    userId: companyAdmin._id,
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
            }

            await WhatsAppMessage.create({
                userId: companyAdmin._id,
                phoneNumberId,
                conversationId: msg.from,
                senderName: finalSenderName,
                originalName: originalName,
                senderWabaId: senderWabaID,
                direction: "incoming",
                from: msg.from,
                to: phoneNumberId,
                messageType,
                content,
                s3dataurl,
                attachmentName: attachmentName,
                metaMessageId: msg.id,
                status: "received",
                messageTimestamp: new Date(msg.timestamp * 1000),
                raw: msg
            });

            await updateChatLastMessage({
                userId: companyAdmin._id,
                chatNumber: msg.from,
                direction: "incoming",
                timestamp: new Date(msg.timestamp * 1000)
            });

            const eventPayload = {
                whatsappEvent: req.body,          // full Meta webhook
                userId: companyAdmin._id.toString(),      // user reference
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
        }
        res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
        res.sendStatus(200);
    }
};


/** STEP 5: Send Text Message
 */
exports.sendTextMessage = async (req, res) => {
    try {
        const { to, text, name } = req.body;
        const userId = req.user?._id;

        // 1️⃣ Basic validation
        if (!to || !text) {
            return res.status(400).json({
                success: false,
                message: "'to' and 'text' are required",
            });
        }

        // 2️⃣ Fetch user
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        let companyAdminDetails;
        let companyAdminId;


        if (user.role == "user") {
            companyAdminId = user.createdByWhichCompanyAdmin;

            companyAdminDetails = await User.findById(companyAdminId);
        } else if (user.role == "companyAdmin") {
            companyAdminDetails = user;
        }


        const { phoneNumberId, accessToken } = companyAdminDetails.whatsappWaba || {};

        // 3️⃣ Validate WABA config
        if (!phoneNumberId || !accessToken) {
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

        // 5️⃣ Send message
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
        });

        // 6️⃣ Extract Meta message ID
        const metaMessageId = response.data?.messages?.[0]?.id || null;

        // 7️⃣ Save outgoing message in DB
        await WhatsAppMessage.create({
            userId: companyAdminDetails._id,
            phoneNumberId,
            conversationId: to,              // chat grouping
            senderName: name || to, // business name/number
            direction: "outgoing",
            from: companyAdminDetails.whatsappWaba.phoneNumber, // business number
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

        await updateChatLastMessage({
            userId: companyAdminDetails._id,
            chatNumber: to,
            direction: "outgoing",
            timestamp: new Date()
        });

        const phoneNumberObj = parsePhoneNumberFromString("+" + to);

        if (!phoneNumberObj) {
            return res.status(400).json({
                success: false,
                message: "Invalid phone number format",
            });
        }

        const countryCode = phoneNumberObj.countryCallingCode; // e.g. 91
        const number = phoneNumberObj.nationalNumber;

        let contact = await Contact.findOne({
            phoneNumbers: {
                $elemMatch: {
                    countryCode: countryCode,
                    number: number,
                },
            },
            createdBy: companyAdminDetails._id,
        });

        let lead = null;

        if (!contact) {
            lead = await Lead.findOne({
                phoneNumbers: {
                    $elemMatch: {
                        countryCode: countryCode,
                        number: number,
                    },
                },
                createdBy: companyAdminDetails._id,
            });
        }

        const activityData = {
            action: "Text message sent",
            type: "whatsapp",
            title: "WhatsApp Message",
            description: "Whatsapp Text Message sent",
            timestamp: new Date(),
        };

        if (contact) {
            contact.activities.push(activityData);
            await contact.save();
        }
        else if (lead) {
            lead.activities.push(activityData);
            await lead.save();
        }

        // 6️⃣ Success response
        res.json({
            success: true,
            message: "Message sent successfully",
            data: response.data,
        });

    } catch (error) {
        // Axios / Meta API error
        if (error.response) {
            return res.status(400).json({
                success: false,
                message: "Failed to send WhatsApp message",
                metaError: error.response.data,
            });
        }

        // Network / unknown error

        res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    } finally {
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

exports.sendMessage = async (req, res) => {
    try {
        const { to, type, text, caption, name } = req.body;
        const file = req.file; // multer
        const userId = req.user._id;

        if (!to || !type) {
            return res.status(400).json({ success: false, message: "to & type required" });
        }

        const user = await User.findById(userId);


        let companyAdminDetails;
        let companyAdminId;


        if (user.role == "user") {
            companyAdminId = user.createdByWhichCompanyAdmin;

            companyAdminDetails = await User.findById(companyAdminId);
        } else if (user.role == "companyAdmin") {
            companyAdminDetails = user;
        }

        companyAdminId = companyAdminDetails._id;

        const { phoneNumberId, accessToken, phoneNumber } = companyAdminDetails.whatsappWaba;

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

            let uploadBuffer = file.buffer;
            let uploadMime = file.mimetype;
            let uploadName = file.originalname;

            const form = new FormData();
            form.append("file", uploadBuffer, {
                filename: uploadName,
                contentType: uploadMime
            });
            form.append("type", uploadMime);
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
                companyAdminId,
                messageType: type,
                buffer: uploadBuffer,
                mimeType: uploadMime,
                originalName: uploadName
            });

            mimeType = file.mimetype;
            fileSize = file.size;
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
            userId: companyAdminId,
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

        await updateChatLastMessage({
            userId: companyAdminId,
            chatNumber: to,
            direction: "outgoing",
            timestamp: new Date()
        });

        const phoneNumberObj = parsePhoneNumberFromString("+" + to);

        if (!phoneNumberObj) {
            return res.status(400).json({
                success: false,
                message: "Invalid phone number format",
            });
        }

        const countryCode = phoneNumberObj.countryCallingCode; // e.g. 91
        const number = phoneNumberObj.nationalNumber;

        let contact = await Contact.findOne({
            phoneNumbers: {
                $elemMatch: {
                    countryCode: countryCode,
                    number: number,
                },
            },
            createdBy: companyAdminId,
        });

        let lead = null;

        if (!contact) {
            lead = await Lead.findOne({
                phoneNumbers: {
                    $elemMatch: {
                        countryCode: countryCode,
                        number: number,
                    },
                },
                createdBy: companyAdminId,
            });
        }

        const activityData = {
            action: `${type} message sent`,
            type: "whatsapp",
            title: "WhatsApp Message",
            description: `Whatsapp ${type} Message sent`,
            timestamp: new Date(),
        };

        if (contact) {
            contact.activities.push(activityData);
            await contact.save();
        }
        else if (lead) {
            lead.activities.push(activityData);
            await lead.save();
        }


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
        res.status(500).json({ success: false });
    }
};

/**
 * SEND WHATSAPP TEMPLATE MESSAGE (FINAL & SAFE)
 */
exports.sendTemplateMessage = async (req, res) => {
    try {
        const {
            to,
            templateId,
            params = {},
            name: messageName // 👈 your custom identity name
        } = req.body;

        const userId = req.user._id;

        if (!to || !templateId) {
            return res.status(400).json({
                success: false,
                message: "`to` and `templateId` required"
            });
        }

        /* ───────── USER / WABA ───────── */
        const user = await User.findById(userId);

        let companyAdminDetails;

        let companyAdminId;

        if (user.role == "user") {
            companyAdminId = user.createdByWhichCompanyAdmin;

            companyAdminDetails = await User.findById(companyAdminId);
        } else if (user.role == "companyAdmin") {
            companyAdminDetails = user;
        }

        companyAdminId = companyAdminDetails._id;

        if (!companyAdminDetails?.whatsappWaba) {
            return res.status(400).json({
                success: false,
                message: "WABA not connected"
            });
        }

        const { phoneNumberId, accessToken } = companyAdminDetails.whatsappWaba;

        /* ───────── TEMPLATE ───────── */
        const template = await WabaTemplate.findById(templateId);

        if (!template) {
            return res.status(404).json({
                success: false,
                message: "Template not found"
            });
        }

        /* ───────── BUILD COMPONENTS ───────── */
        const components = [];

        /* ===== HEADER ===== */
        const header = template.components.find(c => c.type === "HEADER");

        if (header) {
            const hasVars = /{{.*?}}/.test(header.text || "");

            if (header.format === "TEXT" && hasVars && params.header) {
                components.push({
                    type: "header",
                    parameters: [{ type: "text", text: params.header }]
                });
            }

            if (header.format === "IMAGE" && header.media?.s3Url) {
                components.push({
                    type: "header",
                    parameters: [{
                        type: "image",
                        image: { link: header.media.s3Url }
                    }]
                });
            }

            if (header.format === "VIDEO" && header.media?.s3Url) {
                components.push({
                    type: "header",
                    parameters: [{
                        type: "video",
                        video: { link: header.media.s3Url }
                    }]
                });
            }

            if (header.format === "DOCUMENT" && header.media?.s3Url) {
                components.push({
                    type: "header",
                    parameters: [{
                        type: "document",
                        document: {
                            link: header.media.s3Url,
                            filename: header.media.fileName || "file"
                        }
                    }]
                });
            }
        }

        const body = template.components.find(c => c.type === "BODY");

        if (body) {
            const hasVars = /{{.*?}}/.test(body.text || "");

            if (hasVars) {

                /* ===== NAMED PARAMS ===== */
                if (template.parameter_format === "named") {

                    const namedExamples =
                        body.example?.body_text_named_params || [];

                    components.push({
                        type: "body",
                        parameters: namedExamples.map((ex, i) => ({
                            type: "text",
                            parameter_name: ex.param_name,
                            text: params.body?.[i] || ""
                        }))
                    });
                }

                /* ===== POSITIONAL PARAMS ===== */
                else {
                    components.push({
                        type: "body",
                        parameters: (params.body || []).map(t => ({
                            type: "text",
                            text: t
                        }))
                    });
                }
            }
        }

        /* ===== BUTTONS ===== */
        const buttons = template.components.find(c => c.type === "BUTTONS");

        if (buttons?.buttons?.length) {
            buttons.buttons.forEach((btn, index) => {

                // QUICK REPLY
                if (btn.type === "QUICK_REPLY") {
                    components.push({
                        type: "button",
                        sub_type: "quick_reply",
                        index,
                        parameters: [{
                            type: "payload",
                            payload: btn.text
                        }]
                    });
                }

                // URL
                if (btn.type === "URL") {
                    const hasVars = /{{.*?}}/.test(btn.url || "");

                    if (hasVars && params.buttons?.[index]) {
                        components.push({
                            type: "button",
                            sub_type: "url",
                            index,
                            parameters: [{
                                type: "text",
                                text: params.buttons[index]
                            }]
                        });
                    }
                }

                // COPY CODE
                // COPY CODE (dynamic)
                if (btn.type === "COPY_CODE") {
                    const code = params.buttons?.[index];

                    if (!code) {
                        throw new Error(
                            `COPY_CODE button at index ${index} requires coupon_code`
                        );
                    }

                    components.push({
                        type: "button",
                        sub_type: "copy_code",
                        index,
                        parameters: [{
                            type: "coupon_code",
                            coupon_code: code
                        }]
                    });
                }

                // PHONE NUMBER (Meta = voice_call)
                if (btn.type === "PHONE_NUMBER") {
                    components.push({
                        type: "button",
                        sub_type: "voice_call",
                        index
                    });
                }
            });
        }

        /* ───────── PAYLOAD ───────── */
        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: template.name,
                language: { code: template.language || "en_US" },
                ...(components.length && { components })
            }
        };

        console.dir(payload, { depth: null });

        /* ───────── SEND ───────── */
        const { data } = await axios.post(
            `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                }
            }
        );

        /* ───────── STORE MESSAGE ───────── */
        await WhatsAppMessage.create({
            userId: companyAdminId,
            to,
            from: phoneNumberId,
            phoneNumberId,
            senderName: messageName, // 👈 STORED HERE
            direction: "outgoing",
            messageType: "template",
            conversationId: to,
            metaMessageId: data.messages?.[0]?.id,
            messageTimestamp: new Date(),
            content: {
                template: {
                    name: template.name,
                    language: template.language,

                    // full template structure
                    components: template.components,

                    // params used while sending
                    params,

                    // optional resolved preview
                    resolved: {
                        header: params.header || null,
                        body: Array.isArray(params.body)
                            ? params.body.join(" ")
                            : null,
                        buttons: []
                    }
                }
            },
            status: "sent",
            raw: data
        });

        await updateChatLastMessage({
            userId: companyAdminId,
            chatNumber: to,
            direction: "outgoing",
            timestamp: new Date()
        });


        const phoneNumberObj = parsePhoneNumberFromString("+" + to);

        if (!phoneNumberObj) {
            return res.status(400).json({
                success: false,
                message: "Invalid phone number format",
            });
        }

        const countryCode = phoneNumberObj.countryCallingCode; // e.g. 91
        const number = phoneNumberObj.nationalNumber;

        let contact = await Contact.findOne({
            phoneNumbers: {
                $elemMatch: {
                    countryCode: countryCode,
                    number: number,
                },
            },
            createdBy: companyAdminId,
        });

        let lead = null;

        if (!contact) {
            lead = await Lead.findOne({
                phoneNumbers: {
                    $elemMatch: {
                        countryCode: countryCode,
                        number: number,
                    },
                },
                createdBy: companyAdminId,
            });
        }

        const activityData = {
            action: "Template message sent",
            type: "whatsapp",
            title: "WhatsApp Message",
            description: `Whatsapp Template Message sent`,
            timestamp: new Date(),
        };

        if (contact) {
            contact.activities.push(activityData);
            await contact.save();
        }
        else if (lead) {
            lead.activities.push(activityData);
            await lead.save();
        }

        return res.json({ success: true, data });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.response?.data || error.message
        });
    }
};

const extractNumbersWithNames = (records, type = "contact") => {
    const data = [];

    records.forEach(r => {

        const firstName = r.firstname || "";
        const lastName = r.lastname || "";

        let name = `${firstName} ${lastName}`.trim();

        if (!name) {
            name = r.company || "Unknown";
        }

        r.phoneNumbers?.forEach(p => {
            if (p.number) {
                data.push({
                    number: `${p.countryCode || ""}${p.number}`,
                    name,
                    firstName,
                    lastName,
                    company: r.company || ""
                });
            }
        });

    });

    return data;
};

const resolveDynamicParams = (params = {}, recipient) => {

    const resolved = { ...params };

    /* ===== BODY PARAMS ===== */
    if (Array.isArray(params.body)) {
        resolved.body = params.body.map(p => {

            if (p === "{{first_name}}") {
                return recipient.firstName || "Customer";
            }

            if (p === "{{last_name}}") {
                return recipient.lastName || "";
            }

            if (p === "{{full_name}}") {
                return recipient.name || "Customer";
            }

            if (p === "{{company}}") {
                return recipient.company || "";
            }

            return p; // static value
        });
    }

    return resolved;
};

exports.sendTemplateBulkMessage = async (req, res) => {
    try {
        const {
            // to,
            templateId,
            campaignName,
            params = {},
            groupName = [],
            schedule = "",
            name: messageName
        } = req.body;

        if (!campaignName) {
            return res.status(400).json({
                success: false,
                message: "campaignName is required",
            });
        }

        const userId = req.user._id;

        /* ───────── VALIDATION ───────── */
        if (!templateId) {
            return res.status(400).json({
                success: false,
                message: "`templateId` required"
            });
        }

        // Normalize numbers to array
        /* ───────── USER / WABA ───────── */
        const user = await User.findById(userId);

        let companyAdminDetails;

        let companyAdminId;

        if (user.role == "user") {
            companyAdminId = user.createdByWhichCompanyAdmin;

            companyAdminDetails = await User.findById(companyAdminId);
        } else if (user.role == "companyAdmin") {
            companyAdminDetails = user;
        }

        companyAdminId = companyAdminDetails._id;

        /* ───────── RESOLVE CREATED BY IDS ───────── */

        let allowedUserIds = [];

        if (user.role === "companyAdmin") {
            // Admin sees only his own contacts
            allowedUserIds = [companyAdminId];
        } else if (user.role === "user") {
            // Agent sees both:
            // 1. Company Admin contacts
            // 2. His own contacts
            allowedUserIds = [companyAdminId, user._id];
        }

        if (!companyAdminDetails?.whatsappWaba) {
            return res.status(400).json({
                success: false,
                message: "WABA not connected"
            });
        }

        const { phoneNumberId, accessToken } = companyAdminDetails.whatsappWaba;

        /* ───────── TEMPLATE ───────── */
        const template = await WabaTemplate.findById(templateId);

        if (!template) {
            return res.status(404).json({
                success: false,
                message: "Template not found"
            });
        }

        /* ───────── BUILD NUMBERS FROM GROUP / TAG ───────── */

        let numbers = [];

        /* ===== CASE 1: Direct numbers ===== */
        /* ===== CASE 2: Group / Tag based ===== */

        let contacts = [];
        let leads = [];

        if (groupName?.length) {

            // Normalize tags
            const tagsArray = Array.isArray(groupName)
                ? groupName
                : [groupName];

            /* --- FIND CONTACTS --- */

            contacts = await Contact.find({
                createdBy: { $in: allowedUserIds },
                "tags.tag": { $in: tagsArray }
            });

            /* --- FIND LEADS --- */
            leads = await Lead.find({
                createdBy: { $in: allowedUserIds },
                "tags.tag": { $in: tagsArray }
            });

            /* --- EXTRACT NUMBERS --- */
            const extractNumbers = (records) => {
                const nums = [];

                records.forEach(r => {
                    r.phoneNumbers?.forEach(p => {
                        if (p.number) {
                            nums.push(
                                `${p.countryCode || ""}${p.number}`
                            );
                        }
                    });
                });

                return nums;
            };
        }

        let recipients = [
            ...extractNumbersWithNames(contacts, "contact"),
            ...extractNumbersWithNames(leads, "lead")
        ];

        /* ===== REMOVE DUPLICATES ===== */
        recipients = [...new Set(recipients)];

        /* ===== FINAL VALIDATION ===== */
        if (!recipients.length) {
            return res.status(400).json({
                success: false,
                message: "No phone numbers found for provided input"
            });
        }

        const campaignId = new mongoose.Types.ObjectId();

        const campaignData = {
            campaignId,
            campaignName,
            templateId: template._id,
            templateName: template.name,
            status: schedule ? "scheduled" : "completed",
            templateLanguage: template.language,
            groups: groupName,
            numbers: recipients,
            total: recipients.length,
            messageRefs: [],
            scheduledAt: schedule ? new Date(schedule) : null,
        };

        /* ───────── BUILD COMPONENTS ───────── */
        const components = [];

        /* ===== HEADER ===== */
        const header = template.components.find(c => c.type === "HEADER");

        if (header) {
            const hasVars = /{{.*?}}/.test(header.text || "");

            if (header.format === "TEXT" && hasVars && params.header) {
                components.push({
                    type: "header",
                    parameters: [{ type: "text", text: params.header }]
                });
            }

            if (header.format === "IMAGE" && header.media?.s3Url) {
                components.push({
                    type: "header",
                    parameters: [{
                        type: "image",
                        image: { link: header.media.s3Url }
                    }]
                });
            }

            if (header.format === "VIDEO" && header.media?.s3Url) {
                components.push({
                    type: "header",
                    parameters: [{
                        type: "video",
                        video: { link: header.media.s3Url }
                    }]
                });
            }

            if (header.format === "DOCUMENT" && header.media?.s3Url) {
                components.push({
                    type: "header",
                    parameters: [{
                        type: "document",
                        document: {
                            link: header.media.s3Url,
                            filename: header.media.fileName || "file"
                        }
                    }]
                });
            }
        }

        /* ===== BODY ===== */
        const body = template.components.find(c => c.type === "BODY");

        if (body) {
            const hasVars = /{{.*?}}/.test(body.text || "");

            if (hasVars) {

                // Named params
                if (template.parameter_format === "named") {

                    const namedExamples =
                        body.example?.body_text_named_params || [];

                    components.push({
                        type: "body",
                        parameters: namedExamples.map((ex, i) => ({
                            type: "text",
                            parameter_name: ex.param_name,
                            text: params.body?.[i] || ""
                        }))
                    });
                }

                // Positional params
                else {
                    components.push({
                        type: "body",
                        parameters: (params.body || []).map(t => ({
                            type: "text",
                            text: t
                        }))
                    });
                }
            }
        }

        /* ===== BUTTONS ===== */
        const buttons = template.components.find(c => c.type === "BUTTONS");

        if (buttons?.buttons?.length) {
            buttons.buttons.forEach((btn, index) => {

                // QUICK REPLY
                if (btn.type === "QUICK_REPLY") {
                    components.push({
                        type: "button",
                        sub_type: "quick_reply",
                        index,
                        parameters: [{
                            type: "payload",
                            payload: btn.text
                        }]
                    });
                }

                // URL
                if (btn.type === "URL") {
                    const hasVars = /{{.*?}}/.test(btn.url || "");

                    if (hasVars && params.buttons?.[index]) {
                        components.push({
                            type: "button",
                            sub_type: "url",
                            index,
                            parameters: [{
                                type: "text",
                                text: params.buttons[index]
                            }]
                        });
                    }
                }

                // COPY CODE
                if (btn.type === "COPY_CODE") {
                    const code = params.buttons?.[index];

                    if (!code) {
                        throw new Error(
                            `COPY_CODE button at index ${index} requires coupon_code`
                        );
                    }

                    components.push({
                        type: "button",
                        sub_type: "copy_code",
                        index,
                        parameters: [{
                            type: "coupon_code",
                            coupon_code: code
                        }]
                    });
                }

                // PHONE NUMBER
                if (btn.type === "PHONE_NUMBER") {
                    components.push({
                        type: "button",
                        sub_type: "voice_call",
                        index
                    });
                }
            });
        }

        /* ───────── SCHEDULE MODE ───────── */

        /* ───────── SCHEDULE MODE ───────── */
        if (schedule) {

            // 1️⃣ Save campaign
            await User.updateOne(
                { _id: companyAdminId },
                { $push: { campaigns: campaignData } }
            );

            // 2️⃣ Remove milliseconds
            const isoTime =
                schedule.replace(/\.\d{3}Z$/, "Z");

            // 3️⃣ Create AWS schedule
            await createCampaignSchedule({
                campaignId: campaignId.toString(),
                scheduleTime: isoTime,
                payload: {
                    type: "SEND_SCHEDULED_CAMPAIGN",
                    campaignId: campaignId.toString(),
                    userId: companyAdminId.toString(),
                    templateId: templateId.toString(),
                    params,
                    groupName,
                    scheduledAt: new Date(schedule), // ⭐ ADD THIS
                },
            });

            return res.json({
                success: true,
                message: "Campaign scheduled successfully",
                campaignId,
                scheduledAt: isoTime,
            });
        }


        /* ───────── BULK SEND ───────── */
        const results = [];


        for (const r of recipients) {

            const toNumber = r.number;
            const senderName = r.name;

            /* ===== RESOLVE DYNAMIC PARAMS ===== */
            const resolvedParams = resolveDynamicParams(params, r);

            /* ===== BUILD BODY COMPONENT ===== */
            const dynamicComponents = [...components];

            const bodyIndex = dynamicComponents.findIndex(
                c => c.type === "body"
            );

            if (bodyIndex !== -1) {

                /* ===== NAMED PARAMS ===== */
                if (template.parameter_format === "named") {

                    const namedExamples =
                        template.components
                            .find(c => c.type === "BODY")
                            ?.example?.body_text_named_params || [];

                    dynamicComponents[bodyIndex].parameters =
                        namedExamples.map((ex, i) => ({

                            type: "text",
                            parameter_name: ex.param_name, // ✅ REQUIRED
                            text: resolvedParams.body?.[i] || ""

                        }));
                }

                /* ===== POSITIONAL PARAMS ===== */
                else {

                    dynamicComponents[bodyIndex].parameters =
                        (resolvedParams.body || []).map(text => ({
                            type: "text",
                            text
                        }));
                }
            }

            const payload = {
                messaging_product: "whatsapp",
                to: toNumber,
                type: "template",
                template: {
                    name: template.name,
                    language: { code: template.language || "en_US" },
                    ...(dynamicComponents.length && {
                        components: dynamicComponents
                    })
                }
            };

            try {
                const { data } = await axios.post(
                    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
                    payload,
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            "Content-Type": "application/json"
                        }
                    }
                );

                const metaId = data.messages?.[0]?.id;

                campaignData.messageRefs.push({
                    metaMessageId: metaId,
                    chatNumber: toNumber,
                    chatName: senderName || toNumber
                });

                await WhatsAppMessage.create({
                    userId: companyAdminId,
                    phoneNumberId,
                    conversationId: toNumber,
                    direction: "outgoing",
                    from: phoneNumberId,
                    to: toNumber,
                    senderName,
                    messageType: "template",
                    content: {
                        template: {
                            name: template.name,
                            language: template.language,
                            components: template.components,
                            params: resolvedParams
                        }
                    },
                    metaMessageId: metaId,
                    status: "sent",
                    messageTimestamp: new Date()
                });


                const phoneNumberObj = parsePhoneNumberFromString("+" + toNumber);

                if (!phoneNumberObj) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid phone number format",
                    });
                }

                const countryCode = phoneNumberObj.countryCallingCode; // e.g. 91
                const number = phoneNumberObj.nationalNumber;

                let contact = await Contact.findOne({
                    phoneNumbers: {
                        $elemMatch: {
                            countryCode: countryCode,
                            number: number,
                        },
                    },
                    createdBy: companyAdminId,
                });

                let lead = null;

                if (!contact) {
                    lead = await Lead.findOne({
                        phoneNumbers: {
                            $elemMatch: {
                                countryCode: countryCode,
                                number: number,
                            },
                        },
                        createdBy: companyAdminId,
                    });
                }

                const activityData = {
                    action: "Template message sent",
                    type: "whatsapp",
                    title: "WhatsApp Message",
                    description: `Whatsapp Template Message sent`,
                    timestamp: new Date(),
                };

                if (contact) {
                    contact.activities.push(activityData);
                    await contact.save();
                }
                else if (lead) {
                    lead.activities.push(activityData);
                    await lead.save();
                }

                results.push({
                    to: toNumber,
                    success: true,
                    messageId: metaId
                });

            } catch (err) {
                results.push({
                    to: toNumber,
                    success: false,
                    error: err.response?.data || err.message
                });
            }
        }

        await User.updateOne(
            { _id: companyAdminId },
            {
                $push: {
                    campaigns: campaignData,
                },
            }
        );

        /* ───────── RESPONSE ───────── */
        return res.json({
            success: true,
            total: recipients.length,
            sent: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.response?.data || error.message
        });
    }
};

/*
GET /api/campaigns
Campaign List (from User.campaigns)
*/
exports.getAllCampaigns = async (req, res) => {
    try {
        const userId = req.user._id;

        /* 📥 Request Params */
        const { page = 1, limit = 10, search = "" } = req.body;

        const pageNumber = parseInt(page) || 1;
        const limitNumber = parseInt(limit) || 10;
        const skip = (pageNumber - 1) * limitNumber;

        /* 1️⃣ Get User */
        const user = await User.findById(userId).lean();

        let companyAdminDetails;

        let companyAdminId;

        if (user.role == "user") {
            companyAdminId = user.createdByWhichCompanyAdmin;

            companyAdminDetails = await User.findById(companyAdminId);
        } else if (user.role == "companyAdmin") {
            companyAdminDetails = user;
        }

        companyAdminId = companyAdminDetails._id;

        if (!companyAdminDetails?.whatsappWaba) {
            return res.status(400).json({
                success: false,
                message: "WABA not connected"
            });
        }


        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        let campaigns = companyAdminDetails.campaigns || [];

        /* 🔹 TOTAL COUNT (before search) */
        const fullCount = campaigns.length;

        /* 🔍 SEARCH FILTER */
        if (search) {
            const searchLower = search.toLowerCase();

            campaigns = campaigns.filter(c =>
                (c.campaignName || "")
                    .toLowerCase()
                    .includes(searchLower) ||
                (c.templateName || "")
                    .toLowerCase()
                    .includes(searchLower)
            );
        }

        /* 🔹 COUNT AFTER SEARCH */
        const filteredCount = campaigns.length;

        /* =======================================================
           ✅ SORT LATEST FIRST (TIME-WISE PROPER ORDER)
           Handles null / string / missing dates safely
        ======================================================= */
        campaigns.sort((a, b) => {

            const dateA = a.createdAt
                ? new Date(a.createdAt).getTime()
                : 0;

            const dateB = b.createdAt
                ? new Date(b.createdAt).getTime()
                : 0;

            return dateB - dateA; // Latest first
        });

        /* =======================================================
           ✅ PAGINATION AFTER SORT
        ======================================================= */
        const paginatedCampaigns =
            campaigns.slice(skip, skip + limitNumber);

        const results = [];

        /* =======================================================
           2️⃣ LOOP CAMPAIGNS
        ======================================================= */
        for (const camp of paginatedCampaigns) {

            const messageIds =
                camp.messageRefs?.map(m => m.metaMessageId) || [];

            /* 3️⃣ FETCH MESSAGE STATUS */
            const messages = await WhatsAppMessage.find({
                metaMessageId: { $in: messageIds },
            }).lean();

            const total = messageIds.length;

            /* 📊 STATUS COUNTS */
            let delivered = 0;
            let read = 0;

            messages.forEach(m => {

                if (
                    m.status === "delivered" ||
                    m.status === "read"
                ) {
                    delivered++;
                }

                if (m.status === "read") {
                    read++;
                }
            });

            /* 📈 RATES */
            const deliveryRate = total
                ? ((delivered / total) * 100).toFixed(0)
                : 0;

            const readRate = total
                ? ((read / total) * 100).toFixed(0)
                : 0;

            /* 📦 PUSH RESULT */
            results.push({
                campaignId: camp.campaignId,
                campaignName: camp.campaignName,
                templateName: camp.templateName,
                templateId: camp.templateId,
                status: camp.status || "unknown",
                totalMessages: total,
                deliveryRate: `${deliveryRate}%`,
                readRate: `${readRate}%`,
                scheduledAt: camp.scheduledAt,
                sentAt: camp.sentAt,
                createdAt: camp.createdAt,
            });
        }

        /* =======================================================
           ✅ FINAL RESPONSE
        ======================================================= */
        return res.json({
            status: "success",
            message: "Campaigns retrieved successfully",
            /* Counts */
            count: fullCount,     // before search
            filteredCampaigns: filteredCount, // after search

            /* Pagination */
            totalPages: Math.ceil(
                filteredCount / limitNumber
            ),
            currentPage: pageNumber,
            limit: limitNumber,

            /* Data */
            campaigns: results,
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/*
GET /api/campaigns/:campaignId
Campaign Details
*/
exports.getCampaignDetails = async (req, res) => {
    try {
        const userId = req.user._id;
        const { campaignId } = req.body;

        let companyAdminDetails;

        let companyAdminId;

        const user = await User.findById(userId).lean();

        if (user.role == "user") {
            companyAdminId = user.createdByWhichCompanyAdmin;

            companyAdminDetails = await User.findById(companyAdminId);
        } else if (user.role == "companyAdmin") {
            companyAdminDetails = user;
        }

        companyAdminId = companyAdminDetails._id;

        if (!companyAdminDetails?.whatsappWaba) {
            return res.status(400).json({
                success: false,
                message: "WABA not connected"
            });
        }


        /* 1️⃣ Find Campaign */
        companyAdminDetails = await User.findOne(
            {
                _id: companyAdminId,
                "campaigns.campaignId": campaignId,
            },
            {
                "campaigns.$": 1,
            }
        ).lean();

        if (!companyAdminDetails || !companyAdminDetails.campaigns.length) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found",
            });
        }

        const campaign = companyAdminDetails.campaigns[0];

        /* 2️⃣ Get Message IDs */
        const messageIds = campaign.messageRefs.map(
            m => m.metaMessageId
        );

        /* 3️⃣ Fetch Messages */
        const messages = await WhatsAppMessage.find({
            metaMessageId: { $in: messageIds },
        })
            .sort({ createdAt: -1 })
            .lean();

        /* 4️⃣ Counts (CUMULATIVE) */
        const total = messageIds.length;

        let sent = 0;
        let delivered = 0;
        let read = 0;
        let failed = 0;

        messages.forEach(m => {
            if (m.status === "failed") {
                failed++;
                return; // failed stops progression
            }

            // If message exists → it was sent
            sent++;

            if (m.status === "delivered" || m.status === "read") {
                delivered++;
            }

            if (m.status === "read") {
                read++;
            }
        });

        /* 5️⃣ Format List */
        const list = campaign.messageRefs.map(ref => {
            const msg = messages.find(
                m => m.metaMessageId === ref.metaMessageId
            );

            return {
                metaMessageId: ref.metaMessageId,
                chatNumber: ref.chatNumber,
                // templateId: ref.templateId,
                status: msg?.status || "sent",
                chatName: msg?.senderName || ref.chatNumber,
                sentAt: msg?.messageSentTimestamp || null,
                deliveredAt: msg?.messageDeliveredTimestamp || null,
                readAt: msg?.messageReadTimestamp || null,
                failedAt: msg?.messageFailedTimestamp || null,
            };
        });

        /* 6️⃣ Response */
        return res.json({
            success: true,

            campaign: {
                campaignId: campaign.campaignId,
                campaignName: campaign.campaignName,
                templateName: campaign.templateName,
                templateId: campaign.templateId,
                createdAt: campaign.createdAt,
                scheduledAt: campaign.scheduledAt,
            },

            stats: {
                total,
                sent,
                delivered,
                read,
                failed,
            },

            messages: list,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

exports.deleteCampaign = async (req, res) => {
    try {
        const userId = req.user._id;
        const { campaignId } = req.body;

        const result = await User.updateOne(
            { _id: userId },
            { $pull: { campaigns: { campaignId } } }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found or already deleted",
            });
        }

        return res.json({
            status: "success",
            message: "Campaign deleted successfully",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


exports.getWhatsappConversations = async (req, res) => {
    try {
        const userId = req.user._id;
        const type = req.body.type || "history";
        const page = parseInt(req.body.page) || 1;
        const limit = parseInt(req.body.limit) || 10;
        const search = req.body.search || "";

        const skip = (page - 1) * limit;

        const user = await User.findById(userId);
        let companyAdminId;

        if (user.role === "user") {
            companyAdminId = user.createdByWhichCompanyAdmin;
        } else if (user.role === "companyAdmin") {
            companyAdminId = user._id;
        } else {
            companyAdminId = user._id; // fallback
        }

        const companyAdminObjectId = new mongoose.Types.ObjectId(companyAdminId);

        // 🔥 Get all agents under this company admin
        const agentUsers = await User.find(
            { createdByWhichCompanyAdmin: companyAdminId, role: "user" },
            { _id: 1 }
        );

        const agentIds = agentUsers.map(a => a._id);

        // 🔥 Include company admin also
        const ownerIds = [companyAdminObjectId, ...agentIds];

        const now = new Date();
        const before24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const aggregationPipeline = [
            { $match: { userId: companyAdminObjectId } },
            {
                $addFields: {
                    sortTime: {
                        $ifNull: [
                            "$messageTimestamp",
                            { $ifNull: ["$messageSentTimestamp", "$createdAt"] }
                        ]
                    },
                    normalizedConvNumber: {
                        $arrayElemAt: [{ $split: ["$conversationId", "@"] }, 0]
                    }
                }
            },
            { $sort: { sortTime: 1 } },
            {
                $group: {
                    _id: "$normalizedConvNumber",
                    from: { $first: "$normalizedConvNumber" },
                    originalName: {
                        $max: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ["$direction", "incoming"] },
                                        { $ne: ["$originalName", null] },
                                        { $ne: ["$originalName", ""] }
                                    ]
                                },
                                "$originalName",
                                null
                            ]
                        }
                    },
                    templateMessagesCount: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$direction", "outgoing"] }, { $eq: ["$messageType", "template"] }] },
                                1, 0
                            ]
                        }
                    },
                    sessionMessagesCount: { $sum: 1 },
                    firstIncomingMessageArray: {
                        $push: {
                            $cond: [
                                { $eq: ["$direction", "incoming"] },
                                { $ifNull: ["$content.text", { $concat: ["[", "$messageType", "]"] }] },
                                "$$REMOVE"
                            ]
                        }
                    },
                    lastMessageTime: { $last: "$sortTime" },
                    lastMessage: { $last: "$$ROOT" },
                    lastIncomingTime: {
                        $max: {
                            $cond: [{ $eq: ["$direction", "incoming"] }, "$sortTime", null]
                        }
                    },
                }
            },
            {
                $lookup: {
                    from: "contacts",
                    let: { convNumber: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $in: ["$createdBy", ownerIds] },
                                        {
                                            $in: [
                                                "$$convNumber",
                                                {
                                                    $map: {
                                                        input: "$phoneNumbers",
                                                        as: "p",
                                                        in: {
                                                            $replaceAll: {
                                                                input: { $concat: [{ $ifNull: ["$$p.countryCode", ""] }, { $ifNull: ["$$p.number", ""] }] },
                                                                find: "+", replacement: ""
                                                            }
                                                        }
                                                    }
                                                }
                                            ]
                                        }
                                    ]
                                }
                            }
                        },
                        { $project: { firstname: 1, lastname: 1 } }
                    ],
                    as: "contactData"
                }
            },
            {
                $lookup: {
                    from: "leads",
                    let: { convNumber: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $in: ["$createdBy", ownerIds] },
                                        {
                                            $in: [
                                                "$$convNumber",
                                                {
                                                    $map: {
                                                        input: "$phoneNumbers",
                                                        as: "p",
                                                        in: {
                                                            $replaceAll: {
                                                                input: { $concat: [{ $ifNull: ["$$p.countryCode", ""] }, { $ifNull: ["$$p.number", ""] }] },
                                                                find: "+", replacement: ""
                                                            }
                                                        }
                                                    }
                                                }
                                            ]
                                        }
                                    ]
                                }
                            }
                        },
                        { $project: { firstname: 1, lastname: 1 } }
                    ],
                    as: "leadData"
                }
            },
            {
                $addFields: {
                    chatName: {
                        $let: {
                            vars: {
                                contact: { $arrayElemAt: ["$contactData", 0] },
                                lead: { $arrayElemAt: ["$leadData", 0] }
                            },
                            in: {
                                $let: {
                                    vars: {
                                        contactName: {
                                            $trim: {
                                                input: {
                                                    $concat: [
                                                        { $ifNull: ["$$contact.firstname", ""] },
                                                        " ",
                                                        { $ifNull: ["$$contact.lastname", ""] }
                                                    ]
                                                }
                                            }
                                        },
                                        leadName: {
                                            $trim: {
                                                input: {
                                                    $concat: [
                                                        { $ifNull: ["$$lead.firstname", ""] },
                                                        " ",
                                                        { $ifNull: ["$$lead.lastname", ""] }
                                                    ]
                                                }
                                            }
                                        }
                                    },
                                    in: {
                                        $switch: {
                                            branches: [
                                                { case: { $and: [{ $ne: ["$$contactName", null] }, { $ne: ["$$contactName", ""] }] }, then: "$$contactName" },
                                                { case: { $and: [{ $ne: ["$$leadName", null] }, { $ne: ["$$leadName", ""] }] }, then: "$$leadName" },
                                                { case: { $and: [{ $ne: ["$originalName", null] }, { $ne: ["$originalName", ""] }] }, then: "$originalName" }
                                            ],
                                            default: "$from"
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            {
                $addFields: {
                    lastMessageType: "$lastMessage.messageType",

                    lastMessage: {
                        $switch: {
                            branches: [

                                {
                                    case: { $eq: ["$lastMessage.messageType", "text"] },
                                    then: "$lastMessage.content.text"
                                },

                                {
                                    case: { $eq: ["$lastMessage.messageType", "image"] },
                                    then: "📷 Photo"
                                },

                                {
                                    case: { $eq: ["$lastMessage.messageType", "video"] },
                                    then: "🎥 Video"
                                },

                                {
                                    case: {
                                        $in: ["$lastMessage.messageType", ["audio", "voice"]]
                                    },
                                    then: "🎤 Voice message"
                                },

                                {
                                    case: { $eq: ["$lastMessage.messageType", "document"] },
                                    then: "📎 Document"
                                },

                                {
                                    case: { $eq: ["$lastMessage.messageType", "location"] },
                                    then: "📍 Location"
                                },

                                {
                                    case: { $eq: ["$lastMessage.messageType", "contacts"] },
                                    then: "👤 Contact"
                                },

                                {
                                    case: { $eq: ["$lastMessage.messageType", "template"] },
                                    then: {
                                        $ifNull: [
                                            "$lastMessage.content.template.resolved.body",
                                            "Template message"
                                        ]
                                    }
                                }

                            ],
                            default: "New message"
                        }
                    }
                }
            },
            {
                $match: {
                    $and: [
                        search ? {
                            $or: [
                                { chatName: { $regex: search, $options: "i" } },
                                { from: { $regex: search, $options: "i" } }
                            ]
                        } : {},
                        type === "chats"
                            ? { lastIncomingTime: { $gte: before24Hours } }
                            : type === "history"
                                ? { $or: [{ lastIncomingTime: { $lt: before24Hours } }, { lastIncomingTime: null }] }
                                : {}
                    ]
                }
            },
            { $sort: { lastMessageTime: -1 } },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                from: 1,
                                originalName: 1,
                                chatName: 1,
                                lastMessageTime: 1,
                                lastIncomingTime: 1,
                                lastMessage: 1,
                                lastMessageType: 1,
                                templateMessages: "$templateMessagesCount",
                                sessionMessages: "$sessionMessagesCount",
                                firstUserMessage: { $arrayElemAt: ["$firstIncomingMessageArray", 0] },
                                isWabaChat: { $cond: [{ $gte: ["$lastIncomingTime", before24Hours] }, true, false] },
                                userActiveStatus: {
                                    $let: {
                                        vars: { diffMs: { $subtract: [new Date(), "$lastIncomingTime"] } },
                                        in: {
                                            $switch: {
                                                branches: [
                                                    {
                                                        case: { $lt: [{ $divide: ["$$diffMs", 60000] }, 60] },
                                                        then: { $concat: [{ $toString: { $floor: { $divide: ["$$diffMs", 60000] } } }, " min ago"] }
                                                    },
                                                    {
                                                        case: { $lt: [{ $divide: ["$$diffMs", 3600000] }, 24] },
                                                        then: { $concat: [{ $toString: { $floor: { $divide: ["$$diffMs", 3600000] } } }, " hr ago"] }
                                                    }
                                                ],
                                                default: { $concat: [{ $toString: { $floor: { $divide: ["$$diffMs", 86400000] } } }, " day ago"] }
                                            }
                                        }
                                    }
                                },
                                lastActiveConversation: "$lastIncomingTime",
                            }
                        }
                    ]
                }
            }
        ];

        const result = await WhatsAppMessage.aggregate(aggregationPipeline);
        const conversations = result[0].data;
        const totalCount = result[0].metadata[0]?.total || 0;

        /* -------------------------------------------------- */
        /* STEP 🔥 Sync isWabaChat with Contact & Lead        */
        /* -------------------------------------------------- */

        const foundUser = await User.findById(companyAdminId).select("whatsappWaba.chats");

        if (foundUser && foundUser.whatsappWaba) {
            const chats = foundUser.whatsappWaba.chats || [];
            const activeNumbers = [];
            const inactiveNumbers = [];

            chats.forEach(chat => {
                const lastIncoming = chat.lastIncomingTime;
                if (lastIncoming && new Date(lastIncoming) >= before24Hours) {
                    activeNumbers.push(chat.chatNumber);
                } else {
                    inactiveNumbers.push(chat.chatNumber);
                }
            });

            const updateCRM = async (Model, numbers, isWaba) => {
                if (numbers.length === 0) return;
                await Model.updateMany(
                    {
                        createdBy: { $in: ownerIds },
                        $expr: {
                            $gt: [
                                {
                                    $size: {
                                        $filter: {
                                            input: "$phoneNumbers",
                                            as: "p",
                                            cond: {
                                                $in: [
                                                    {
                                                        $replaceAll: {
                                                            input: { $concat: [{ $ifNull: ["$$p.countryCode", ""] }, { $ifNull: ["$$p.number", ""] }] },
                                                            find: "+", replacement: ""
                                                        }
                                                    },
                                                    numbers
                                                ]
                                            }
                                        }
                                    }
                                },
                                0
                            ]
                        }
                    },
                    { $set: { isWabaChat: isWaba } }
                );
            };

            await updateCRM(Contact, inactiveNumbers, false);
            await updateCRM(Contact, activeNumbers, true);
            await updateCRM(Lead, inactiveNumbers, false);
            await updateCRM(Lead, activeNumbers, true);
        }

        res.json({
            status: "success",
            message: "chats received",
            data: conversations,
            totalCount
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch conversations",
        });
    }
};

/** STEP 8: Get WhatsApp Messages for a Chat
 */
exports.getWhatsappMessages = async (req, res) => {
    try {
        const userId = req.user._id;
        const { chatNumber } = req.body;
        let messagePage = parseInt(req.body.messagePage);
        const limit = parseInt(req.body.messagePageLimit) || 15; // default 15 for better chat feel
        const search = req.body.messageSearch || "";

        if (!chatNumber) {
            return res.status(400).json({
                success: false,
                message: "chatNumber is required"
            });
        }

        const user = await User.findById(userId);
        let companyAdminId;

        if (user.role === "user") {
            companyAdminId = user.createdByWhichCompanyAdmin;
        } else if (user.role === "companyAdmin") {
            companyAdminId = user._id;
        } else {
            companyAdminId = user._id;
        }

        const companyAdminObjectId = new mongoose.Types.ObjectId(companyAdminId);

        // Match messages for this chat within the company's scope
        // We look for chatNumber within conversationId, from, or to fields
        const conversationFilter = {
            userId: companyAdminObjectId,
            $or: [
                { conversationId: { $regex: chatNumber } },
                { from: { $regex: chatNumber } },
                { to: { $regex: chatNumber } }
            ]
        };

        const searchFilter = search ? {
            $or: [
                { "content.text": { $regex: search, $options: "i" } },
                { "content.caption": { $regex: search, $options: "i" } },
                { "content.fileName": { $regex: search, $options: "i" } },
                { "content.address": { $regex: search, $options: "i" } },
                { "content.name": { $regex: search, $options: "i" } },
                { "content.template.resolved.header": { $regex: search, $options: "i" } },
                { "content.template.resolved.body": { $regex: search, $options: "i" } }
            ]
        } : {};

        const filter = {
            ...conversationFilter,
            ...searchFilter
        };

        const totalCount = await WhatsAppMessage.countDocuments(filter);
        const totalPages = Math.ceil(totalCount / limit);

        // Accumulative (Upend) Pagination Logic:
        // Page 1 = Latest 15 messages (Page 1)
        // Page 2 = Latest 30 messages (Page 1 + Page 2)
        // Page 3 = Latest 45 messages (Page 1 + Page 2 + Page 3)
        if (!messagePage || isNaN(messagePage)) {
            messagePage = 1;
        }

        const accumulativeLimit = messagePage * limit;

        const pipeline = [
            { $match: filter },
            {
                $addFields: {
                    sortTime: {
                        $ifNull: [
                            "$messageTimestamp",
                            { $ifNull: ["$messageSentTimestamp", "$createdAt"] }
                        ]
                    }
                }
            },
            { $sort: { sortTime: -1 } }, // Newest first for slicing
            { $limit: accumulativeLimit } // Fetch all pages from 1 to current
        ];

        const messages = await WhatsAppMessage.aggregate(pipeline);

        // Reverse to return Chronological order (Oldest -> Newest) for the entire set
        const chronologicalMessages = messages.reverse();

        res.json({
            status: "success",
            message: "messages received",
            data: chronologicalMessages,
            pagination: {
                totalCount,
                totalPages,
                currentPage: messagePage,
                limit,
                hasMore: messagePage < totalPages
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch messages",
        });
    }
};

exports.deleteChats = async (req, res) => {
    try {
        const userId = req.user._id;
        const { conversationIds } = req.body;
        await WhatsAppMessage.deleteMany({
            userId,
            conversationId: { $in: conversationIds },
        });
        res.json({
            status: "success",
            message: "Chats deleted successfully",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to delete conversations",
        });
    }
};

exports.manageWabaAssignment = async (req, res) => {
    try {
        const companyAdminId = req.user._id;
        const { wabaAssigned } = req.body;

        /* ================================
           1️⃣ Validate Input
        =================================*/
        if (!wabaAssigned || !Array.isArray(wabaAssigned) || wabaAssigned.length === 0) {
            return res.status(400).json({
                success: false,
                message: "agentIds array is required",
            });
        }

        /* ================================
           2️⃣ Verify Company Admin
        =================================*/
        const companyAdmin = await User.findOne({
            _id: companyAdminId,
            role: "companyAdmin",
        });

        if (!companyAdmin) {
            return res.status(403).json({
                success: false,
                message: "Only company admin can manage WABA assignment",
            });
        }

        /* ================================
           3️⃣ Get Agent IDs List
        =================================*/
        const ids = wabaAssigned.map(a => a.agentId);

        const agents = await User.find({
            _id: { $in: ids },
            role: "user",
            createdByWhichCompanyAdmin: companyAdminId,
        });

        if (agents.length !== ids.length) {
            return res.status(400).json({
                success: false,
                message: "Some agents do not belong to this company admin",
            });
        }

        /* ================================
           4️⃣ Process Each Agent
        =================================*/
        const bulkOps = [];

        for (const item of wabaAssigned) {
            const { agentId, assigned } = item;

            if (typeof assigned !== "boolean") {
                return res.status(400).json({
                    success: false,
                    message: `Assigned flag must be true/false for agent ${agentId}`,
                });
            }

            // ASSIGN
            if (assigned === true) {
                if (!companyAdmin.whatsappWaba?.isConnected) {
                    return res.status(400).json({
                        success: false,
                        message: "Company admin has no connected WABA",
                    });
                }

                const wabaData = {
                    ...companyAdmin.whatsappWaba.toObject(),
                    chats: [],
                    isConnected: true,
                };

                bulkOps.push({
                    updateOne: {
                        filter: { _id: agentId },
                        update: { $set: { whatsappWaba: wabaData } },
                    },
                });
            }

            // UNASSIGN
            else {
                bulkOps.push({
                    updateOne: {
                        filter: { _id: agentId },
                        update: {
                            $set: {
                                whatsappWaba: {
                                    isConnected: false,
                                    wabaId: null,
                                    phoneNumberId: null,
                                    businessAccountId: null,
                                    accessToken: null,
                                    tokenExpiresAt: null,
                                    phoneNumber: null,
                                    displayName: null,
                                    qualityRating: null,
                                    messagingLimit: null,
                                    businessVerificationStatus: null,
                                    accountReviewStatus: null,
                                    status: null,
                                    profile: {},
                                    webhook: {},
                                    chats: [],
                                },
                            },
                        },
                    },
                });
            }
        }

        /* ================================
           5️⃣ Execute Bulk Update
        =================================*/
        if (bulkOps.length > 0) {
            await User.bulkWrite(bulkOps);
        }

        return res.status(200).json({
            success: true,
            message: "WABA assignment updated successfully",
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};