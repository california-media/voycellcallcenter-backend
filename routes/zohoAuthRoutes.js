const express = require("express");
const router = express.Router();
const { connectZoho, zohoCallback, disconnectZoho } = require("../controllers/zoho.controller");
const { checkForAuthentication } = require("../middlewares/authentication");

router.post("/connect", checkForAuthentication(), connectZoho);
router.get("/callback", zohoCallback);
router.post("/disconnect", checkForAuthentication(), disconnectZoho);

module.exports = router;
