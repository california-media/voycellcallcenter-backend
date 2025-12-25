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
router.get(
  "/callback",
  metaController.facebookCallback
);

/**
 * ===============================
 * 3. Get Facebook Pages
 * ===============================
 */
router.get(
  "/pages",
  checkForAuthentication(),
  metaController.getFacebookPages
);

/**
 * ===============================
 * 4. Save Selected Page
 * ===============================
 */
router.post(
  "/pages",
  checkForAuthentication(),
  metaController.saveFacebookPage
);

/**
 * ===============================
 * 5. Pabbly → Lead Webhook
 * ===============================
 * ❌ NO AUTH
 * ✅ Verified via secret
 */
router.post(
  "/webhooks/pabbly/meta-lead",
  verifyPabbly,
  metaController.metaLeadWebhook
);

module.exports = router;
