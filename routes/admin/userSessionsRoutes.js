const express = require("express");
const router = express.Router();
const { getUserSessions, getSessionStats } = require("../../controllers/admin/userSessionsController");

router.get("/", getUserSessions);
router.get("/stats", getSessionStats);

module.exports = router;
