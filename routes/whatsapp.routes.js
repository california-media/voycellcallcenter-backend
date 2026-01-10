const express = require("express");
const router = express.Router();
const { checkForAuthentication } = require("../middlewares/authentication");

const {
    connectWhatsApp,
    whatsappCallback,
    webhookVerify,
    webhookReceive,
    sendTextMessage,
    sendTemplateMessage,
} = require("../controllers/whatsapp.controller");

// User clicks connect
router.get("/connect", checkForAuthentication(), connectWhatsApp);

// Meta OAuth callback
router.get("/callback", whatsappCallback);

// Webhook
router.get("/webhook", webhookVerify);
router.post("/webhook", webhookReceive);

// Send messages
router.post("/send-text", checkForAuthentication(), sendTextMessage);
router.post("/send-template", checkForAuthentication(), sendTemplateMessage);
module.exports = router;
