// controllers/scriptController.js (or your existing file)
const crypto = require("crypto");
const ScriptToken = require("../models/ScriptToken");
const YeasterToken = require("../models/YeastarToken");
const YeasterSdkToken = require("../models/YeastarSDKToken");
const User = require("../models/userModel");

const FRONTEND_BASE =
  process.env.FRONTEND_BASE || "https://app.voycell.com";

exports.generateScriptTag = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user || !user.yeastarDetails.PBX_EXTENSION_NUMBER) {
      return res.status(400).json({ error: "User or extension not found" });
    }

    if (user.extensionStatus === false) {
      return res.status(400).json({
        status: "error",
        message: "Not Activated Calling Facility.",
      });
    }

    const pbxDeviceId = user.yeastarDetails.PBX_DEVICE_ID || null;

    // === 1️⃣ Normalize allowedOrigin (remove trailing slash + lowercase) ===
    // const allowedOrigin = (req.body.allowedOrigin || "")
    //   .trim()
    //   .replace(/\/+$/, "")
    //   .toLowerCase();
    const allowedOriginPopup = Array.isArray(req.body.allowedOriginPopup)
      ? req.body.allowedOriginPopup
        .map(o => o.trim().replace(/\/+$/, "").toLowerCase())
        .filter(Boolean)
      : [];

    const allowedOriginContactForm = Array.isArray(req.body.allowedOriginContactForm)
      ? req.body.allowedOriginContactForm
        .map(o => o.trim().replace(/\/+$/, "").toLowerCase())
        .filter(Boolean)
      : [];

    const restrictedUrls = Array.isArray(req.body.restrictedUrls)
      ? req.body.restrictedUrls
        .map(u => u.trim().toLowerCase())
        .filter(Boolean)
      : [];

    const fieldName = req.body.fieldName;

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


    if (allowedOriginPopup.length > 0) {
      user.popupSettings.allowedOriginPopup = allowedOriginPopup;
    }

    if (allowedOriginContactForm.length > 0) {
      user.popupSettings.allowedOriginContactForm = allowedOriginContactForm;
    }
    console.log();

    if (restrictedUrls.length > 0) {
      user.popupSettings.restrictedUrls = restrictedUrls;
    }

    if (fieldName) {
      user.popupSettings.fieldName = fieldName;
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
        extensionNumber: user.yeastarDetails.PBX_EXTENSION_NUMBER,
        updatedAt: new Date(),
      };

      // ✅ If allowedOrigins provided, overwrite array
      // if (allowedOrigins.length > 0) {
      //   updatePayload.allowedOrigin = allowedOrigins;
      // }



      // if (restrictedUrls.length > 0) {
      //   updatePayload.restrictedUrls = restrictedUrls;
      // }

      if (Array.isArray(allowedOriginContactForm)) {
        updatePayload.allowedOriginContactForm = allowedOriginContactForm; // can be []
      }

      if (Array.isArray(allowedOriginPopup)) {
        updatePayload.allowedOriginPopup = allowedOriginPopup; // can be []
      }

      if (Array.isArray(restrictedUrls)) {
        updatePayload.restrictedUrls = restrictedUrls; // can be []
      }


      if (fieldName) {
        updatePayload.fieldName = fieldName
      }

      await ScriptToken.findByIdAndUpdate(tokenDoc._id, updatePayload);
    } else {
      // 🆕 Create new token
      token = crypto.randomBytes(16).toString("hex");

      await ScriptToken.create({
        token,
        userId,
        extensionNumber: user.yeastarDetails.PBX_EXTENSION_NUMBER,
        allowedOriginPopup: allowedOriginPopup, // ✅ array
        allowedOriginContactForm: allowedOriginContactForm, // ✅ array
        restrictedUrls: restrictedUrls,  // 🆕 array
        fieldName: fieldName || "phone"
      });
    }

    // let scriptUrl;

    // // === 6️⃣ Build script URL (no .js) ===
    // scriptUrl = `${FRONTEND_BASE.replace(
    //   /\/+$/,
    //   ""
    // )}/voycell_callback/${token}`;

    // if (fieldName) {
    //   scriptUrl = `${FRONTEND_BASE.replace(
    //     /\/+$/,
    //     ""
    //   )}/voycell_callback/${token}/${fieldName}`;
    // }

    //     const loaderUrl = "https://d1zr8dznwp2wv9.cloudfront.net/voycell-loader.js";

    //     let configScript = `
    // <script>
    //   window.VOYCELL_TOKEN = "${token}";
    //   ${fieldName ? `window.VOYCELL_FIELD_NAME = "${fieldName}";` : ""}
    // </script>
    // `;

    //     let loaderScript = `
    // <script src="${loaderUrl}" async defer></script>
    // `;

    //     res.setHeader("Content-Type", "text/html; charset=utf-8");
    //     return res.status(200).send(configScript + loaderScript);

    const loaderUrl = "https://d3dt131388gl2h.cloudfront.net/voycell-loader.js";

    let scriptTag = `
<script
  src="${loaderUrl}"
  data-voycell-token="${token}"
  ${fieldName ? `data-voycell-field="${fieldName}"` : ""}
  async
  defer>
</script>
`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(scriptTag);


    // === 7️⃣ Return <script> tag ===
    // res.setHeader("Content-Type", "text/html; charset=utf-8");
    // return res.status(200).send(`<script src="${scriptUrl}"></script>`);
  } catch (err) {
    console.error("generateScriptTag Error:", err);
    return res.status(500).json({ error: "Server Error" });
  }
};