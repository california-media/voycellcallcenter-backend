// controllers/scriptController.js (or your existing file)
const crypto = require("crypto");
const ScriptToken = require("../models/ScriptToken");
const User = require("../models/userModel");

exports.generateScriptTag = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    console.log("Generating script tag for user:", userId);
    console.log("User Yeastar Details:", user.PBXDetails);

    if (!user || !user.PBXDetails.PBX_EXTENSION_NUMBER) {
      return res.status(400).json({ error: "User or extension not found" });
    }

    if (user.extensionStatus === false) {
      return res.status(400).json({
        status: "error",
        message: "Not Activated Calling Facility.",
      });
    }

    const pbxDeviceId = user.PBXDetails.assignedDeviceId || null;

    console.log("PBX Device ID:", pbxDeviceId);

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
        extensionNumber: user.PBXDetails.PBX_EXTENSION_NUMBER,
        assignedDeviceId: pbxDeviceId,
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
        extensionNumber: user.PBXDetails.PBX_EXTENSION_NUMBER,
        assignedDeviceId: pbxDeviceId,
        allowedOriginPopup: allowedOriginPopup, // ✅ array
        allowedOriginContactForm: allowedOriginContactForm, // ✅ array
        restrictedUrls: restrictedUrls,  // 🆕 array
        fieldName: fieldName || "phone"
      });
    }

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

    // === 7️⃣ Return <script> tag ===
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(scriptTag);
  } catch (err) {
    console.error("generateScriptTag Error:", err);
    return res.status(500).json({ error: "Server Error" });
  }
};