const express = require("express");
const router = express.Router();
const {
    verifyUser
} = require("../../controllers/admin/userVerifyController");


router.post("/", verifyUser);

module.exports = router;