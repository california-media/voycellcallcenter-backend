const express = require("express");
const router = express.Router();
const { connectZoho, zohoCallback } = require("../controllers/zoho.controller");
const { checkForAuthentication } = require("../middlewares/authentication");

router.post("/connect", checkForAuthentication(), connectZoho);
router.get("/callback", zohoCallback);

module.exports = router;
