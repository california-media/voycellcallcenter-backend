const express = require("express");
const { logMessageActivity } = require("../controllers/whatsappEmailActivityController");
const router = express.Router();

router.post("/", logMessageActivity);

module.exports = router;
