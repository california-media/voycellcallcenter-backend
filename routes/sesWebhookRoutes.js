const express    = require("express");
const router     = express.Router();
const controller = require("../controllers/sesWebhookController");

// SNS sends Content-Type: text/plain with a JSON body.
// We parse it as text here so the controller can JSON.parse it manually.
// This route uses its own body-parser so it must be registered in index.js
// BEFORE the global express.json() middleware.
router.post("/", express.text({ type: "*/*" }), controller.handleSnsEvent);

module.exports = router;
