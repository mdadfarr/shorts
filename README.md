# Short-Form Blocker

Blocks YouTube Shorts, TikTok (whole site), Instagram Reels, Facebook Reels.

## Install (unpacked)
1. `chrome://extensions`
2. Enable Developer mode (top right)
3. "Load unpacked" → select this folder
4. Click the extension icon to toggle sites on/off

## Notes
- YouTube/Instagram/Facebook: redirects away from shorts/reels URLs and hides shorts tiles in feeds via a MutationObserver (survives their SPA navigation).
- TikTok: since it's short-form by design, it just blocks the whole domain with a splash screen. Toggle it off in the popup if you need TikTok for something specific.
- Selectors are based on current site markup (YouTube's `ytd-*` tags, IG's aria-labels) — these sites change their DOM periodically, so if hiding stops working, the CSS selectors in youtube.js/instagram.js/facebook.js need updating.
