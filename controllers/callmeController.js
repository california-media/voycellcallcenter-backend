// const { Buffer } = require("buffer");

// exports.serveCallmeJS = async (req, res) => {
//   const {
//     ext = "",
//     themeColor = "#4CAF50",
//     popupHeading = "📞 Request a Call Back",
//     popupText = "Enter your phone number and we’ll call you back in 30 seconds!",
//     calltoaction = "📞 Call Me",
//   } = req.query;
//   const API_BASE_URL = process.env.API_BASE_URL || "";
//   const decodedExt = Buffer.from(ext, "base64").toString("utf8");
//   const apiUrl = API_BASE_URL + "/api/yeastar/make-call";

//   const js = `
// (function(){
//   const EXTENSION = '${decodedExt}';
//   const THEME = '${themeColor}';
//   const API_URL = '${apiUrl}';

//   function injectStyles(){
//     if(document.getElementById('callme-style')) return;
//     const style = document.createElement('style');
//     style.id = 'callme-style';
//     style.textContent = \`
//       .callme-btn{position:fixed;bottom:25px;right:25px;width:60px;height:60px;background:\${THEME};color:#fff;border:none;border-radius:50%;font-size:24px;cursor:pointer;z-index:9999;box-shadow:0 3px 10px rgba(0,0,0,0.3);}
//       .callme-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:999999;}
//       .callme-popup{background:#fff;border-radius:12px;padding:20px;max-width:400px;width:90%;box-shadow:0 10px 30px rgba(0,0,0,0.3);text-align:center;}
//       .callme-popup h2{color:\${THEME};margin-bottom:10px;}
//       .callme-popup p{font-size:14px;color:#555;margin-bottom:15px;}
//       .callme-popup select, .callme-popup input{padding:10px;width:100%;margin-bottom:10px;border:1px solid #ccc;border-radius:8px;}
//       .callme-popup button{background:\${THEME};color:#fff;border:none;padding:10px;width:100%;border-radius:8px;font-weight:bold;cursor:pointer;}
//       .countdown{font-size:16px;font-weight:bold;color:\${THEME};margin-top:10px;}
//     \`;
//     document.head.appendChild(style);
//   }

//   function buildPopup(){
//     const overlay = document.createElement('div');
//     overlay.className = 'callme-overlay';
//     overlay.id = 'callme-overlay';
//     overlay.innerHTML = \`
//       <div class="callme-popup">
//         <h2>${popupHeading}</h2>
//         <p>${popupText}</p>
//         <div>
//           <select id="countryCode">
//             <option value="+91">🇮🇳 +91</option>
//             <option value="+971">🇦🇪 +971</option>
//             <option value="+1">🇺🇸 +1</option>
//             <option value="+44">🇬🇧 +44</option>
//           </select>
//           <input type="tel" id="phoneInput" placeholder="Enter phone number" />
//         </div>
//         <button id="makeCallBtn">${calltoaction}</button>
//         <div id="countdown" class="countdown"></div>
//       </div>
//     \`;
//     document.body.appendChild(overlay);
//     overlay.addEventListener('click', e => { if(e.target === overlay) overlay.style.display = 'none'; });
//   }

//   async function makeCall(){
//     const country = document.getElementById('countryCode').value;
//     const mob = document.getElementById('phoneInput').value.trim();
//     const btn = document.getElementById('makeCallBtn');
//     const countdown = document.getElementById('countdown');
//     if(!mob){ alert('Please enter your phone number'); return; }

//     btn.disabled = true;
//     btn.textContent = 'Calling...';

//     try {
//       const res = await fetch(API_URL, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           caller_extension: EXTENSION,
//           countryCode: country,
//           mob_number: mob
//         })
//       });
//       const data = await res.json();
//       console.log('API Response:', data);
//       if(data.status === 'success' || data.errcode === 0){
//         let sec = 30;
//         countdown.textContent = '📞 Call will connect in ' + sec + 's...';
//         const timer = setInterval(()=>{
//           sec--;
//           countdown.textContent = '📞 Call will connect in ' + sec + 's...';
//           if(sec <= 0){
//             clearInterval(timer);
//             countdown.textContent = '✅ Call Initiated!';
//             setTimeout(()=>document.getElementById('callme-overlay').style.display='none', 1500);
//           }
//         }, 1000);
//       } else {
//         alert('Failed to make call.');
//       }
//     } catch(err){
//       console.error('Error:', err);
//       alert('Network error.');
//     } finally {
//       btn.disabled = false;
//       btn.textContent = '${calltoaction}';
//     }
//   }

