const express = require("express");
const router = express.Router();
const getValidAccessToken = require("../controllers/getValidAccessToken");

// GET /api/yeastar/calls/:extension?startTime=&endTime=&page=&pageSize=
router.get("/", getValidAccessToken);

module.exports = router;
