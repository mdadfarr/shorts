const KEYS = ["youtube", "tiktok", "instagram", "facebook"];
const defaults = { youtube: true, tiktok: true, instagram: true, facebook: true };

chrome.storage.sync.get(defaults, (settings) => {
  KEYS.forEach((key) => {
    const box = document.getElementById(key);
    box.checked = settings[key];
    box.addEventListener("change", () => {
      chrome.storage.sync.set({ [key]: box.checked });
    });
  });
});
