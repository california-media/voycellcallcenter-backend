// routes/hubspot.routes.js
const express = require("express");
const router = express.Router();
const {
  connectHubSpot,
  hubspotCallback,
  disconnectHubSpot,
  testHubSpotConnection,
} = require("../controllers/hubspot.controller");
const { checkForAuthentication } = require("../middlewares/authentication");

router.post("/connect", checkForAuthentication(), connectHubSpot);
router.get("/callback", hubspotCallback);
router.post("/disconnect", checkForAuthentication(), disconnectHubSpot);
router.get("/test-connection", checkForAuthentication(), testHubSpotConnection);

module.exports = router;