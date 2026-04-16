const express = require("express");
const router = express.Router();
const { getUserActivity, getUserActivityStats, getSessionPath } = require("../../controllers/admin/userActivityController");

router.get("/", getUserActivity);
router.get("/stats", getUserActivityStats);
router.get("/session/:sessionId", getSessionPath);

module.exports = router;
