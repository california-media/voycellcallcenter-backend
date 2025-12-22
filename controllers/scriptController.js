// const crypto = require("crypto");
// const ScriptToken = require("../models/ScriptToken");
// const User = require("../models/userModel");
// const API_BASE_URL = process.env.API_BASE_URL || "";
// const SERVER_BASE = API_BASE_URL || "http://localhost:4004";
// // Public frontend domain where widget will be embedded
// const FRONTEND_BASE = "https://voycellcallcenter.vercel.app";

// // // (Keep API base for backend usage if needed)
// // const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4004";

// exports.generateScriptTag = async (req, res) => {
//   try {
//     const userId = req.user._id;
//     const user = await User.findById(userId);

//     if (!user || !user.extensionNumber) {
//       return res.status(400).json({ error: "User or extension not found" });
//     }

//     // Save popup settings
//     user.popupSettings = {
//       themeColor: req.body.themeColor || "#4CAF50",
//       popupHeading: req.body.popupHeading || "📞 Request a Call Back",
//       popupText:
//         req.body.popupText ||
//         "Enter your phone number and we’ll call you back in 30 seconds!",
//       calltoaction: req.body.calltoaction || "📞 Call Me",
//     };
//     await user.save();

//     // Generate secure token
//     const token = crypto.randomBytes(16).toString("hex");

//     await ScriptToken.create({
//       token,
//       userId,
//       extensionNumber: user.extensionNumber,
//     });

//     // const path = `${token}`;

//     // This will be your *public safe URL*
//     //for local
//     // const scriptUrl = `${SERVER_BASE}/voycell_callback/${token}.js`;

//     //for live
//     const scriptUrl = `${FRONTEND_BASE}/voycell_callback/${token}`;

//     res.setHeader("Content-Type", "text/html; charset=utf-8");
//     res.status(200).send(`<script src="${scriptUrl}"></script>`);
//   } catch (err) {
//     console.error("generateScriptTag Error:", err);
//     res.status(500).json({ error: "Server Error" });
//   }
// };

// controllers/scriptController.js (or your existing file)
// controllers/scriptController.js (or your existing file)
const crypto = require("crypto");
const ScriptToken = require("../models/ScriptToken");
const FormCallScriptToken = require("../models/FormCallScriptToken");
const User = require("../models/userModel");

const FRONTEND_BASE =
  process.env.FRONTEND_BASE || "https://app.voycell.com";

exports.generateScriptTag = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user || !user.extensionNumber) {
      return res.status(400).json({ error: "User or extension not found" });
    }

    if (user.extensionStatus === false) {
      return res.status(400).json({
        status: "error",
        message: "Not Activated Calling Facility.",
      });
    }

    // === 1️⃣ Normalize allowedOrigin (remove trailing slash + lowercase) ===
    // const allowedOrigin = (req.body.allowedOrigin || "")
    //   .trim()
    //   .replace(/\/+$/, "")
    //   .toLowerCase();
    const allowedOrigins = Array.isArray(req.body.allowedOrigin)
      ? req.body.allowedOrigin
        .map(o => o.trim().replace(/\/+$/, "").toLowerCase())
        .filter(Boolean)
      : [];


    // === 2️⃣ Update popup settings (always save) ===
    user.popupSettings = {
      themeColor:
        req.body.themeColor || user.popupSettings?.themeColor || "#4CAF50",
      headingColor:
        req.body.headingColor || user.popupSettings?.headingColor || "#4CAF50",
      floatingButtonColor:
        req.body.floatingButtonColor ||
        user.popupSettings?.floatingButtonColor ||
        "#4CAF50",
      popupHeading:
        req.body.popupHeading ||
        user.popupSettings?.popupHeading ||
        "📞 Request a Call Back",
      popupText:
        req.body.popupText ||
        user.popupSettings?.popupText ||
        "Enter your phone number and we’ll call you back in 30 seconds!",
      calltoaction:
        req.body.calltoaction ||
        user.popupSettings?.calltoaction ||
        "📞 Call Me",
      phoneIconColor:
        req.body.phoneIconColor ||
        user.popupSettings?.phoneIconColor ||
        "black",
    };


    if (allowedOrigins.length > 0) {
      user.popupSettings.allowedOrigin = allowedOrigins;
    }
    // === 4️⃣ Save user settings ===

    await user.save();

    // === Stable-token policy: one token per user ===
    let tokenDoc = await ScriptToken.findOne({ userId }).sort({ createdAt: -1 });
    let token;

    if (tokenDoc) {
      token = tokenDoc.token;

      // ✅ Always sync extension number
      const updatePayload = {
        extensionNumber: user.extensionNumber,
        updatedAt: new Date(),
      };

      // ✅ If allowedOrigins provided, overwrite array
      if (allowedOrigins.length > 0) {
        updatePayload.allowedOrigin = allowedOrigins;
      }

      await ScriptToken.findByIdAndUpdate(tokenDoc._id, updatePayload);
    } else {
      // 🆕 Create new token
      token = crypto.randomBytes(16).toString("hex");

      await ScriptToken.create({
        token,
        userId,
        extensionNumber: user.extensionNumber,
        allowedOrigin: allowedOrigins, // ✅ array
      });
    }


    // === 6️⃣ Build script URL (no .js) ===
    const scriptUrl = `${FRONTEND_BASE.replace(
      /\/+$/,
      ""
    )}/voycell_callback/${token}`;

    // === 7️⃣ Return <script> tag ===
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<script src="${scriptUrl}"></script>`);
  } catch (err) {
    console.error("generateScriptTag Error:", err);
    return res.status(500).json({ error: "Server Error" });
  }
};

exports.generateFormCallScriptTag = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user || !user.extensionNumber) {
      return res.status(400).json({ error: "User or extension not found" });
    }

    if (!user.extensionStatus) {
      return res.status(400).json({
        status: "error",
        message: "Calling facility not activated",
      });
    }

    // normalize allowed origins
    const allowedOrigins = Array.isArray(req.body.allowedOrigin)
      ? req.body.allowedOrigin
          .map(o => o.trim().replace(/\/+$/, "").toLowerCase())
          .filter(Boolean)
      : [];

    // 🔒 One stable token per user (recommended)
    let tokenDoc = await FormCallScriptToken.findOne({ userId }).sort({ createdAt: -1 });
    let token;

    if (tokenDoc) {
      token = tokenDoc.token;

      const update = {
        extensionNumber: user.extensionNumber,
        updatedAt: new Date(),
      };

      if (allowedOrigins.length > 0) {
        update.allowedOrigin = allowedOrigins;
      }

      await FormCallScriptToken.findByIdAndUpdate(tokenDoc._id, update);
    } else {
      token = crypto.randomBytes(16).toString("hex");

      await FormCallScriptToken.create({
        token,
        userId,
        extensionNumber: user.extensionNumber,
        allowedOrigin: allowedOrigins,
      });
    }

    const scriptUrl = `${FRONTEND_BASE.replace(
      /\/+$/,
      ""
    )}/voycell_form_call/${token}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<script src="${scriptUrl}"></script>`);
  } catch (err) {
    console.error("generateFormCallScriptTag error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
