// const { Buffer } = require("buffer");
// // ① ADD: import your User model
// const User = require("../models/userModel");
// const ScriptToken = require("../models/ScriptToken");

// exports.serveCallmeJS = async (req, res) => {
//   // Query params the widget accepts (all optional)
//   const { token } = req.params;

//   const {
//     // ext = "",
//     themeColor: themeColorQuery = "#4CAF50",
//     popupHeading: popupHeadingQuery = "📞 Request a Call Back",
//     popupText: popupTextQuery = "Enter your phone number and we’ll call you back in 30 seconds!",
//     calltoaction: calltoactionQuery = "📞 Call Me Now",
//     headingColor: headingColorQuery = "#4CAF50",
//     floatingButtonColor: floatingButtonColorQuery = "#4CAF50",
//   } = req.query;

//   // Decode extension (client supplies base64 via ?ext=...)
//   // const decodedExt = Buffer.from(ext, "base64").toString("utf8");

//   // Look up token document to find user + extension
//   const tokenDoc = await ScriptToken.findOne({ token }).lean();

//   if (!tokenDoc) {
//     return res.status(404).send("// Invalid or expired widget token");
//   }

//   const decodedExt = tokenDoc.extensionNumber; // this replaces your base64 decoded ext

//   // const decodedExt = "1010"; // temp hardcode for testing

//   // ② ADD: Look up user by extensionNumber in DB
//   // let user = null;

//   // try {
//   //   if (decodedExt) {
//   //     user = await User.findOne({ extensionNumber: decodedExt }).lean();
//   //   }
//   // } catch (dbErr) {
//   //   console.error("[serveCallmeJS] DB lookup failed:", dbErr);
//   //   // continue — we'll fall back to query params
//   // }

//   // Find user who owns this token
//   const user = await User.findById(tokenDoc.userId).lean();
//   if (!user) {
//     return res.status(404).send("// User not found for this token");
//   }

//   // function requestOriginMatches(req, allowedOrigin) {
//   //   if (!allowedOrigin) return true; // if no restriction set at all

//   //   console.log(allowedOrigin);

//   //   const allowed = allowedOrigin.trim().replace(/\/+$/, "").toLowerCase();

//   //   const referer = (req.get("referer") || req.get("referrer") || "")
//   //     .split("#")[0]
//   //     .split("?")[0]
//   //     .trim()
//   //     .toLowerCase();

//   //   const originHeader = (req.get("origin") || "").trim().toLowerCase();

//   //   // If no origin or referer at all, block (e.g., file://)
//   //   if (!originHeader && !referer) {
//   //     return false; // 🚫 disallow if no headers
//   //   }

//   //   if (originHeader && originHeader.startsWith(allowed)) return true;
//   //   if (referer && referer.startsWith(allowed)) return true;

//   //   return false; // 🚫 disallow all other cases
//   // }

//   // ✅ 1️⃣ Extract exact origin from request safely
//   function getRequestOrigin(req) {
//     const originHeader = (req.get("origin") || "").trim();
//     const refererHeader = (req.get("referer") || req.get("referrer") || "").trim();

//     try {
//       if (originHeader) {
//         return new URL(originHeader).origin; // ✅ Exact origin
//       }
//       if (refererHeader) {
//         return new URL(refererHeader).origin;
//       }
//     } catch (err) {
//       return "";
//     }

//     return "";
//   }

//   // ✅ 2️⃣ STRICT comparison (NO startsWith, NO partial match)
//   function requestOriginMatches(req, allowedOrigin) {
//     if (!allowedOrigin) return true; // no restriction saved

//     const requestOrigin = getRequestOrigin(req);

//     console.log("✅ Allowed Origin:", allowedOrigin);
//     console.log("🟡 Request Origin:", requestOrigin);

//     // ❌ Block if browser sends NO origin
//     if (!requestOrigin) return false;

//     // ✅ ✅ ✅ EXACT MATCH ONLY
//     return requestOrigin === allowedOrigin;
//   }

