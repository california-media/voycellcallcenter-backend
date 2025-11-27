// routes/userRoutes.js
const express = require("express");
const { saveBulkContacts } = require("../controllers/saveBulkContactsController");
const router = express.Router();
console.log("inside the routes");
const checkAccountStatus = require("../middlewares/checkAccountStatus")


router.post("/", checkAccountStatus,saveBulkContacts);

module.exports = router;
