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
const User = require("../models/userModel");

const FRONTEND_BASE = process.env.FRONTEND_BASE || "https://voycellcallcenter.vercel.app";

exports.generateScriptTag = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user || !user.extensionNumber) {
      return res.status(400).json({ error: "User or extension not found" });
    }

    // === 1️⃣ Normalize allowedOrigin (remove trailing slash + lowercase) ===
    const allowedOrigin = (req.body.allowedOrigin || "")
      .trim()
      .replace(/\/+$/, "")
      .toLowerCase();

    // === 2️⃣ Update popup settings (always save) ===
    user.popupSettings = {
      themeColor:
        req.body.themeColor || user.popupSettings?.themeColor || "#4CAF50",
      headingColor:
        req.body.headingColor || user.popupSettings?.headingColor || "#4CAF50",
      floatingButtonColor:
        req.body.floatingButtonColor || user.popupSettings?.floatingButtonColor || "#4CAF50",
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
    };

    // === 3️⃣ Save allowedOrigin in user (optional for tracking) ===
    if (allowedOrigin) {
      user.popupSettings.allowedOrigin = allowedOrigin;
    }

    await user.save();

    // // === 4️⃣ Check if token already exists for this user ===
    // const existingTokens = await ScriptToken.find({ userId }).lean();

    // let tokenDoc = null;
    // let token;

    // if (existingTokens.length > 0) {
    //   // ✅ Check if same domain already has a token
    //   tokenDoc = existingTokens.find(
    //     (t) =>
    //       (t.allowedOrigin || "").trim().toLowerCase() === allowedOrigin
    //   );

    //   if (tokenDoc) {
    //     // ✅ SAME DOMAIN → reuse existing token
    //     token = tokenDoc.token;
    //   } else {
    //     // 🚀 DIFFERENT DOMAIN → create new token
    //     token = crypto.randomBytes(16).toString("hex");
    //     await ScriptToken.create({
    //       token,
    //       userId,
    //       extensionNumber: user.extensionNumber,
    //       allowedOrigin: allowedOrigin,
    //     });
    //   }
    // } else {
    //   // 🆕 FIRST TIME → create new token
    //   token = crypto.randomBytes(16).toString("hex");
    //   await ScriptToken.create({
    //     token,
    //     userId,
    //     extensionNumber: user.extensionNumber,
    //     allowedOrigin: allowedOrigin,
    //   });
    // }

    // === 4️⃣ Stable-token policy: always reuse an existing token for the user ===
    // Try to find any existing token for the user (prefer the most recent)
    let tokenDoc = await ScriptToken.findOne({ userId }).sort({ createdAt: -1 });

    // If a token exists => reuse it (do NOT create a new token)
    // Also update the tokenDoc.allowedOrigin if caller provided allowedOrigin (overwrite)
    if (tokenDoc) {
      token = tokenDoc.token;

      // If allowedOrigin provided and different, update the token record so it becomes valid for new origin
      const normalizedNewOrigin = allowedOrigin || "";
      const existingOrigin = (tokenDoc.allowedOrigin || "").trim().toLowerCase();
      if (normalizedNewOrigin && existingOrigin !== normalizedNewOrigin) {
        await ScriptToken.findByIdAndUpdate(tokenDoc._id, {
          allowedOrigin: normalizedNewOrigin,
          extensionNumber: user.extensionNumber, // keep extension current
          updatedAt: new Date(),
        });
      } else if (!tokenDoc.extensionNumber || tokenDoc.extensionNumber !== user.extensionNumber) {
        // keep extensionNumber in sync if changed
        await ScriptToken.findByIdAndUpdate(tokenDoc._id, {
          extensionNumber: user.extensionNumber,
          updatedAt: new Date(),
        });
      }
    } else {
      // No token for this user yet → create one and save allowedOrigin (may be empty)
      token = crypto.randomBytes(16).toString("hex");
      await ScriptToken.create({
        token,
        userId,
        extensionNumber: user.extensionNumber,
        allowedOrigin: allowedOrigin || "",
      });
      // load tokenDoc for consistency (optional)
      tokenDoc = await ScriptToken.findOne({ token }).lean();
    }


    // === 5️⃣ Build script URL (no .js) ===
    const scriptUrl = `${FRONTEND_BASE.replace(
      /\/+$/,
      ""
    )}/voycell_callback/${token}`;

    // === 6️⃣ Return <script> tag ===
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<script src="${scriptUrl}"></script>`);
  } catch (err) {
    console.error("generateScriptTag Error:", err);
    return res.status(500).json({ error: "Server Error" });
  }
};