const express = require("express");
const router  = express.Router();
const { checkForAuthentication } = require("../middlewares/authentication");
const { preCallCheck, deductLiveMinute, callEnded, triggerAutoRecharge } = require("../controllers/liveBillingController");

// All routes require auth; accessible to both companyAdmin and agents
router.post("/pre-call-check",         checkForAuthentication(), preCallCheck);
router.post("/live-minute",            checkForAuthentication(), deductLiveMinute);
router.post("/call-ended",             checkForAuthentication(), callEnded);
router.post("/trigger-auto-recharge",  checkForAuthentication(), triggerAutoRecharge);

module.exports = router;
