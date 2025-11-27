// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const { checkEmailPhoneDuplicate } = require("../controllers/checkEmailPhoneController");
const checkAccountStatus = require("../middlewares/checkAccountStatus")


router.post("/", checkAccountStatus, checkEmailPhoneDuplicate);

module.exports = router;
