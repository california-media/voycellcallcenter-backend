// routes/userRoutes.js
const express = require("express");
const { saveBulkContacts } = require("../controllers/saveBulkContactsController");
const router = express.Router();
console.log("inside the routes");

router.post("/", saveBulkContacts);

module.exports = router;
