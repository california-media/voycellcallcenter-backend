(function () {

    const script = document.currentScript;

    const token = script.dataset.voycellToken;
    const fieldName = script.dataset.voycellField || "phone";

    if (!token) {
        console.error("VOYCELL: Token missing");
        return;
    }

    // -----------------------------------
    // ✅ 1️⃣ GET CURRENT PAGE URL
    // -----------------------------------
    let pageUrl = "";

    try {
        pageUrl = window.location.href;
    } catch (e) {
        console.warn("VOYCELL: Unable to read page URL");
    }

    // -----------------------------------
    // ✅ 2️⃣ BUILD API SRC WITH PAGE URL
    // -----------------------------------
    let base = "https://nf6fp9tcn6.execute-api.eu-north-1.amazonaws.com";

    let src =
        base +
        "/voycell_callback/" +
        token;

    if (fieldName) {
        src += "/" + encodeURIComponent(fieldName);
    }

    // ✅ Append pageUrl as query param
    if (pageUrl) {
        src += "?pageUrl=" + encodeURIComponent(pageUrl);
    }

    // -----------------------------------
    // ✅ 3️⃣ LOAD BACKEND SCRIPT
    // -----------------------------------
    let s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";

    s.onload = function () {
        console.log("[Voycell] Widget loaded successfully");
    };

    s.onerror = function () {
        console.error("[Voycell] Failed to load widget");
    };

    document.head.appendChild(s);

})();