//   function init(){
//     injectStyles();
//     buildPopup();
//     const btn = document.createElement('button');
//     btn.className = 'callme-btn';
//     btn.textContent = '📞';
//     btn.onclick = () => document.getElementById('callme-overlay').style.display = 'flex';
//     document.body.appendChild(btn);
//     document.addEventListener('click', e=>{
//       if(e.target && e.target.id === 'makeCallBtn') makeCall();
//     });
//   }

//   if(document.readyState !== 'loading') init();
//   else document.addEventListener('DOMContentLoaded', init);
// })();
//   `;

//   res.setHeader("Content-Type", "application/javascript");
//   res.send(js);
// };

// controllers/callmeController.js
const { Buffer } = require("buffer");

exports.serveCallmeJS = async (req, res) => {
    // Query params the widget accepts (all optional)
    const {
        ext = "",
        themeColor = "#4CAF50",
        popupHeading = "📞 Request a Call Back",
        popupText = "Enter your phone number and we’ll call you back in 30 seconds!",
        calltoaction = "📞 Call Me Now",
    } = req.query;

    // Decode extension (client supplies base64 via ?ext=...)
    const decodedExt = Buffer.from(ext, "base64").toString("utf8");

    // Resolve API_BASE_URL safely: prefer env var, else use same origin as the server that serves this script
    const API_BASE_URL = process.env.API_BASE_URL || (req.protocol + "://" + req.get("host"));
    const apiUrl = API_BASE_URL.replace(/\/+$/, "") + "/api/yeastar/make-call";

    // Build JS to send to browser
    const js = `
(function () {
  const CALLER_EXTENSION = '${decodedExt}';
  const THEME_COLOR = '${themeColor}';
  const POPUP_HEADING = \`${popupHeading}\`;
  const POPUP_TEXT = \`${popupText}\`;
  const CALL_TO_ACTION = \`${calltoaction}\`;
  const API_URL = '${apiUrl}';

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
      .callme-popup h2{color:\${THEME_COLOR};font-size:22px;margin:0 0 8px;font-weight:700}
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
      <button id="callme-float" class="callme-btn" aria-label="Request call">📞</button>
      <div id="callme-overlay" class="callme-overlay" role="dialog" aria-hidden="true">
        <div class="callme-popup" role="document" id="callme-popup">
          <button class="close-btn" id="callme-close" aria-label="Close popup">&times;</button>
          <h2>\${POPUP_HEADING}</h2>
          <p>\${POPUP_TEXT}</p>

          <div id="callme-form">
            <div class="callme-input">
              <select id="callme-country">
                <option value="+971">🇦🇪 +971</option>
                <option value="1010">🇦🇪 1010</option>
                <option value="1014">🇦🇪 1014</option>
              </select>
              <input id="callme-phone" type="tel" inputmode="tel" maxlength="15" placeholder="Enter phone number" />
            </div>
            <button id="callme-send" class="callme-action">\${CALL_TO_ACTION}</button>
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

  /* ---------------- Start Call (POST) ----------------
     Note: API expects fields: caller_extension, mob_number (and optionally btnsubmit)
     We use FormData to match the expected format on the server.
  */
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
      const fd = new FormData();
      // IMPORTANT: use the exact field names the API requires
      fd.append('caller_extension', CALLER_EXTENSION || '');
      fd.append('mob_number', mobNumber);
      fd.append('btnsubmit', '1');

    //   const resp = await fetch(API_URL, {
    //     method: 'POST',
    //     body: fd,
    //   });

      const resp = await fetch(API_URL, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
          caller_extension: CALLER_EXTENSION,
          countryCode: country,
          mob_number: digits
         })
       });

      // try JSON first, else text
      let data;
      try { data = await resp.json(); } catch (e) { data = { status: 'error', message: 'invalid-json-response' }; }

      console.log('[callme] API response:', data);

      if (data && (data.status === 'success' || data.success || (data.call_json && data.call_json.errcode === 0))) {
        // start UI timer
        showTimer();
      } else {
        // show API error message if present
        const msg = data && (data.message || data.errmsg || JSON.stringify(data)) ? (data.message || data.errmsg || JSON.stringify(data)) : 'Call initiation failed';
        alert('❌ ' + msg);
      }
    } catch (err) {
      console.error('[callme] network error', err);
      alert('Network error. Please try again.');
    } finally {
      // restore button state (timer UI will hide popup in due course)
      btn.disabled = false;
      btn.textContent = original;
    }
  }

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

    res.setHeader("Content-Type", "application/javascript");
    res.send(js);
};
