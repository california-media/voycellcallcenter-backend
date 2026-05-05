// const OpenAI = require("openai");
const multer  = require("multer");
const { Readable } = require("stream");

// const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── POST /ai/generate-content ─────────────────────────────────────────────────
exports.generateContent = async (req, res) => {
  return res.status(503).json({ status: "error", message: "AI content generation is currently disabled." });

  // try {
  //   const { prompt, type = "email" } = req.body;
  //   if (!prompt?.trim()) return res.status(400).json({ status: "error", message: "prompt is required" });

  //   const isEmail = type === "email";

  //   const systemPrompt = isEmail
  //     ? `You are an expert email copywriter for VOYCELL, a VoIP and call-center SaaS platform.
  // Generate exactly 3 distinct professional email variations based on the user's request.
  // Each variation must have:
  //   - "subject": a compelling email subject line (max 100 chars)
  //   - "title": the main heading inside the email body — can include inline HTML for styling (e.g. <span style="color:#6366f1">text</span>)
  //   - "body": a complete, well-structured HTML email body (use <p>, <b>, <ul>, <li>, <a>, inline styles — NO <html>/<head>/<body> tags)
  // Return ONLY a valid JSON array of 3 objects. No explanation, no markdown code block.`
  //     : `You are writing in-app push notifications for VOYCELL, a VoIP and call-center SaaS.
  // Generate exactly 3 distinct notification variations based on the user's request.
  // Each variation must have:
  //   - "title": short notification title (max 80 chars)
  //   - "description": one-line preview shown in the notification list (max 200 chars, plain text)
  //   - "body": full message shown when user opens the notification — can include simple HTML
  // Return ONLY a valid JSON array of 3 objects. No explanation, no markdown code block.`;

  //   const response = await getOpenAI().chat.completions.create({
  //     model: "gpt-4o-mini",
  //     messages: [
  //       { role: "system",  content: systemPrompt },
  //       { role: "user",    content: prompt.trim() },
  //     ],
  //     temperature: 0.8,
  //     response_format: { type: "json_object" },
  //   });

  //   const raw = response.choices[0].message.content;

  //   let parsed;
  //   try {
  //     const obj = JSON.parse(raw);
  //     parsed = Array.isArray(obj) ? obj : (obj.variations || obj.emails || obj.notifications || Object.values(obj)[0]);
  //   } catch (_) {
  //     return res.status(500).json({ status: "error", message: "AI returned unparseable JSON", raw });
  //   }

  //   if (!Array.isArray(parsed)) {
  //     return res.status(500).json({ status: "error", message: "AI response was not an array", raw });
  //   }

  //   res.json({ status: "success", suggestions: parsed.slice(0, 4) });
  // } catch (err) {
  //   console.error("[AI] generateContent error:", err.message);
  //   res.status(500).json({ status: "error", message: err.message });
  // }
};

// ── POST /ai/transcribe-and-summarize ─────────────────────────────────────────
exports.transcribeAndSummarize = async (req, res) => {
  return res.status(503).json({ status: "error", message: "AI transcription is currently disabled." });

  // try {
  //   const openai = getOpenAI();
  //   let audioFile;

  //   if (req.file) {
  //     const stream = Readable.from(req.file.buffer);
  //     stream.path = req.file.originalname || "call_audio.mp3";
  //     audioFile = stream;
  //   } else if (req.body?.audioUrl) {
  //     const fetch = (await import("node-fetch")).default;
  //     const resp  = await fetch(req.body.audioUrl);
  //     const buffer= Buffer.from(await resp.arrayBuffer());
  //     const stream = Readable.from(buffer);
  //     stream.path = "call_audio.mp3";
  //     audioFile = stream;
  //   } else {
  //     return res.status(400).json({ status: "error", message: "Provide an audio file or audioUrl" });
  //   }

  //   const transcription = await openai.audio.transcriptions.create({
  //     file:  audioFile,
  //     model: "whisper-1",
  //   });
  //   const transcriptText = transcription.text;

  //   const summaryResponse = await openai.chat.completions.create({
  //     model: "gpt-4o-mini",
  //     messages: [
  //       { role: "system", content: "You summarize call transcripts concisely." },
  //       { role: "user",   content: `Summarize this transcript in 3-4 sentences:\n\n${transcriptText}` },
  //     ],
  //     temperature: 0.3,
  //   });

  //   res.json({
  //     status:     "success",
  //     transcript: transcriptText,
  //     summary:    summaryResponse.choices[0].message.content,
  //   });
  // } catch (err) {
  //   console.error("[AI] transcribeAndSummarize error:", err.message);
  //   res.status(500).json({ status: "error", message: err.message });
  // }
};