//   if (tokenDoc.allowedOrigin && !requestOriginMatches(req, tokenDoc.allowedOrigin)) {
//     res.setHeader("Content-Type", "application/javascript; charset=utf-8");
//     return res
//       .status(403)
//       .send(`// ❌ Forbidden: this widget token is only valid for ${tokenDoc.allowedOrigin}`);
//   }

//   // const user = await User.findById(userId);
//   // const decodedExt = user.extensionNumber;

//   // console.log(user.extensionNumber);

//   // ③ MERGE settings: prefer DB values, fall back to query params
//   const popupSettings = (user && user.popupSettings) ? user.popupSettings : {};
//   const themeColor = (popupSettings.themeColor && popupSettings.themeColor.trim()) ? popupSettings.themeColor : themeColorQuery;
//   const popupHeading = (popupSettings.popupHeading && popupSettings.popupHeading.trim()) ? popupSettings.popupHeading : popupHeadingQuery;
//   const popupText = (popupSettings.popupText && popupSettings.popupText.trim()) ? popupSettings.popupText : popupTextQuery;
//   const calltoaction = (popupSettings.calltoaction && popupSettings.calltoaction.trim()) ? popupSettings.calltoaction : calltoactionQuery;
//   const headingColor = (popupSettings.headingColor && popupSettings.headingColor.trim()) ? popupSettings.headingColor : headingColorQuery;
//   const floatingButtonColor = (popupSettings.floatingButtonColor && popupSettings.floatingButtonColor.trim()) ? popupSettings.floatingButtonColor : floatingButtonColorQuery;

//   // Resolve API_BASE_URL safely: prefer env var, else use same origin as the server that serves this script
//   const API_BASE_URL = process.env.API_BASE_URL || (req.protocol + "://" + req.get("host"));
//   const apiUrl = API_BASE_URL.replace(/\/+$/, "") + "/api/yeastar/make-call";

//   // Build JS to send to browser
//   // ④ NOTE: use JSON.stringify to safely embed values into the returned JS
//   const js = `
// (function () {
//   const CALLER_EXTENSION = ${JSON.stringify(decodedExt || "")};
//   const THEME_COLOR = ${JSON.stringify(themeColor)};
//   const POPUP_HEADING = ${JSON.stringify(popupHeading)};
//   const HEADING_COLOR = ${JSON.stringify(headingColor)};
//   const FLOATING_BUTTON_COLOR = ${JSON.stringify(floatingButtonColor)};
//   const POPUP_TEXT = ${JSON.stringify(popupText)};
//   const CALL_TO_ACTION = ${JSON.stringify(calltoaction)};
//   const API_URL = ${JSON.stringify(apiUrl)};
//   const API_BASE_URL = ${JSON.stringify(API_BASE_URL)};

//   let countdownInterval;
//   let autoPopupTriggered = false;

//   /* ---------------- Styles ---------------- */
//   function injectStyles() {
//     if (document.getElementById('callme-styles')) return;
//     const css = \`
//       *{box-sizing:border-box}
//       .callme-btn{position:fixed;bottom:25px;right:25px;width:60px;height:60px;background:\${THEME_COLOR};color:#fff;border:none;border-radius:50%;width:60px;height:60px;font-size:26px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483647;box-shadow:0 8px 30px rgba(0,0,0,.25)}
//       .callme-btn:hover{transform:scale(1.06)}
//       .callme-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:2147483646}
//       .callme-overlay.active{display:flex}
//       .callme-popup{background:#fff;border-radius:16px;padding:28px;width:92%;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,.25);text-align:center;position:relative}
//       .callme-popup h3{color:\${THEME_COLOR};font-size:22px;margin:0 0 8px;font-weight:700;margin-bottom:10px}
//       .callme-popup p{color:#555;margin:0 0 18px;font-size:15px}
//       .callme-popup .close-btn{position:absolute;right:12px;top:10px;border:none;background:none;font-size:22px;color:#999;cursor:pointer}
//       .callme-input{display:flex;border-radius:10px;border:2px solid #eee;overflow:hidden;margin-bottom:18px}
//       .callme-input select{padding:12px;background:#f7f7f7;border:none;min-width:90px;cursor:pointer}
//       .callme-input input{flex:1;padding:12px;border:none;font-size:15px;outline:none}
//       .callme-action{width:100%;padding:14px;border-radius:10px;border:none;background:\${THEME_COLOR};color:#fff;font-weight:700;font-size:16px;cursor:pointer}
//       .callme-action:disabled{opacity:.7;cursor:not-allowed}
//       .callme-timer{display:none;padding-top:10px}
//       .callme-timer.active{display:block}
//       .callme-countdown{font-size:34px;color:\${THEME_COLOR};font-weight:800;margin:10px 0}
//     \`;
//     const s = document.createElement('style');
//     s.id = 'callme-styles';
//     s.textContent = css;
//     document.head.appendChild(s);
//   }

