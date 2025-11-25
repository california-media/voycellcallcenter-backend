const { Buffer } = require("buffer");
// ① ADD: import your User model
const User = require("../models/userModel");
const ScriptToken = require("../models/ScriptToken");

exports.serveCallmeJS = async (req, res) => {
  // Query params the widget accepts (all optional)
  const { token } = req.params;

  const {
    // ext = "",
    themeColor: themeColorQuery = "#4CAF50",
    popupHeading: popupHeadingQuery = "📞 Request a Call Back",
    popupText: popupTextQuery = "Enter your phone number and we’ll call you back in 30 seconds!",
    calltoaction: calltoactionQuery = "📞 Call Me Now",
    headingColor: headingColorQuery = "#4CAF50",
    floatingButtonColor: floatingButtonColorQuery = "#4CAF50",
  } = req.query;

  // Decode extension (client supplies base64 via ?ext=...)
  // const decodedExt = Buffer.from(ext, "base64").toString("utf8");

  // Look up token document to find user + extension
  const tokenDoc = await ScriptToken.findOne({ token }).lean();

  if (!tokenDoc) {
    return res.status(404).send("// Invalid or expired widget token");
  }

  // const decodedExt = tokenDoc.extensionNumber; // this replaces your base64 decoded ext

  const decodedExt = "1010"; // temp hardcode for testing

  // ② ADD: Look up user by extensionNumber in DB
  // let user = null;

  // try {
  //   if (decodedExt) {
  //     user = await User.findOne({ extensionNumber: decodedExt }).lean();
  //   }
  // } catch (dbErr) {
  //   console.error("[serveCallmeJS] DB lookup failed:", dbErr);
  //   // continue — we'll fall back to query params
  // }

  // Find user who owns this token
  const user = await User.findById(tokenDoc.userId).lean();
  if (!user) {
    return res.status(404).send("// User not found for this token");
  }

  function requestOriginMatches(req, allowedOrigin) {
    if (!allowedOrigin) return true; // if no restriction set at all

    console.log(allowedOrigin);


    const allowed = allowedOrigin.trim().replace(/\/+$/, "").toLowerCase();

    const referer = (req.get("referer") || req.get("referrer") || "")
      .split("#")[0]
      .split("?")[0]
      .trim()
      .toLowerCase();

    const originHeader = (req.get("origin") || "").trim().toLowerCase();

    // If no origin or referer at all, block (e.g., file://)
    if (!originHeader && !referer) {
      return false; // 🚫 disallow if no headers
    }

    if (originHeader && originHeader.startsWith(allowed)) return true;
    if (referer && referer.startsWith(allowed)) return true;

    return false; // 🚫 disallow all other cases
  }


  if (tokenDoc.allowedOrigin && !requestOriginMatches(req, tokenDoc.allowedOrigin)) {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    return res
      .status(403)
      .send(`// ❌ Forbidden: this widget token is only valid for ${tokenDoc.allowedOrigin}`);
  }


  // const user = await User.findById(userId);
  // const decodedExt = user.extensionNumber;


  // console.log(user.extensionNumber);


  // ③ MERGE settings: prefer DB values, fall back to query params
  const popupSettings = (user && user.popupSettings) ? user.popupSettings : {};
  const themeColor = (popupSettings.themeColor && popupSettings.themeColor.trim()) ? popupSettings.themeColor : themeColorQuery;
  const popupHeading = (popupSettings.popupHeading && popupSettings.popupHeading.trim()) ? popupSettings.popupHeading : popupHeadingQuery;
  const popupText = (popupSettings.popupText && popupSettings.popupText.trim()) ? popupSettings.popupText : popupTextQuery;
  const calltoaction = (popupSettings.calltoaction && popupSettings.calltoaction.trim()) ? popupSettings.calltoaction : calltoactionQuery;
  const headingColor = (popupSettings.headingColor && popupSettings.headingColor.trim()) ? popupSettings.headingColor : headingColorQuery;
  const floatingButtonColor = (popupSettings.floatingButtonColor && popupSettings.floatingButtonColor.trim()) ? popupSettings.floatingButtonColor : floatingButtonColorQuery;

  // Resolve API_BASE_URL safely: prefer env var, else use same origin as the server that serves this script
  const API_BASE_URL = process.env.API_BASE_URL || (req.protocol + "://" + req.get("host"));
  const apiUrl = API_BASE_URL.replace(/\/+$/, "") + "/api/yeastar/make-call";

  // Build JS to send to browser
  // ④ NOTE: use JSON.stringify to safely embed values into the returned JS
  const js = `
(function () {
  const CALLER_EXTENSION = ${JSON.stringify(decodedExt || "")};
  const THEME_COLOR = ${JSON.stringify(themeColor)};
  const POPUP_HEADING = ${JSON.stringify(popupHeading)};
  const HEADING_COLOR = ${JSON.stringify(headingColor)};
  const FLOATING_BUTTON_COLOR = ${JSON.stringify(floatingButtonColor)};
  const POPUP_TEXT = ${JSON.stringify(popupText)};
  const CALL_TO_ACTION = ${JSON.stringify(calltoaction)};
  const API_URL = ${JSON.stringify(apiUrl)};
  const API_BASE_URL = ${JSON.stringify(API_BASE_URL)};

  let countdownInterval;
  let autoPopupTriggered = false;

  /* ---------------- Styles ---------------- */
  function injectStyles() {
    if (document.getElementById('callme-styles')) return;
    const css = \`
      *{box-sizing:border-box}
      .callme-btn{position:fixed;bottom:25px;right:25px;width:60px;height:60px;background:\${THEME_COLOR};color:#fff;border:none;border-radius:50%;width:60px;height:60px;font-size:26px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483647;box-shadow:0 8px 30px rgba(0,0,0,.25)}
      .callme-btn:hover{transform:scale(1.06)}
      .callme-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:2147483646}
      .callme-overlay.active{display:flex}
      .callme-popup{background:#fff;border-radius:16px;padding:28px;width:92%;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,.25);text-align:center;position:relative}
      .callme-popup h3{color:\${THEME_COLOR};font-size:22px;margin:0 0 8px;font-weight:700;margin-bottom:10px}
      .callme-popup p{color:#555;margin:0 0 18px;font-size:15px}
      .callme-popup .close-btn{position:absolute;right:12px;top:10px;border:none;background:none;font-size:22px;color:#999;cursor:pointer}
      .callme-input{display:flex;border-radius:10px;border:2px solid #eee;overflow:hidden;margin-bottom:18px}
      .callme-input select{padding:12px;background:#f7f7f7;border:none;min-width:90px;cursor:pointer}
      .callme-input input{flex:1;padding:12px;border:none;font-size:15px;outline:none}
      .callme-action{width:100%;padding:14px;border-radius:10px;border:none;background:\${THEME_COLOR};color:#fff;font-weight:700;font-size:16px;cursor:pointer}
      .callme-action:disabled{opacity:.7;cursor:not-allowed}
      .callme-timer{display:none;padding-top:10px}
      .callme-timer.active{display:block}
      .callme-countdown{font-size:34px;color:\${THEME_COLOR};font-weight:800;margin:10px 0}
    \`;
    const s = document.createElement('style');
    s.id = 'callme-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------------- Markup ---------------- */
  function createMarkup() {
    if (document.getElementById('callme-overlay')) return;

    const container = document.createElement('div');
    container.innerHTML = \`
      <button id="callme-float" class="callme-btn" aria-label="Request call" style="background:\${FLOATING_BUTTON_COLOR}">📞</button>
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
          <img src="\${API_BASE_URL}/favicon.webp" alt="Voycell Logo" style="width: 16px; height: 16px; margin-right: 5px; margin-top: 2px;" />
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
    \`;
    document.body.appendChild(container);

    // event bindings
    document.getElementById('callme-float').addEventListener('click', openPopup);
    document.getElementById('callme-close').addEventListener('click', closePopup);
    document.getElementById('callme-overlay').addEventListener('click', function (e) {
      if (e.target === this) closePopup();
    });
    document.getElementById('callme-send').addEventListener('click', startCall);
    // allow only digits in input
    document.getElementById('callme-phone').addEventListener('input', function (e) {
      e.target.value = e.target.value.replace(/\\D/g, '');
    });
  }

  /* ---------------- Popup control ---------------- */
  function openPopup() {
    const ov = document.getElementById('callme-overlay');
    if (!ov) return;
    ov.classList.add('active');
    ov.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closePopup() {
    const ov = document.getElementById('callme-overlay');
    if (!ov) return;
    ov.classList.remove('active');
    ov.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    resetForm();
  }

  function resetForm() {
    clearInterval(countdownInterval);
    const form = document.getElementById('callme-form');
    const timer = document.getElementById('callme-timer');
    const phone = document.getElementById('callme-phone');
    const btn = document.getElementById('callme-send');
    if (form) form.style.display = '';
    if (timer) timer.classList.remove('active');
    if (phone) phone.value = '';
    if (btn) { btn.disabled = false; btn.textContent = CALL_TO_ACTION; }
    const cd = document.getElementById('callme-countdown'); if (cd) cd.textContent = '30';
  }

  /* ---------------- Start Call (POST) ---------------- */
  async function startCall() {
    const phoneEl = document.getElementById('callme-phone');
    const country = document.getElementById('callme-country').value;
    const btn = document.getElementById('callme-send');

    const digits = (phoneEl && phoneEl.value) ? phoneEl.value.replace(/\\D/g, '') : '';
    if (!digits || digits.length < 3) {
      phoneEl.focus();
      phoneEl.style.borderColor = '#ff4757';
      setTimeout(() => (phoneEl.style.borderColor = ''), 1500);
      return;
    }

    const mobNumber = country + digits;

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Sending...';

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
        // start UI timer
        showTimer();
      } else {
        const msg = data && (data.message || data.errmsg || JSON.stringify(data)) ? (data.message || data.errmsg || JSON.stringify(data)) : 'Call initiation failed';
        alert('❌ ' + msg);
      }
    } catch (err) {
      console.error('[callme] network error', err);
      alert('Network error. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

//   async function startCall() {

//     const DEVICE_KEY = "voycell_device_calls";
//     const PROGRESS_KEY = "voycell_call_in_progress";

//     // --------- CHECK 1: Is a call already in progress? ----------
//     const inProgress = localStorage.getItem(PROGRESS_KEY);
//     if (inProgress === "yes") {
//         alert("Please wait… a call is already active.");
//         return;
//     }

//     // --------- Get stored calls for this device -----------
//     let store = localStorage.getItem(DEVICE_KEY);
//     let calls = store ? JSON.parse(store) : [];

//     const now = Date.now();

//     // --------- Remove timestamps older than 30 minutes ------
//     calls = calls.filter(t => now - t < 30 * 60 * 1000);

//     // --------- CHECK 2: Max 2 calls allowed in 30 mins -------
//     if (calls.length >= 2) {
//         const waitMin = Math.ceil(
//             (30 * 60 * 1000 - (now - calls[0])) / 60000
//         );
//         alert(
//           "⛔ You have reached the limit.\nPlease wait waitMin minutes before calling again."
//         );
//         return;
//     }

//     // --------- Normal call validation ------------
//     const phoneEl = document.getElementById('callme-phone');
//     const country = document.getElementById('callme-country').value;
//     const btn = document.getElementById('callme-send');

//     const digits = (phoneEl && phoneEl.value) ? phoneEl.value.replace(/\D/g, '') : '';

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
//       // -------- MARK CALL IN PROGRESS --------
//       localStorage.setItem(PROGRESS_KEY, "yes");

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
//       try { data = await resp.json(); }
//       catch (e) { data = { status: 'error', message: 'invalid-json-response' }; }

//       if (data && (data.status === 'success' || data.success || (data.call_json && data.call_json.errcode === 0))) {
//         // --- SUCCESS: Add timestamp to localStorage ---
//         calls.push(now);
//         localStorage.setItem(DEVICE_KEY, JSON.stringify(calls));

//         showTimer();
//       } else {
//         const msg = data.message || data.errmsg || JSON.stringify(data);
//         alert('❌ ' + msg);
//         localStorage.setItem(PROGRESS_KEY, "no");
//       }
//     } catch (err) {
//       alert('Network error. Please try again.');
//       localStorage.setItem(PROGRESS_KEY, "no");
//     } finally {
//       btn.disabled = false;
//       btn.textContent = original;
//     }
// }


  /* ---------------- Timer UI ---------------- */
  function showTimer() {
    const form = document.getElementById('callme-form');
    const timer = document.getElementById('callme-timer');
    const countdownEl = document.getElementById('callme-countdown');

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
        closePopup();
      }
    }, 1000);
  }

  /* ---------------- Initialization ---------------- */
  function init() {
    injectStyles();
    createMarkup();
    // auto-open after 5s (only the first time)
    setTimeout(function () {
      if (!autoPopupTriggered) {
        autoPopupTriggered = true;
        openPopup();
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