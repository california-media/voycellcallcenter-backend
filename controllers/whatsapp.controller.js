const axios = require("axios");
const User = require("../models/userModel");
const { META_GRAPH_URL } = require("../config/whatsapp");

const {
    META_APP_ID,
    META_APP_SECRET,
    META_REDIRECT_URI,
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
        `&redirect_uri=${META_REDIRECT_URI}` +
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
                    redirect_uri: META_REDIRECT_URI,
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

        res.redirect(`${FRONTEND_URL}/settings/whatsapp?connected=true`);
    } catch (err) {
        console.error("WhatsApp OAuth Error:", err.response?.data || err);
        res.redirect(`${FRONTEND_URL}/settings/whatsapp?error=true`);
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

/**
 * STEP 4: Receive messages
 */
exports.webhookReceive = async (req, res) => {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;

    if (value?.messages) {
        const msg = value.messages[0];
        console.log("Incoming WhatsApp Message:", msg);
        // 👉 Save to DB here
    }
    res.sendStatus(200);
};

/**
 * STEP 5: Send Text Message
 */
exports.sendTextMessage = async (req, res) => {
    const { to, text } = req.body;
    const userId = req.user._id;
    const user = await User.findById(userId);
    const { phoneNumberId, accessToken } = user.whatsappWaba;

    console.log("Sending message to:", to, "text:", text);
    console.log("Using phoneNumberId:", phoneNumberId);
    console.log("Using accessToken:", accessToken);

    await axios.post(
        `${META_GRAPH_URL}/${phoneNumberId}/messages`,
        {
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: text },
        },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
        }
    );

    res.json({ success: true });
};

/**
 * STEP 6: Send Template Message
 */
exports.sendTemplateMessage = async (req, res) => {
    const { to, templateName, language, components } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    const { phoneNumberId, accessToken } = user.whatsappWaba;

    await axios.post(
        `${META_GRAPH_URL}/${phoneNumberId}/messages`,
        {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: templateName,
                language: { code: language || "en_US" },
                components: components || [],
            },
        },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
        }
    );

    res.json({ success: true });
};
