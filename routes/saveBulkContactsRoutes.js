// routes/userRoutes.js
const express = require("express");
const { saveBulkContacts } = require("../controllers/saveBulkContactsController");
const router = express.Router();
const checkAccountStatus = require("../middlewares/checkAccountStatus")


router.post("/", checkAccountStatus,saveBulkContacts);

module.exports = router;
