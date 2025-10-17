(function () {
  const scriptTag = document.currentScript;
  const srcUrl = new URL(scriptTag.src);
  const extEncoded = srcUrl.searchParams.get("ext") || "MTEzOQ==";
  const userId = srcUrl.searchParams.get("userId");

  const extDecoded = atob(extEncoded);

  const popupHtml = `
    <style>
      .call-popup {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: white;
        border: 1px solid #ccc;
        border-radius: 10px;
        padding: 15px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.2);
        z-index: 99999;
      }
      .call-popup input {
        width: 200px;
        padding: 8px;
        margin-right: 5px;
      }
      .call-popup button {
        padding: 8px 10px;
        background: #007bff;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
      }
    </style>

    <div class="call-popup">
      <h4>📞 Request a Call Back</h4>
      <input id="call_number" placeholder="Enter phone number" />
      <button id="call_btn">Call Me</button>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", popupHtml);

  document.getElementById("call_btn").addEventListener("click", async () => {
    const mob = document.getElementById("call_number").value;
    if (!mob) return alert("Enter phone number");

    const response = await fetch("https://your-domain.com/api/yeastar/make-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, phoneNumber: mob }),
    });

    const result = await response.json();
    if (result.success) {
      alert("✅ Call initiated successfully!");
    } else {
      alert("❌ Failed: " + (result.message || "Unknown error"));
    }
  });
})();
