const express = require("express");
const router = express.Router();
const { unlockAccount } = require("../controllers/authUnlockController");

router.get("/unlock", unlockAccount);

module.exports = router;
