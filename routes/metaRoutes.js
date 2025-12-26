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
 * 4. Import Leads from Selected Form
 * ===============================
 */
router.post(
  "/import-leads",
  checkForAuthentication(),
  metaController.importExistingLeads
);

/**
 * ===============================
 * 6. Pabbly → Lead Webhook (DISABLED)
 * ===============================
 * Webhook functionality temporarily disabled
 * Focus on manual import only for now
 */
// router.post("/webhook/lead", verifyPabbly, metaController.metaLeadWebhook);

module.exports = router;
