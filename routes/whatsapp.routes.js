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
    getWabaProfile,
    updateWabaProfile,
    sendTemplateBulkMessage,
    refreshWabaToken,
    getAllCampaigns,
    getCampaignDetails,
    deleteCampaign,
} = require("../controllers/whatsapp.controller");
const { createTemplate, getWabaTemplates, deleteWabaTemplate, getApprovedTemplates, getTemplateById } = require("../controllers/whatsappTemplateController");
const upload = multer();

router.get("/connect", checkForAuthentication(), connectWhatsApp);
router.get("/callback", whatsappCallback);

router.get("/profile", checkForAuthentication(), getWabaProfile);

router.put("/profile/edit", checkForAuthentication(), upload.single("profile"), updateWabaProfile);

router.post("/refresh-token", checkForAuthentication(), refreshWabaToken);

router.get("/webhook", webhookVerify);
router.post("/webhook", webhookReceive);


router.delete("/delete-waba-template", checkForAuthentication(), deleteWabaTemplate);
router.post("/create-template", upload.single("media_url"), checkForAuthentication(), createTemplate);
router.get("/get-waba-templates", checkForAuthentication(), getWabaTemplates);
router.post("/send-text", checkForAuthentication(), sendTextMessage);
router.post("/send-template", checkForAuthentication(), sendTemplateMessage);//sendTemplateMessage
router.get("/approved-templates", checkForAuthentication(), getApprovedTemplates);
router.get("/templateById", checkForAuthentication(), getTemplateById);


router.post("/send-campaign", checkForAuthentication(), sendTemplateBulkMessage);
router.post("/campaigns", checkForAuthentication(), getAllCampaigns);
router.post("/campaignsById", checkForAuthentication(), getCampaignDetails);
router.delete("/delete/campaigns", checkForAuthentication(), deleteCampaign);

router.post("/conversations", checkForAuthentication(), getWhatsappConversations);
router.post("/send-message", checkForAuthentication(), upload.single("file"), sendMessage);
module.exports = router;