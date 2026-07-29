(function () {
  chrome.storage.sync.get({ instagram: true }, ({ instagram }) => {
    if (!instagram) return;

    function redirectIfReels() {
      if (location.pathname.startsWith("/reels")) {
        location.replace("https://www.instagram.com/");
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

    // Hide the Reels nav icon and any reel tiles embedded in feed/explore
    function hideReelsUI() {
      document.querySelectorAll("a[href^='/reels']").forEach((el) => {
        const navItem = el.closest("div[role='button'], li, div");
        (navItem || el).style.display = "none";
      });
      document.querySelectorAll("svg[aria-label='Reels']").forEach((el) => {
        const wrap = el.closest("a, div[role='link'], div[role='button']");
        if (wrap) wrap.style.display = "none";
      });
    }

    const observer = new MutationObserver(hideReelsUI);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    hideReelsUI();
  });
})();
