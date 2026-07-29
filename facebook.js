(function () {
  chrome.storage.sync.get({ facebook: true }, ({ facebook }) => {
    if (!facebook) return;

    function redirectIfReels() {
      if (location.pathname.startsWith("/reel")) {
        location.replace("https://www.facebook.com/");
      }
    }
    redirectIfReels();

    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        redirectIfReels();
      }
    }, 300);

    function hideReelsUI() {
      document.querySelectorAll("a[href*='/reel/'], a[href*='facebook.com/reel']").forEach((el) => {
        const wrap = el.closest("div[role='listitem'], div") || el;
        wrap.style.display = "none";
      });
    }

    const observer = new MutationObserver(hideReelsUI);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    hideReelsUI();
  });
})();
