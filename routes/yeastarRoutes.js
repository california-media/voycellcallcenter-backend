// routes/yeastarRoutes.js

const express = require("express");
const router = express.Router();
const {
  makeCallHandler,
  getCallHandler,
} = require("../controllers/yeastarCallController");

// POST /api/yeastar/make-call
router.post("/make-call", makeCallHandler);

// GET /api/yeastar/get-call
router.get("/get-call", getCallHandler);

module.exports = router;
