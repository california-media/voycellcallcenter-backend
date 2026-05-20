(function () {
  const script = document.currentScript;
  const token = script.dataset.voycellToken;
  const fieldName = script.dataset.voycellField || "phone";

  if (!token) {
    console.error("VOYCELL: Token missing");
    return;
  }

  let pageUrl = "";
  try { pageUrl = window.location.href; } catch (e) {}

  let base = "http://localhost:4004";
  let src = base + "/voycell_callback/" + token;
  if (fieldName) src += "/" + encodeURIComponent(fieldName);
  if (pageUrl) src += "?pageUrl=" + encodeURIComponent(pageUrl);

  let s = document.createElement("script");
  s.src = src;
  s.crossOrigin = "anonymous";
  s.onload = function () { console.log("[Voycell] Widget loaded (local)"); };
  s.onerror = function () { console.error("[Voycell] Failed to load widget (local)"); };
  document.head.appendChild(s);
})();
