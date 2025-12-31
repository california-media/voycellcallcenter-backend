const express = require("express");
const router = express.Router();

const {
    sendBulkEmail,
} = require("../../controllers/admin/sendBulkEmailController");

router.post("/", sendBulkEmail);

module.exports = router;
