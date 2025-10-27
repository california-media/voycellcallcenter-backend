// const User = require("../models/userModel");

// const SERVER_BASE = API_BASE_URL || "http://localhost:4004";

// exports.generateScriptTag = async (req, res) => {
//     try {
//         // const user = await User.findById(req.userId);
//         const user = await User.findById(req.user._id).lean();
//         if (!user || !user.extensionNumber)
//             return res.status(400).json({ error: "User or extension not found" });

//         const ext = Buffer.from(String(user.extensionNumber)).toString("base64");

//         const params = new URLSearchParams({
//             ext,
//             themeColor: req.body.themeColor || "#4CAF50",
//             popupHeading: req.body.popupHeading || "📞 Request a Call Back",
//             popupText:
//                 req.body.popupText ||
//                 "Enter your phone number and we’ll call you back in 30 seconds!",
//             calltoaction: req.body.calltoaction || "📞 Call Me",
//         }).toString();

//         const scriptUrl = `${SERVER_BASE}/callback_system/callme.js?${params}`;
//         const scriptTag = `<script src="${scriptUrl}"></script>`;

//         res.json({ scriptTag, scriptUrl });
//     } catch (err) {
//         console.error("generateScriptTag Error:", err);
//         res.status(500).json({ error: "Server Error" });
//     }
// };

const User = require("../models/userModel");
const API_BASE_URL = process.env.API_BASE_URL || "";
const SERVER_BASE = API_BASE_URL || "http://localhost:4004";

// exports.generateScriptTag = async (req, res) => {
//   try {
//     const user = await User.findById(req.user._id).lean();
//     if (!user || !user.extensionNumber) {
//       return res.status(400).json({ error: "User or extension not found" });
//     }

//     const ext = Buffer.from(String(user.extensionNumber)).toString("base64");

//     const params = new URLSearchParams({
//       ext,
//       themeColor: req.body.themeColor || "#4CAF50",
//       popupHeading: req.body.popupHeading || "📞 Request a Call Back",
//       popupText:
//         req.body.popupText ||
//         "Enter your phone number and we’ll call you back in 30 seconds!",
//       calltoaction: req.body.calltoaction || "📞 Call Me",
//     }).toString();

//     const scriptUrl = `${SERVER_BASE}/voycell_callback?${params}`;
//     const scriptTag = `<script src="${scriptUrl}"></script>`;

//     // ✅ Send as plain text so no escaping (\) is added
//     res.setHeader("Content-Type", "text/html; charset=utf-8");
//     res.status(200).send(scriptTag);
//   } catch (err) {
//     console.error("generateScriptTag Error:", err);
//     res.status(500).json({ error: "Server Error" });
//   }
// };


exports.generateScriptTag = async (req, res) => {
  try {
    const userId = req.user._id;

    // Step 1️⃣ - Find the user
    const user = await User.findById(userId);
    if (!user || !user.extensionNumber) {
      return res.status(400).json({ error: "User or extension not found" });
    }

    // Step 2️⃣ - Update popup settings in DB
    user.popupSettings = {
      themeColor: req.body.themeColor || "#4CAF50",
      popupHeading: req.body.popupHeading || "📞 Request a Call Back",
      popupText:
        req.body.popupText ||
        "Enter your phone number and we’ll call you back in 30 seconds!",
      calltoaction: req.body.calltoaction || "📞 Call Me",
    };
    await user.save();

    // Step 3️⃣ - Generate a short script URL
    const ext = Buffer.from(String(user.extensionNumber)).toString("base64");
    const scriptUrl = `${SERVER_BASE}/voycell_callback?ext=${encodeURIComponent(ext)}`;
    const scriptTag = `<script src="${scriptUrl}"></script>`;

    // Step 4️⃣ - Return script tag (no escaping)
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(scriptTag);
  } catch (err) {
    console.error("generateScriptTag Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};