//   /* ---------------- Markup ---------------- */
//   function createMarkup() {
//     if (document.getElementById('callme-overlay')) return;

//     const container = document.createElement('div');
//     container.innerHTML = \`
//       <button id="callme-float" class="callme-btn" aria-label="Request call" style="background:\${FLOATING_BUTTON_COLOR}">📞</button>
//       <div id="callme-overlay" class="callme-overlay" role="dialog" aria-hidden="true">
//         <div class="callme-popup" role="document" id="callme-popup">
//           <button class="close-btn" id="callme-close" aria-label="Close popup">&times;</button>
//           <h3 style="color:\${HEADING_COLOR}">\${POPUP_HEADING}</h3>
//           <p>\${POPUP_TEXT}</p>

//           <div id="callme-form">
//             <div class="callme-input">
//               <select id="callme-country">
//                 <option value="+971">🇦🇪 +971</option>
//               </select>
//               <input id="callme-phone" type="tel" inputmode="tel" maxlength="15" placeholder="Enter phone number" />
//             </div>
//             <button id="callme-send" class="callme-action">\${CALL_TO_ACTION}</button>
//              <div style="margin-top: 10px; font-size: 12px; color: #555; display: flex; align-items: center; justify-content: center;">
//           <img src="https://voycell-api-bucket.s3.eu-north-1.amazonaws.com/static/voycell_favicon.png" alt="Voycell Logo" style="width: 16px; height: 16px; margin-right: 5px; margin-top: 2px;" />
//           Powered by Voycell.com
//         </div>
//           </div>

//           <div id="callme-timer" class="callme-timer" aria-live="polite">
//             <div>📞 Calling you now...</div>
//             <div id="callme-countdown" class="callme-countdown">30</div>
//             <div>Please keep your phone ready</div>
//           </div>
//         </div>
//       </div>
//     \`;
//     document.body.appendChild(container);

//     // event bindings
//     document.getElementById('callme-float').addEventListener('click', openPopup);
//     document.getElementById('callme-close').addEventListener('click', closePopup);
//     document.getElementById('callme-overlay').addEventListener('click', function (e) {
//       if (e.target === this) closePopup();
//     });
//     document.getElementById('callme-send').addEventListener('click', startCall);
//     // allow only digits in input
//     document.getElementById('callme-phone').addEventListener('input', function (e) {
//       e.target.value = e.target.value.replace(/\\D/g, '');
//     });
//   }

//   /* ---------------- Popup control ---------------- */
//   function openPopup() {
//     const ov = document.getElementById('callme-overlay');
//     if (!ov) return;
//     ov.classList.add('active');
//     ov.setAttribute('aria-hidden', 'false');
//     document.body.style.overflow = 'hidden';
//   }

//   function closePopup() {
//     const ov = document.getElementById('callme-overlay');
//     if (!ov) return;
//     ov.classList.remove('active');
//     ov.setAttribute('aria-hidden', 'true');
//     document.body.style.overflow = '';
//     resetForm();
//   }

