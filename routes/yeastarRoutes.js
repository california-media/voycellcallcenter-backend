// routes/yeastarRoutes.js

const express = require("express");
const router = express.Router();
const { makeCallHandler } = require("../controllers/yeastarCallController");

// POST /api/yeastar/make-call
router.post("/make-call", makeCallHandler);

module.exports = router;
