const express = require("express");
const router = express.Router();
const {
  getYeastarLoginSignature,
} = require("../controllers/yeastarLoginController");

// POST /api/yeastar-login/get-signature
router.post("/get-signature",  getYeastarLoginSignature);

module.exports = router;
