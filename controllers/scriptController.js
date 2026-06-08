// controllers/scriptController.js (or your existing file)
const crypto = require("crypto");
const ScriptToken = require("../models/ScriptToken");
const User = require("../models/userModel");

exports.generateScriptTag = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    // Build full list of available extensions: own pool + agent extensions
    const availableExts = [];
    const seenExts = new Set();
    const pushExt = (extensionNumber, assignedDeviceId) => {
      if (!extensionNumber || seenExts.has(extensionNumber)) return;
      seenExts.add(extensionNumber);
      availableExts.push({ extensionNumber, assignedDeviceId: assignedDeviceId || null });
    };

    if (user?.PBXDetails?.PBX_EXTENSION_NUMBER) {
      pushExt(user.PBXDetails.PBX_EXTENSION_NUMBER, user.PBXDetails.assignedDeviceId);
    }
    (user?.assignedExtensions || []).forEach((e) => pushExt(e.extensionNumber, e.assignedDeviceId));

    // Also include extensions assigned to agents under this company admin
    const agents = await User.find({ createdByWhichCompanyAdmin: user._id, role: "user" })
      .select("PBXDetails assignedExtensions")
      .lean();
    for (const agent of agents) {
      if (agent.PBXDetails?.PBX_EXTENSION_NUMBER) {
        pushExt(agent.PBXDetails.PBX_EXTENSION_NUMBER, agent.PBXDetails.assignedDeviceId);
      }
      for (const e of agent.assignedExtensions || []) {
        pushExt(e.extensionNumber, e.assignedDeviceId);
      }
    }

    console.log(`[generateScript] userId=${userId} agents=${agents.length} availableExts=${JSON.stringify(availableExts.map(e => e.extensionNumber))} requested=${req.body.selectedExtensionNumber}`);

    if (!user || availableExts.length === 0) {
      return res.status(400).json({ error: "User or extension not found" });
    }

    if (user.extensionStatus === false && !(user.assignedExtensions?.length > 0)) {
      return res.status(400).json({
        status: "error",
        message: "Not Activated Calling Facility.",
      });
    }

    // Resolve which extension to use for this script
    const requestedExt = req.body.selectedExtensionNumber
      ? String(req.body.selectedExtensionNumber)
      : null;
    let activeExt = requestedExt
      ? availableExts.find((e) => e.extensionNumber === requestedExt)
      : availableExts[0];
    console.log(`[generateScript] requestedExt=${requestedExt} activeExt=${activeExt?.extensionNumber || "NOT FOUND"}`);
    if (!activeExt) {
      return res.status(400).json({ error: `Extension ${requestedExt} not found. Available: ${availableExts.map(e => e.extensionNumber).join(", ")}` });
    }

    const pbxDeviceId = activeExt.assignedDeviceId;

    // === 1️⃣ Normalize allowedOrigin (remove trailing slash + lowercase) ===
    const allowedOriginPopup = Array.isArray(req.body.allowedOriginPopup)
      ? req.body.allowedOriginPopup
        .map(o => o.trim().replace(/\/+$/, "").toLowerCase())
        .filter(Boolean)
      : [];

    const allowedOriginContactForm = Array.isArray(req.body.allowedOriginContactForm)
      ? req.body.allowedOriginContactForm
        .map(o =>
          o
            .toLowerCase()
            .trim()
            .split("#")[0]
            .split("?")[0]
            .replace(/\/+$/, "")
        )
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
        req.body.themeColor || user.popupSettings?.themeColor || "#2249AA",
      headingColor:
        req.body.headingColor || user.popupSettings?.headingColor || "#2249AA",
      floatingButtonColor:
        req.body.floatingButtonColor ||
        user.popupSettings?.floatingButtonColor ||
        "#2249AA",
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
        " Call Me",
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

    if (restrictedUrls.length > 0) {
      user.popupSettings.restrictedUrls = restrictedUrls;
    }

    if (fieldName) {
      user.popupSettings.fieldName = fieldName;
    }

    // Persist selected extension so UI can restore it on next load
    user.popupSettings.selectedExtensionNumber = activeExt.extensionNumber;
    console.log(`[generateScript] saving user.popupSettings.selectedExtensionNumber=${activeExt.extensionNumber}`);

    await user.save();

    // === Stable-token policy: one token per user ===
    let tokenDoc = await ScriptToken.findOne({ userId }).sort({ createdAt: -1 });
    let token;
    console.log(`[generateScript] tokenDoc exists=${!!tokenDoc} tokenDoc.extensionNumber=${tokenDoc?.extensionNumber}`);

    if (tokenDoc) {
      token = tokenDoc.token;

      // Always sync to whichever extension the admin selected
      const updatePayload = {
        extensionNumber: activeExt.extensionNumber,
        assignedDeviceId: pbxDeviceId,
        updatedAt: new Date(),
      };

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
        extensionNumber: activeExt.extensionNumber,
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
  ${fieldName ? `data-voycell-field="${fieldName}"` : ""}>
</script>
`;

    // === 7️⃣ Return <script> tag ===
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(scriptTag);
  } catch (err) {
    return res.status(500).json({ error: "Server Error" });
  }
};

/**
 * GET /api/script/managed-extensions
 * Returns all extensions the company admin can route widget calls to:
 * their own pool + every extension assigned to agents under them.
 */
exports.getManagedExtensions = async (req, res) => {
  try {
    const userId = req.user._id;
    const admin = await User.findById(userId).lean();
    if (!admin) return res.status(404).json({ error: "User not found" });

    const seen = new Set();
    const extensions = [];

    const addExt = (extensionNumber, telephone, label) => {
      if (!extensionNumber || seen.has(extensionNumber)) return;
      seen.add(extensionNumber);
      extensions.push({ extensionNumber, telephone: telephone || "", label: label || "" });
    };

    // Build a set of disabled extensionNumbers for admin's own pool
    const adminDisabled = new Set(
      (admin.assignedExtensions || [])
        .filter((e) => e.enabled === false)
        .map((e) => e.extensionNumber)
    );

    // Own primary extension — skip if disabled in pool
    if (admin.PBXDetails?.PBX_EXTENSION_NUMBER && !adminDisabled.has(admin.PBXDetails.PBX_EXTENSION_NUMBER)) {
      addExt(
        admin.PBXDetails.PBX_EXTENSION_NUMBER,
        admin.PBXDetails.PBX_TELEPHONE,
        `Ext ${admin.PBXDetails.PBX_EXTENSION_NUMBER} (You)`
      );
    }

    // Own pool extensions — skip disabled
    for (const e of admin.assignedExtensions || []) {
      if (e.enabled === false) continue;
      addExt(e.extensionNumber, e.PBX_TELEPHONE, `Ext ${e.extensionNumber} (Pool)`);
    }

    // Agent extensions
    const agents = await User.find({ createdByWhichCompanyAdmin: userId, role: "user" })
      .select("firstname lastname PBXDetails assignedExtensions")
      .lean();

    for (const agent of agents) {
      const name = `${agent.firstname || ""} ${agent.lastname || ""}`.trim() || "Agent";

      // Build set of disabled extensionNumbers for this agent
      const agentDisabled = new Set(
        (agent.assignedExtensions || [])
          .filter((e) => e.enabled === false)
          .map((e) => e.extensionNumber)
      );

      // Primary PBX extension — skip if disabled in agent's pool
      if (agent.PBXDetails?.PBX_EXTENSION_NUMBER && !agentDisabled.has(agent.PBXDetails.PBX_EXTENSION_NUMBER)) {
        addExt(
          agent.PBXDetails.PBX_EXTENSION_NUMBER,
          agent.PBXDetails.PBX_TELEPHONE,
          `Ext ${agent.PBXDetails.PBX_EXTENSION_NUMBER} (${name})`
        );
      }

      for (const e of agent.assignedExtensions || []) {
        if (e.enabled === false) continue;
        addExt(e.extensionNumber, e.PBX_TELEPHONE, `Ext ${e.extensionNumber} (${name})`);
      }
    }

    return res.status(200).json({ extensions });
  } catch (err) {
    return res.status(500).json({ error: "Server Error" });
  }
};