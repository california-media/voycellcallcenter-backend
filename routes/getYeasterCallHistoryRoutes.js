const express = require("express");
const router = express.Router();
const { getExtensionCallHistory } = require("../controllers/getYeasterCallHistoryController");

// GET /api/yeastar/calls/:extension?startTime=&endTime=&page=&pageSize=
router.get("/calls/:extension", getExtensionCallHistory);

module.exports = router;