//   function resetForm() {
//     clearInterval(countdownInterval);
//     const form = document.getElementById('callme-form');
//     const timer = document.getElementById('callme-timer');
//     const phone = document.getElementById('callme-phone');
//     const btn = document.getElementById('callme-send');
//     if (form) form.style.display = '';
//     if (timer) timer.classList.remove('active');
//     if (phone) phone.value = '';
//     if (btn) { btn.disabled = false; btn.textContent = CALL_TO_ACTION; }
//     const cd = document.getElementById('callme-countdown'); if (cd) cd.textContent = '30';
//   }

//   /* ---------------- Start Call (POST) ---------------- */
//   async function startCall() {
//     const phoneEl = document.getElementById('callme-phone');
//     const country = document.getElementById('callme-country').value;
//     const btn = document.getElementById('callme-send');

//     const digits = (phoneEl && phoneEl.value) ? phoneEl.value.replace(/\\D/g, '') : '';
//     if (!digits || digits.length < 3) {
//       phoneEl.focus();
//       phoneEl.style.borderColor = '#ff4757';
//       setTimeout(() => (phoneEl.style.borderColor = ''), 1500);
//       return;
//     }

//     const mobNumber = country + digits;

//     btn.disabled = true;
//     const original = btn.textContent;
//     btn.textContent = 'Sending...';

//     try {
//       const resp = await fetch(API_URL, {
//          method: 'POST',
//          headers: { 'Content-Type': 'application/json' },
//          body: JSON.stringify({
//           caller_extension: CALLER_EXTENSION,
//           countryCode: country,
//           mob_number: digits
//          })
//        });

//       let data;
//       try { data = await resp.json(); } catch (e) { data = { status: 'error', message: 'invalid-json-response' }; }

//       console.log('[callme] API response:', data);

//       if (data && (data.status === 'success' || data.success || (data.call_json && data.call_json.errcode === 0))) {
//         // start UI timer
//         showTimer();
//       } else {
//         const msg = data && (data.message || data.errmsg || JSON.stringify(data)) ? (data.message || data.errmsg || JSON.stringify(data)) : 'Call initiation failed';
//         alert('❌ ' + msg);
//       }
//     } catch (err) {
//       console.error('[callme] network error', err);
//       alert('Network error. Please try again.');
//     } finally {
//       btn.disabled = false;
//       btn.textContent = original;
//     }
//   }

//   /* ---------------- Timer UI ---------------- */
//   function showTimer() {
//     const form = document.getElementById('callme-form');
//     const timer = document.getElementById('callme-timer');
//     const countdownEl = document.getElementById('callme-countdown');

//     if (form) form.style.display = 'none';
//     if (timer) timer.classList.add('active');

//     let t = 30;
//     if (countdownEl) countdownEl.textContent = t;
//     clearInterval(countdownInterval);
//     countdownInterval = setInterval(function () {
//       t--;
//       if (countdownEl) countdownEl.textContent = t;
//       if (t <= 0) {
//         clearInterval(countdownInterval);
//         closePopup();
//       }
//     }, 1000);
//   }

//   /* ---------------- Initialization ---------------- */
//   function init() {
//     injectStyles();
//     createMarkup();
//     // auto-open after 5s (only the first time)
//     setTimeout(function () {
//       if (!autoPopupTriggered) {
//         autoPopupTriggered = true;
//         openPopup();
//       }
//     }, 5000);
//   }

//   if (document.readyState === 'complete' || document.readyState === 'interactive') init();
//   else document.addEventListener('DOMContentLoaded', init);
// })();
// `;

//   res.setHeader("Content-Type", "application/javascript; charset=utf-8");
//   res.setHeader("Cache-Control", "no-cache");
//   res.status(200).send(js);
// };
const { Buffer } = require("buffer");
// ① ADD: import your User model
const User = require("../models/userModel");
const ScriptToken = require("../models/ScriptToken");

