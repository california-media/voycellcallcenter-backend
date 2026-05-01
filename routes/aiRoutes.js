const express = require("express");
const multer  = require("multer");
const router  = express.Router();
const { generateContent, transcribeAndSummarize } = require("../controllers/aiController");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }); // 25 MB max for audio

// Generate email / notification content (superadmin only — enforced at registration)
router.post("/generate-content",         generateContent);

// Transcribe + summarize a call recording (any authenticated user)
router.post("/transcribe-and-summarize", upload.single("audio"), transcribeAndSummarize);

module.exports = router;
