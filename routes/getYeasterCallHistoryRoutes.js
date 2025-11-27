const express = require("express");
const router = express.Router();
const checkRole = require("../middlewares/roleCheck");
const checkAccountStatus = require("../middlewares/checkAccountStatus")

const { fetchAndStoreCallHistory,
    getCompanyCallHistory,
    callRecordingDownload,
    getPhoneNumberCallHistory,
    getAgentCallHistory,
    getInboundOutBoundCallGraph,
    addFormDataAfterCallEnd,
    getMonthlyCallGraph } = require("../controllers/getYeasterCallHistoryController");

router.post("/fetch-and-store", checkAccountStatus, fetchAndStoreCallHistory);

router.post("/company-call-history", checkAccountStatus, checkRole(["companyAdmin"]), getCompanyCallHistory);

router.post("/recording", checkAccountStatus, callRecordingDownload);

router.post("/phone-number-call-history", checkAccountStatus, getPhoneNumberCallHistory);

router.post("/agent-call-history", checkAccountStatus, checkRole(["user"]), getAgentCallHistory);

router.post("/dashboard-call-history", checkAccountStatus, getMonthlyCallGraph);

router.get("/inbound-outbound-call-graph", checkAccountStatus, getInboundOutBoundCallGraph);

router.post("/addFormDataAfterCallEnd", checkAccountStatus, addFormDataAfterCallEnd)

module.exports = router;
