(function () {
  chrome.storage.sync.get({ tiktok: true }, ({ tiktok }) => {
    if (!tiktok) return;

    function showBlockScreen() {
      document.documentElement.innerHTML = `
        <body style="margin:0;height:100vh;display:flex;align-items:center;
          justify-content:center;background:#111;color:#fff;
          font-family:system-ui,sans-serif;text-align:center;">
          <div>
            <h1 style="font-size:28px;margin-bottom:8px;">TikTok is blocked</h1>
            <p style="opacity:0.7;">Disable this in the extension popup if you really need it.</p>
          </div>
        </body>`;
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", showBlockScreen);
    } else {
      showBlockScreen();
    }
  });
})();
