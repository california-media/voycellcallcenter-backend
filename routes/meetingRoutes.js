const express = require("express");
const router = express.Router();
const {
  getMeetingsForContact,
  addOrUpdateMeeting,
  deleteMeeting,
} = require("../controllers/meetingController");

router.get("/getAll", getMeetingsForContact);

router.post("/addUpdateMeeting", addOrUpdateMeeting);

router.delete("/deleteMeeting", deleteMeeting);

module.exports = router;
