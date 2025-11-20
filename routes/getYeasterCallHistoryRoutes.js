const express = require("express");
const router = express.Router();
const { fetchAndStoreCallHistory, getCompanyCallHistory, callRecordingDownload } = require("../controllers/getYeasterCallHistoryController");

router.post("/fetch-and-store", fetchAndStoreCallHistory);

router.post("/company-call-history", getCompanyCallHistory);

router.post("/recording", callRecordingDownload);

module.exports = router;
