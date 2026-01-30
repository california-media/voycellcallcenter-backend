(function () {
    //   if (!window.VOYCELL_TOKEN) {
    //     console.error("[Voycell] VOYCELL_TOKEN not found.");
    //     return;
    //   }

    //   // Prevent double loading
    //   if (window.__VOYCELL_LOADED__) return;
    //   window.__VOYCELL_LOADED__ = true;

    //   var token = window.VOYCELL_TOKEN;
    //   var fieldName = window.VOYCELL_FIELD_NAME || "";

    const script = document.currentScript;

    const token = script.dataset.voycellToken;
    const fieldName = script.dataset.voycellField || "phone";

    if (!token) {
        console.error("VOYCELL: Token missing");
        return;
    }

    console.log("VOYCELL TOKEN:", token);
    console.log("FIELD NAME:", fieldName);

    var base = "https://nf6fp9tcn6.execute-api.eu-north-1.amazonaws.com";
    var src = base + "/voycell_callback/" + token;

    if (fieldName) {
        src += "/" + encodeURIComponent(fieldName);
    }

    var s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";

    s.onload = function () {
        console.log("[Voycell] Widget loaded successfully");
    };

    s.onerror = function () {
        console.error("[Voycell] Failed to load widget");
    };

    document.head.appendChild(s);
})();
