const express = require("express");
const router = express.Router();
const {
  getMeetingsForContact,
  addOrUpdateMeeting,
  deleteMeeting,
} = require("../controllers/meetingController");
const checkAccountStatus = require("../middlewares/checkAccountStatus")

router.get("/getAll", checkAccountStatus, getMeetingsForContact);

router.post("/addUpdateMeeting", checkAccountStatus, addOrUpdateMeeting);

router.delete("/deleteMeeting", checkAccountStatus, deleteMeeting);

module.exports = router;
