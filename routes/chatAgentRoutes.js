const express = require("express");
const { checkForAuthentication } = require("../middlewares/authentication");
const { chatAgent } = require("../controllers/chatAgentController");
const checkAccountStatus = require("../middlewares/checkAccountStatus");
const router = express.Router();

router.post("/", checkForAuthentication(), checkAccountStatus, chatAgent);

module.exports = router;