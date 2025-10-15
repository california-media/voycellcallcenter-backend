// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const { checkEmailPhoneDuplicate } = require("../controllers/checkEmailPhoneController");

router.post("/", checkEmailPhoneDuplicate);

module.exports = router;
