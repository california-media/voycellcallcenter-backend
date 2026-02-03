const express = require("express");
const router = express.Router();
const { checkForAuthentication } = require("../middlewares/authentication");
const multer = require("multer");


const {
    connectWhatsApp,
    whatsappCallback,
    webhookVerify,
    webhookReceive,
    sendTextMessage,
    sendTemplateMessage,
    getWhatsappConversations,
    sendMessage,
} = require("../controllers/whatsapp.controller");
const { createTemplate, getWabaTemplates, deleteWabaTemplate } = require("../controllers/whatsappTemplateController");
const upload = multer();

router.get("/connect", checkForAuthentication(), connectWhatsApp);


router.get("/callback", whatsappCallback);
router.get("/webhook", webhookVerify);
router.post("/webhook", webhookReceive);


router.delete("/delete-waba-template", checkForAuthentication(), deleteWabaTemplate);
router.post("/create-template", upload.single("media_url"), checkForAuthentication(), createTemplate);
router.get("/get-waba-templates", checkForAuthentication(), getWabaTemplates);
router.post("/send-text", checkForAuthentication(), sendTextMessage);
router.post("/send-template", checkForAuthentication(), sendTemplateMessage);
router.post("/conversations", checkForAuthentication(), getWhatsappConversations);
router.post("/send-message", checkForAuthentication(), upload.single("file"), sendMessage);
module.exports = router;