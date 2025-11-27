const express = require("express");
const router = express.Router();
const { getContactActivities } = require("../controllers/getActivityController");
const checkAccountStatus = require("../middlewares/checkAccountStatus")

// GET /api/contacts/activity?contact_id=123
router.post("/",checkAccountStatus, getContactActivities);

module.exports = router;
