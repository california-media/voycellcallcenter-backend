const { Buffer } = require("buffer");

exports.serveCallmeJS = async (req, res) => {
  const {
    ext = "",
    themeColor = "#4CAF50",
    popupHeading = "📞 Request a Call Back",
    popupText = "Enter your phone number and we’ll call you back in 30 seconds!",
    calltoaction = "📞 Call Me",
  } = req.query;
  const API_BASE_URL = process.env.API_BASE_URL || "";
  const decodedExt = Buffer.from(ext, "base64").toString("utf8");
  const apiUrl = API_BASE_URL + "/api/yeastar/make-call";

  const js = `
(function(){
  const EXTENSION = '${decodedExt}';
  const THEME = '${themeColor}';
  const API_URL = '${apiUrl}';

  function injectStyles(){
    if(document.getElementById('callme-style')) return;
    const style = document.createElement('style');
    style.id = 'callme-style';
    style.textContent = \`
      .callme-btn{position:fixed;bottom:25px;right:25px;width:60px;height:60px;background:\${THEME};color:#fff;border:none;border-radius:50%;font-size:24px;cursor:pointer;z-index:9999;box-shadow:0 3px 10px rgba(0,0,0,0.3);}
      .callme-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:999999;}
      .callme-popup{background:#fff;border-radius:12px;padding:20px;max-width:400px;width:90%;box-shadow:0 10px 30px rgba(0,0,0,0.3);text-align:center;}
      .callme-popup h2{color:\${THEME};margin-bottom:10px;}
      .callme-popup p{font-size:14px;color:#555;margin-bottom:15px;}
      .callme-popup select, .callme-popup input{padding:10px;width:100%;margin-bottom:10px;border:1px solid #ccc;border-radius:8px;}
      .callme-popup button{background:\${THEME};color:#fff;border:none;padding:10px;width:100%;border-radius:8px;font-weight:bold;cursor:pointer;}
      .countdown{font-size:16px;font-weight:bold;color:\${THEME};margin-top:10px;}
    \`;
    document.head.appendChild(style);
  }

  function buildPopup(){
    const overlay = document.createElement('div');
    overlay.className = 'callme-overlay';
    overlay.id = 'callme-overlay';
    overlay.innerHTML = \`
      <div class="callme-popup">
        <h2>${popupHeading}</h2>
        <p>${popupText}</p>
        <div>
          <select id="countryCode">
            <option value="+91">🇮🇳 +91</option>
            <option value="+971">🇦🇪 +971</option>
            <option value="+1">🇺🇸 +1</option>
            <option value="+44">🇬🇧 +44</option>
          </select>
          <input type="tel" id="phoneInput" placeholder="Enter phone number" />
        </div>
        <button id="makeCallBtn">${calltoaction}</button>
        <div id="countdown" class="countdown"></div>
        <div style="margin-top: 10px; font-size: 12px; color: #555; display: flex; align-items: center; justify-content: center;">
          <img src="${API_BASE_URL}/favicon.webp" alt="Voycell Logo" style="width: 16px; height: 16px; margin-right: 5px; margin-bottom: 2px;" />
          Powered by Voycell.com
        </div>
      </div>
    \`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target === overlay) overlay.style.display = 'none'; });
  }

  async function makeCall(){
    const country = document.getElementById('countryCode').value;
    const mob = document.getElementById('phoneInput').value.trim();
    const btn = document.getElementById('makeCallBtn');
    const countdown = document.getElementById('countdown');
    if(!mob){ alert('Please enter your phone number'); return; }

    btn.disabled = true;
    btn.textContent = 'Calling...';

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caller_extension: EXTENSION,
          countryCode: country,
          mob_number: mob
        })
      });
      const data = await res.json();
      console.log('API Response:', data);
      if(data.status === 'success' || data.errcode === 0){
        let sec = 30;
        countdown.textContent = '📞 Call will connect in ' + sec + 's...';
        const timer = setInterval(()=>{
          sec--;
          countdown.textContent = '📞 Call will connect in ' + sec + 's...';
          if(sec <= 0){
            clearInterval(timer);
            countdown.textContent = '✅ Call Initiated!';
            setTimeout(()=>document.getElementById('callme-overlay').style.display='none', 1500);
          }
        }, 1000);
      } else {
        alert('Failed to make call.');
      }
    } catch(err){
      console.error('Error:', err);
      alert('Network error.');
    } finally {
      btn.disabled = false;
      btn.textContent = '${calltoaction}';
    }
  }

  function init(){
    injectStyles();
    buildPopup();
    const btn = document.createElement('button');
    btn.className = 'callme-btn';
    btn.textContent = '📞';
    btn.onclick = () => document.getElementById('callme-overlay').style.display = 'flex';
    document.body.appendChild(btn);
    document.addEventListener('click', e=>{
      if(e.target && e.target.id === 'makeCallBtn') makeCall();
    });
  }

  if(document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
  `;

  res.setHeader("Content-Type", "application/javascript");
  res.send(js);
};
