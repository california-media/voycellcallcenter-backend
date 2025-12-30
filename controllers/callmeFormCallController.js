const { Buffer } = require("buffer");
// ① ADD: import your User model
const User = require("../models/userModel");
// const ScriptToken = require("../models/ScriptToken");
const ScriptToken = require("../models/FormCallScriptToken");

exports.serveFormCallJS = async (req, res) => {
  // const { token } = req.params;
  const { token, fieldName } = req.params;
  if (!fieldName || fieldName.length > 50) {
    return res.status(400).send("// Invalid field name");
  }

  console.log("token", token);
  
  // 1. Fetch Token Data
  const tokenDoc = await ScriptToken.findOne({ token }).lean();
  if (!tokenDoc) return res.status(404).send("// Invalid token");

  // 2. GET THE ACTUAL URL (REFERER)
  // This is what the browser reports the current page is
  let rawReferer = req.get("referer") || req.get("origin") || "";

  if (!rawReferer) {
    console.log("⚠️ No Referer found. Browser might be blocking the header.");
  }

  // Normalize: lowercase, remove spaces, and remove trailing slashes
  const normalizedReferer = rawReferer.toLowerCase().trim().replace(/\/+$/, "");

  console.log("DEBUG: Current Page URL ->", normalizedReferer);
  console.log("DEBUG: Restricted URLs ->", tokenDoc.restrictedUrls);

  // 3. IMPROVED RESTRICTION CHECK
  if (tokenDoc.restrictedUrls && tokenDoc.restrictedUrls.length > 0) {
    const isRestricted = tokenDoc.restrictedUrls.some(restrictedPath => {
      if (!restrictedPath) return false;

      // 1. Clean both paths (remove trailing slashes and spaces)
      const cleanDBPath = restrictedPath.toLowerCase().trim().replace(/\/+$/, "");
      const cleanCurrentUrl = normalizedReferer.toLowerCase().trim().replace(/\/+$/, "");

      // 2. LOGIC: Block if the Current URL is exactly the restricted path
      // OR if the Current URL is part of the restricted path (for local testing)
      // OR if the restricted path is a sub-folder of the current URL
      const match = cleanCurrentUrl === cleanDBPath ||
        cleanDBPath.includes(cleanCurrentUrl) ||
        cleanCurrentUrl.includes(cleanDBPath);

      return match;
    });

    if (isRestricted) {
      console.log("🚫 MATCH FOUND: Blocking script for", normalizedReferer);
      res.setHeader("Content-Type", "application/javascript");
      return res.status(200).send("// Voycell Script: This URL is restricted.");
    }
  }


  const user = await User.findById(tokenDoc.userId).lean();
  if (!user) {
    return res.status(404).send("// User not found");
  }

  const API_BASE =
    process.env.API_BASE_URL || req.protocol + "://" + req.get("host");

  const js = `
(function () {
  const EXTENSION = ${JSON.stringify(tokenDoc.extensionNumber)};
  const API_URL = ${JSON.stringify(API_BASE + "/api/yeastar/make-call")};

  function extractDigits(v) {
    return (v || "").replace(/\\D/g, "");
  }

  function findPhoneInput(form) {
  return (
    form.querySelector('[name="${fieldName}"]') ||
    form.querySelector('#${fieldName}')
  );
}


  function hookForm(form) {
    if (form.__voycell_bound) return;
    form.__voycell_bound = true;

form.addEventListener("submit", function (e) {
  e.preventDefault(); // ⛔ stop reload

  console.log("Form submit detected");

  const phoneInput = findPhoneInput(form);
  console.log("Phone input element:", phoneInput);

  if (!phoneInput) {
    console.log("Phone input NOT FOUND");
    return;
  }

  const number = extractDigits(phoneInput.value);
  console.log("Raw value:", phoneInput.value);
  console.log("Extracted number:", number);

  if (number.length < 7) {
    console.log("Number too short");
    return;
  }

  console.log("📞 Calling number:", number);

  fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      caller_extension: EXTENSION,
      mob_number: number
    })
  }).catch(err => console.error("Fetch error", err));
});


  }

  function init() {
    document.querySelectorAll("form").forEach(hookForm);

    new MutationObserver(() => {
      document.querySelectorAll("form").forEach(hookForm);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
`;

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.status(200).send(js);
};