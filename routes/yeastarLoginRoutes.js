const express = require("express");
const router = express.Router();
const {
  getYeastarLoginSignature,
} = require("../controllers/yeastarLoginController");
const checkAccountStatus = require("../middlewares/checkAccountStatus")


// POST /api/yeastar-login/get-signature
router.post("/get-signature", checkAccountStatus, getYeastarLoginSignature);

module.exports = router;