exports.serveCallmeJS = async (req, res) => {
  // Query params the widget accepts (all optional)
  const { token } = req.params;
  const {
    themeColor: themeColorQuery = "#4CAF50",
    popupHeading: popupHeadingQuery = "📞 Request a Call Back",
    popupText:
      popupTextQuery = "Enter your phone number and we’ll call you back in 30 seconds!",
    calltoaction: calltoactionQuery = "📞 Call Me Now",
    headingColor: headingColorQuery = "#4CAF50",
    floatingButtonColor: floatingButtonColorQuery = "#4CAF50",
  } = req.query;

  const tokenDoc = await ScriptToken.findOne({ token }).lean();

  if (!tokenDoc) {
    return res.status(404).send("// Invalid or expired widget token");
  }

  const decodedExt = tokenDoc.extensionNumber;

  const user = await User.findById(tokenDoc.userId).lean();
  if (!user) {
    return res.status(404).send("// User not found for this token");
  }

  function getRequestOrigin(req) {
    const originHeader = (req.get("origin") || "").trim();
    const refererHeader = (
      req.get("referer") ||
      req.get("referrer") ||
      ""
    ).trim();

    try {
      if (originHeader) {
        return new URL(originHeader).origin;
      }
      if (refererHeader) {
        return new URL(refererHeader).origin;
      }
    } catch (err) {
      return "";
    }

    return "";
  }

  function requestOriginMatches(req, allowedOrigin) {
    if (!allowedOrigin) return true;
    const requestOrigin = getRequestOrigin(req);

    if (!requestOrigin) return false;

    return requestOrigin === allowedOrigin;
  }

  if (
    tokenDoc.allowedOrigin &&
    !requestOriginMatches(req, tokenDoc.allowedOrigin)
  ) {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    return res
      .status(403)
      .send(
        `// ❌ Forbidden: this widget token is only valid for ${tokenDoc.allowedOrigin}`
      );
  }

  // ③ MERGE settings: prefer DB values, fall back to query params
  const popupSettings = user && user.popupSettings ? user.popupSettings : {};
  const themeColor =
    popupSettings.themeColor && popupSettings.themeColor.trim()
      ? popupSettings.themeColor
      : themeColorQuery;
  const popupHeading =
    popupSettings.popupHeading && popupSettings.popupHeading.trim()
      ? popupSettings.popupHeading
      : popupHeadingQuery;
  const popupText =
    popupSettings.popupText && popupSettings.popupText.trim()
      ? popupSettings.popupText
      : popupTextQuery;
  const calltoaction =
    popupSettings.calltoaction && popupSettings.calltoaction.trim()
      ? popupSettings.calltoaction
      : calltoactionQuery;
  const headingColor =
    popupSettings.headingColor && popupSettings.headingColor.trim()
      ? popupSettings.headingColor
      : headingColorQuery;
  const floatingButtonColor =
    popupSettings.floatingButtonColor &&
    popupSettings.floatingButtonColor.trim()
      ? popupSettings.floatingButtonColor
      : floatingButtonColorQuery;

  const API_BASE_URL =
    process.env.API_BASE_URL || req.protocol + "://" + req.get("host");
  const apiUrl = API_BASE_URL.replace(/\/+$/, "") + "/api/yeastar/make-call";

  // Build JS to send to browser
  const js = `
(function () {
  const CALLER_EXTENSION = ${JSON.stringify(decodedExt || "")};
  const THEME_COLOR = ${JSON.stringify(themeColor)};
  const POPUP_HEADING = ${JSON.stringify(popupHeading)};
  const HEADING_COLOR = ${JSON.stringify(headingColor)};
  const FLOATING_BUTTON_COLOR = ${JSON.stringify(floatingButtonColor)};
  const POPUP_TEXT = ${JSON.stringify(popupText)};
  const CALL_TO_ACTION = ${JSON.stringify(calltoaction)};
  const PHONE_ICON_COLOR = ${JSON.stringify(
    popupSettings.phoneIconColor || "black"
  )};
  const API_URL = ${JSON.stringify(apiUrl)};
  const API_BASE_URL = ${JSON.stringify(API_BASE_URL)};

  let countdownInterval;
  let autoPopupTriggered = false;

  // generate a unique host id so multiple injections don't clash
  const HOST_ID = 'callme-host-' + Date.now() + '-' + Math.floor(Math.random()*10000);

  /* ---------------- Styles (Shadow-friendly + fallback) ---------------- */
  function getCss() {
    // Use CSS variables for easy theming inside shadow
    return \`
      :host {
        --callme-theme: \${THEME_COLOR};
        --callme-heading: \${HEADING_COLOR};
        --callme-float: \${FLOATING_BUTTON_COLOR};
        all: initial; /* reset everything inside shadow */
      }
      *{box-sizing:border-box}
      .callme-btn{
        position:fixed;
        bottom:25px;
        right:25px;
        width:60px;height:60px;
        background:var(--callme-float);
        color:#fff;border:none;border-radius:50%;
        font-size:26px;cursor:pointer;display:flex;align-items:center;justify-content:center;
        z-index:2147483647;box-shadow:0 8px 30px rgba(0,0,0,.25);
      }
      .callme-btn:hover{transform:scale(1.06)}
      .callme-overlay{
        position:fixed;
        inset:0;
        background:rgba(0,0,0,.5);
        display:none;align-items:center;justify-content:center;
        z-index:2147483646;
      }
      .callme-overlay.active{display:flex}
      .callme-popup{
        background:#fff;border-radius:16px;padding:28px;width:92%;max-width:440px;
        box-shadow:0 20px 60px rgba(0,0,0,.25);text-align:center;position:relative;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial;
      }
      .callme-popup h3{color:var(--callme-theme);font-size:22px;margin:0 0 8px;font-weight:700;margin-bottom:10px}
      .callme-popup p{color:#555;margin:0 0 18px;font-size:15px}
      .close-btn{
        position:absolute;right:12px;top:10px;border:none;background:none;font-size:22px;color:#999;cursor:pointer;
        width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:6px;
      }
      .close-btn:hover{background:rgba(0,0,0,0.03)}
      .callme-input{display:flex;border-radius:10px;border:2px solid #eee;overflow:hidden;margin-bottom:18px}
      .callme-input select{padding:12px;background:#f7f7f7;border:none;min-width:90px;cursor:pointer}
      .callme-input input{flex:1;padding:12px;border:none;font-size:15px;outline:none}
      .callme-action{width:100%;padding:14px;border-radius:10px;border:none;background:var(--callme-theme);color:#fff;font-weight:700;font-size:16px;cursor:pointer}
      .callme-action:disabled{opacity:.7;cursor:not-allowed}
      .callme-timer{display:none;padding-top:10px}
      .callme-timer.active{display:block}
      .callme-countdown{font-size:34px;color:var(--callme-theme);font-weight:800;margin:10px 0}

      /* Fallback strong namespaced rules in case shadow DOM is not supported */
      /* these use the data-callme attribute on the host to reduce collisions */
      [data-callme] .callme-btn{z-index:2147483647 !important}
      [data-callme] .callme-overlay{z-index:2147483646 !important}
      [data-callme] .close-btn{font-size:22px !important}
    \`;
  }

  /* ---------------- Markup (Shadow DOM aware) ---------------- */
  function createHost() {
    // Create host container
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-callme', '1'); // fallback namespace marker
    // try to attach a shadow root
    let shadow = null;
    try {
      shadow = host.attachShadow({ mode: 'open' });
    } catch (e) {
      shadow = null;
    }

    // markup inside either shadow or normal DOM
    const phoneIconFill = PHONE_ICON_COLOR === 'white' ? '#fff' : '#000';
    const inner = \`
      <div class="callme-root">
        <button id="callme-float" class="callme-btn" aria-label="Request call" title="Request call">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" fill="\${phoneIconFill}"/>
          </svg>
        </button>
        <div id="callme-overlay" class="callme-overlay" role="dialog" aria-hidden="true">
          <div class="callme-popup" role="document" id="callme-popup">
            <button class="close-btn" id="callme-close" aria-label="Close popup">&times;</button>
            <h3 style="color:\${HEADING_COLOR}">\${POPUP_HEADING}</h3>
            <p>\${POPUP_TEXT}</p>

            <div id="callme-form">
              <div class="callme-input">
                <select id="callme-country">
                  <option value="+971">🇦🇪 +971</option>
                </select>
                <input id="callme-phone" type="tel" inputmode="tel" maxlength="15" placeholder="Enter phone number" />
              </div>
              <button id="callme-send" class="callme-action">\${CALL_TO_ACTION}</button>
              <div style="margin-top: 10px; font-size: 12px; color: #555; display: flex; align-items: center; justify-content: center;">
                <img src="https://voycell-api-bucket.s3.eu-north-1.amazonaws.com/static/voycell_favicon.png" alt="Voycell Logo" style="width: 16px; height: 16px; margin-right: 5px; margin-top: 2px;" />
                Powered by Voycell.com
              </div>
            </div>

            <div id="callme-timer" class="callme-timer" aria-live="polite">
              <div>📞 Calling you now...</div>
              <div id="callme-countdown" class="callme-countdown">30</div>
              <div>Please keep your phone ready</div>
            </div>
          </div>
        </div>
      </div>
    \`;

    if (shadow) {
      // Shadow DOM supported: inject style + markup into shadow
      const style = document.createElement('style');
      style.textContent = getCss();
      // set innerHTML inside a wrapper to avoid re-parsing issues in some browsers
      shadow.appendChild(style);
      const wrapper = document.createElement('div');
      wrapper.innerHTML = inner;
      // expose wrapper nodes to the outside code via host._callmeRoot to simplify event wiring
      shadow.appendChild(wrapper);
    } else {
      // Fallback: inject namespaced CSS into document head (only once)
      if (!document.getElementById('callme-styles-fallback')) {
        const s = document.createElement('style');
        s.id = 'callme-styles-fallback';
        s.textContent = '#'+HOST_ID + '[data-callme] ' + getCss();
        // In addition to namespacing, force some rules to !important to reduce collisions
        s.textContent = s.textContent.replace(/z-index:2147483647;/g, 'z-index:2147483647 !important;');
        document.head.appendChild(s);
      }
      host.innerHTML = inner;
    }

    document.body.appendChild(host);
    return { host, shadow };
  }

  /* ---------------- Helper to query within shadow or host ---------------- */
  function $(sel, ctx) {
    if (!ctx) return document.querySelector(sel);
    try {
      if (ctx.shadowRoot) return ctx.shadowRoot.querySelector(sel);
      return ctx.querySelector(sel);
    } catch (e) {
      return null;
    }
  }

  /* ---------------- Popup control ---------------- */
  function openPopup(ctx) {
    const ov = $( '#callme-overlay', ctx ) || document.getElementById('callme-overlay');
    if (!ov) return;
    ov.classList.add('active');
    ov.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closePopup(ctx) {
    const ov = $( '#callme-overlay', ctx ) || document.getElementById('callme-overlay');
    if (!ov) return;
    ov.classList.remove('active');
    ov.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    resetForm(ctx);
  }

  function resetForm(ctx) {
    clearInterval(countdownInterval);
    const form = $( '#callme-form', ctx );
    const timer = $( '#callme-timer', ctx );
    const phone = $( '#callme-phone', ctx );
    const btn = $( '#callme-send', ctx );
    if (form) form.style.display = '';
    if (timer) timer.classList.remove('active');
    if (phone) phone.value = '';
    if (btn) { btn.disabled = false; btn.textContent = CALL_TO_ACTION; }
    const cd = $( '#callme-countdown', ctx ); if (cd) cd.textContent = '30';
  }

  /* ---------------- Start Call (POST) ---------------- */
  async function startCall(ctx) {
    const phoneEl = $( '#callme-phone', ctx );
    const countryEl = $( '#callme-country', ctx );
    const country = countryEl ? countryEl.value : '+971';
    const btn = $( '#callme-send', ctx );

    const digits = (phoneEl && phoneEl.value) ? phoneEl.value.replace(/\\D/g, '') : '';
    if (!digits || digits.length < 3) {
      if (phoneEl) {
        phoneEl.focus();
        phoneEl.style.borderColor = '#ff4757';
        setTimeout(() => (phoneEl.style.borderColor = ''), 1500);
      }
      return;
    }

    const mobNumber = country + digits;

    if (btn) {
      btn.disabled = true;
      var original = btn.textContent;
      btn.textContent = 'Sending...';
    }

    try {
      const resp = await fetch(API_URL, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
          caller_extension: CALLER_EXTENSION,
          countryCode: country,
          mob_number: digits
         })
       });

      let data;
      try { data = await resp.json(); } catch (e) { data = { status: 'error', message: 'invalid-json-response' }; }

      console.log('[callme] API response:', data);

      if (data && (data.status === 'success' || data.success || (data.call_json && data.call_json.errcode === 0))) {
        showTimer(ctx);
      } else {
        const msg = data && (data.message || data.errmsg || JSON.stringify(data)) ? (data.message || data.errmsg || JSON.stringify(data)) : 'Call initiation failed';
        alert('❌ ' + msg);
      }
    } catch (err) {
      console.error('[callme] network error', err);
      alert('Network error. Please try again.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = original; }
    }
  }

  /* ---------------- Timer UI ---------------- */
  function showTimer(ctx) {
    const form = $( '#callme-form', ctx );
    const timer = $( '#callme-timer', ctx );
    const countdownEl = $( '#callme-countdown', ctx );

    if (form) form.style.display = 'none';
    if (timer) timer.classList.add('active');

    let t = 30;
    if (countdownEl) countdownEl.textContent = t;
    clearInterval(countdownInterval);
    countdownInterval = setInterval(function () {
      t--;
      if (countdownEl) countdownEl.textContent = t;
      if (t <= 0) {
        clearInterval(countdownInterval);
        closePopup(ctx);
      }
    }, 1000);
  }

  /* ---------------- Initialization ---------------- */
  function init() {
    // avoid double init
    if (document.getElementById(HOST_ID)) return;

    const { host, shadow } = createHost();
    const ctx = shadow ? host.shadowRoot || shadow : host;

    // bind events inside shadow/fallback host
    const btnFloat = $( '#callme-float', ctx ) || document.getElementById('callme-float');
    const btnClose = $( '#callme-close', ctx ) || document.getElementById('callme-close');
    const overlay = $( '#callme-overlay', ctx ) || document.getElementById('callme-overlay');
    const btnSend = $( '#callme-send', ctx ) || document.getElementById('callme-send');
    const phoneEl = $( '#callme-phone', ctx ) || document.getElementById('callme-phone');

    if (btnFloat) btnFloat.style.background = FLOATING_BUTTON_COLOR;
    if (btnFloat) btnFloat.addEventListener('click', function (e) { e.stopPropagation(); openPopup(ctx); });

    if (btnClose) btnClose.addEventListener('click', function (e) { e.stopPropagation(); closePopup(ctx); });

    if (overlay) overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closePopup(ctx);
    });

    if (btnSend) btnSend.addEventListener('click', function (e) { e.stopPropagation(); startCall(ctx); });

    if (phoneEl) phoneEl.addEventListener('input', function (e) {
      e.target.value = e.target.value.replace(/\\D/g, '');
    });

    // auto-open after 5s (only the first time)
    setTimeout(function () {
      if (!autoPopupTriggered) {
        autoPopupTriggered = true;
        openPopup(ctx);
      }
    }, 5000);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
`;

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.status(200).send(js);
};
