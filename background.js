// Short-Form Blocker had no service worker — it was pure content scripts. It
// needs one now, because watching the other two extensions means listening for
// chrome.management events and running an alarm, and neither is possible from a
// content script.
//
// Everything lives in watchdog.js, which is byte-identical across all three
// extensions.
importScripts("watchdog.js");
