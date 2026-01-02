const express = require("express");
const router = express.Router();

const metaController = require("../controllers/metaController");
const { checkForAuthentication } = require("../middlewares/authentication");
const verifyPabbly = require("../middlewares/verifyPabbly");

/**
 * ===============================
 * 1. Connect Facebook (USER LOGGED IN)
 * ===============================
 */
router.get(
  "/connect",
  checkForAuthentication(), // ✅ user must be logged in
  metaController.connectFacebook
);

/**
 * ===============================
 * 2. Facebook OAuth Callback
 * ===============================
 * ❌ NO AUTH MIDDLEWARE HERE
 * Facebook servers call this API
 */
router.get("/callback", metaController.facebookCallback);

/**
 * ===============================
 * 3. Get Facebook Lead Forms
 * ===============================
 */
router.get("/pages", checkForAuthentication(), metaController.getFacebookPages);

/**
 * ===============================
 * 4. Subscribe/Unsubscribe Page for Webhooks
 * ===============================
 */
router.post(
  "/pages/subscribe",
  checkForAuthentication(),
  metaController.subscribeToPage
);

/**
 * ===============================
 * 5. Import Leads from Selected Form
 * ===============================
 */
router.post(
  "/import-leads",
  checkForAuthentication(),
  metaController.importExistingLeads
);

/**
 * ===============================
 * 5. Webhook Verification (GET)
 * Facebook calls this to verify your endpoint
 * ===============================
 */
router.get("/webhook", metaController.verifyWebhook);

/**
 * ===============================
 * 6. Lead Webhook (POST)
 * Facebook sends lead data here when new lead is created
 * ===============================
 */
router.post("/webhook", metaController.handleLeadWebhook);

module.exports = router;
