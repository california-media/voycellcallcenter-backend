const express = require("express");
const router = express.Router();
const { addOrUpdateMeeting, deleteMeeting } = require("../controllers/meetingController");

router.post("/addUpdateMeeting", addOrUpdateMeeting);

router.delete("/deleteMeeting", deleteMeeting);

module.exports = router;
