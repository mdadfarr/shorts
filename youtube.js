(function () {
  chrome.storage.sync.get({ youtube: true }, ({ youtube }) => {
    if (!youtube) return;

    // Redirect away from /shorts/ URLs immediately
    function redirectIfShorts() {
      if (location.pathname.startsWith("/shorts")) {
        location.replace("https://www.youtube.com/");
      }
    }
    redirectIfShorts();

    // YouTube is a SPA — watch for URL changes
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        redirectIfShorts();
      }
    }, 300);

    // Hide Shorts shelves/entries in feeds, sidebar, and search
    const SELECTORS = [
      "ytd-reel-shelf-renderer",
      "ytd-rich-section-renderer:has(a[title='Shorts'])",
      "ytd-guide-entry-renderer:has(a[title='Shorts'])",
      "ytd-mini-guide-entry-renderer[aria-label='Shorts']",
      "ytd-video-renderer:has(a[href^='/shorts'])",
      "ytd-grid-video-renderer:has(a[href^='/shorts'])",
      "ytd-rich-item-renderer:has(a[href^='/shorts'])"
    ];

    function hideShorts() {
      SELECTORS.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => (el.style.display = "none"));
      });
    }

    const observer = new MutationObserver(hideShorts);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    hideShorts();
  });
})();
