const express = require("express");
const router = express.Router();
const { fetchAndStoreCallHistory, getCompanyCallHistory } = require("../controllers/getYeasterCallHistoryController");

router.post("/fetch-and-store", fetchAndStoreCallHistory);

router.post("/company-call-history", getCompanyCallHistory);

module.exports = router;
