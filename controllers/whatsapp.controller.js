const axios = require("axios");
const User = require("../models/userModel");
const { emitMessage } = require("../socketServer");
const { META_GRAPH_URL } = require("../config/whatsapp");

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

/**
 * STEP 4: Receive messages
 */
// exports.webhookReceive = async (req, res) => {
//     const value = req.body.entry?.[0]?.changes?.[0]?.value;
//     console.log("value = " + value);

//     if (value?.messages) {
//         const msg = value.messages[0];
//         console.log("Incoming WhatsApp Message:", msg);
//         // 👉 Save to DB here
//     }
//     res.sendStatus(200);
// };

// exports.webhookReceive = async (req, res) => {
//     const value = req.body.entry?.[0]?.changes?.[0]?.value;
//     console.log(value);
//     console.log(req.body.entry);

//     if (value?.messages) {
//         const msg = value.messages[0];

//         console.log("Incoming WhatsApp Message:", msg);

//         // Example mapping
//         const messagePayload = {
//             id: msg.id,
//             from: msg.from,
//             text: msg.text?.body,
//             timestamp: msg.timestamp,
//             type: msg.type,
//         };

//         // 👉 IMPORTANT: Map phone number to userId from DB
//         const user = await User.findOne({
//             "whatsappWaba.phoneNumber": value.metadata.display_phone_number,
//         });

//         if (user) {
//             emitMessage(user._id, messagePayload);
//         }
//     }

//     res.sendStatus(200);
// };

exports.webhookReceive = async (req, res) => {
    try {
        const entries = req.body.entry || [];

        for (const entry of entries) {
            for (const change of entry.changes || []) {
                const value = change.value;
                console.log(value.metadata);

                if (!value?.messages) continue;

                const phoneNumberId = value.metadata.phone_number_id;

                // 🔐 Find business owner
                const user = await User.findOne({
                    "whatsappWaba.phoneNumberId": phoneNumberId,
                });

                if (!user) continue;

                for (const msg of value.messages) {
                    const messagePayload = {
                        whatsappMessageId: msg.id,
                        businessPhoneNumberId: phoneNumberId,
                        from: msg.from, // customer number
                        to: value.metadata.display_phone_number,
                        text: msg.text?.body || null,
                        type: msg.type,
                        timestamp: Number(msg.timestamp) * 1000,
                    };

                    console.log("Incoming message:", messagePayload);

                    // 🔹 Save to DB (VERY IMPORTANT)
                    // await saveIncomingMessage(user._id, messagePayload);

                    // 🔹 Emit to frontend socket
                    emitMessage(user._id, messagePayload);
                }
            }
        }

        res.sendStatus(200);
    } catch (err) {
        console.error("Webhook error:", err);
        res.sendStatus(200); // ⚠️ Always 200 for Meta
    }
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
