const { Buffer } = require("buffer");
// ① ADD: import your User model
const User = require("../models/userModel");
// const ScriptToken = require("../models/ScriptToken");
const ScriptToken = require("../models/FormCallScriptToken");

exports.serveFormCallJS = async (req, res) => {
    const { token } = req.params;
    console.log("token", token);

    const tokenDoc = await ScriptToken.findOne({ token }).lean();
    if (!tokenDoc) {
        return res.status(404).send("// Invalid token");
    }

    // 🔒 Origin validation
    const normalize = o => o.toLowerCase().replace(/\/+$/, "");

    const getOrigin = req => {
        const ref = req.get("referer");
        if (!ref) return "";
        try {
            return normalize(new URL(ref).origin);
        } catch {
            return "";
        }
    };

    if (
        tokenDoc.allowedOrigin?.length &&
        !tokenDoc.allowedOrigin.includes(getOrigin(req))
    ) {
        return res.status(403).send("// Forbidden origin");
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
    const inputs = Array.from(form.querySelectorAll("input"));

    return (
      inputs.find(i => i.type === "tel") ||
      inputs.find(i =>
        /(phone|mobile|contact|tel|whatsapp|number|call)/i
          .test((i.name || "") + " " + (i.id || ""))
      ) ||
      inputs.find(i =>
        /(phone|mobile|call)/i.test(i.placeholder || "")
      ) ||
      inputs.find(i => i.maxLength >= 8 && i.maxLength <= 15)
    );
  }

  function hookForm(form) {
    if (form.__voycell_bound) return;
    form.__voycell_bound = true;

    form.addEventListener("submit", function () {
      const phoneInput = findPhoneInput(form);
      if (!phoneInput) return;

      const number = extractDigits(phoneInput.value);
      if (number.length < 7) return;
 console.log(phoneInput.value);
      fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caller_extension: EXTENSION,
          mob_number: number,
          countryCode: ""
        })
      }).catch(() => {});
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