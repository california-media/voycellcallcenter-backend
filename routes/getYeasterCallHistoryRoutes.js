const express = require("express");
const router = express.Router();
const checkRole = require("../middlewares/roleCheck");

const {
  fetchAndStoreCallHistory,
  getCompanyCallHistory,
  callRecordingDownload,
  getPhoneNumberCallHistory,
  getAgentCallHistory,
  getInboundOutBoundCallGraph,
  addFormDataAfterCallEnd,
  getMonthlyCallGraph,
} = require("../controllers/getYeasterCallHistoryController");

router.post("/fetch-and-store", fetchAndStoreCallHistory);

router.post(
  "/company-call-history",
  checkRole(["companyAdmin"]),
  getCompanyCallHistory
);

router.post("/recording", callRecordingDownload);

router.post("/phone-number-call-history", getPhoneNumberCallHistory);

router.post("/agent-call-history", checkRole(["user"]), getAgentCallHistory);

router.post("/dashboard-call-history", getMonthlyCallGraph);

router.get("/inbound-outbound-call-graph", getInboundOutBoundCallGraph);

router.post("/addFormDataAfterCallEnd", addFormDataAfterCallEnd);

module.exports = router;
