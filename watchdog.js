// ---------------------------------------------------------------------------
// Trio watchdog — shared, byte-identical across Daily Gate, Short-Form Blocker,
// and Hard Time Cap. Each extension watches the other two.
//
// What Chrome will and won't allow, since this is the whole design constraint:
//
//   chrome.management.setEnabled(id, true) exists, but the docs say it "must be
//   called in the context of a user gesture." A service worker waking on an
//   alarm has no gesture, so a survivor CANNOT silently switch a disabled peer
//   back on. And a disabled extension's own service worker doesn't run at all,
//   so it can't defend itself either.
//
// So the enforcement is indirect: when a peer goes down, the survivors make the
// browser progressively useless until it's back. Every navigation lands on
// restore.html, whose button IS a user gesture, so one click does the thing the
// worker isn't allowed to do on its own.
//
// Escalation:
//   0 .. GRACE_MS   — block the union of all three extensions' target sites
//   GRACE_MS onward — block all http/https navigation except localhost
//
// Deliberate escape hatch: DNR cannot touch chrome:// URLs, so chrome://extensions
// always stays reachable. If all three get disabled at once nothing is left
// running to notice — that gap is unfixable from inside an extension and needs
// an enterprise force-install policy instead.
//
// Written as a classic script with no import/export so it loads three ways:
// `import "./watchdog.js"` from a module worker, importScripts(), or a plain
// <script>. It is strict-mode safe. It registers its listeners at top level,
// which MV3 requires.
// ---------------------------------------------------------------------------

const TRIO = [
  { id: "lichdhobpbmffpgpfcanoikflgoncagd", name: "Daily Gate" },
  { id: "kecmomiacncbicklpnkolljccmilcpmf", name: "Short-Form Blocker" },
  { id: "ecfaabopnfninfebblmcpffahmohmaic", name: "Hard Time Cap" }
];

// How long the partial block lasts before it goes to a full browser block.
const GRACE_MS = 5 * 60 * 1000;

// Baseline union of what the three extensions target. Each extension also folds
// in its own live blocklist at runtime — see collectLocalDomains().
const UNION_DOMAINS = [
  "youtube.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com"
];

const NEVER_BLOCK = ["localhost", "127.0.0.1"];

const WATCHDOG_ALARM = "trio-watchdog-tick";
const STORE_KEY = "trioWatchdog";

// Session rules live in their own namespace, separate from the dynamic rules
// both Daily Gate and Hard Time Cap already manage. That matters: Daily Gate's
// applyRules() wipes every dynamic rule it finds, and it would happily wipe
// these too if they shared a namespace.
const RULE_ID = 90001;

// Above Daily Gate's priority-2 "continue" bypass, so a bypass granted before a
// peer went down can't punch a hole through the lockdown.
const RULE_PRIORITY = 100;

function peers() {
  return TRIO.filter((e) => e.id !== chrome.runtime.id);
}

function selfName() {
  const me = TRIO.find((e) => e.id === chrome.runtime.id);
  return me ? me.name : "watchdog";
}

function log(...args) {
  console.debug(`[trio-watchdog:${selfName()}]`, ...args);
}

/**
 * Peers that are disabled or gone. A management.get() rejection means the
 * extension was uninstalled outright, which we report but cannot repair —
 * setEnabled can't resurrect something that isn't installed.
 */
async function findDownPeers() {
  const down = [];
  for (const peer of peers()) {
    try {
      const info = await chrome.management.get(peer.id);
      if (!info.enabled) {
        down.push({ ...peer, uninstalled: false, mayEnable: info.mayEnable !== false });
      }
    } catch {
      down.push({ ...peer, uninstalled: true, mayEnable: false });
    }
  }
  return down;
}

/**
 * The host extension's own current blocklist, so the survivors take over the
 * targets of whichever one went down. Each extension stores this differently
 * and neither can read the other's storage, hence the shape-sniffing.
 */
async function collectLocalDomains() {
  const found = new Set();
  try {
    const all = await chrome.storage.local.get(null);

    // Daily Gate: { dailyGateConfig: { gatedSites: [...] } }
    const gated = all?.dailyGateConfig?.gatedSites;
    if (Array.isArray(gated)) gated.forEach((d) => found.add(d));

    // Hard Time Cap: { sites: { "youtube.com": {...} } }
    if (all?.sites && typeof all.sites === "object") {
      Object.keys(all.sites).forEach((d) => found.add(d));
    }
  } catch (err) {
    log("could not read local blocklist", err);
  }
  return [...found].filter((d) => typeof d === "string" && d.includes("."));
}

async function getDownSince() {
  const stored = await chrome.storage.local.get(STORE_KEY);
  return stored?.[STORE_KEY]?.downSince ?? null;
}

async function setDownSince(value) {
  await chrome.storage.local.set({ [STORE_KEY]: { downSince: value } });
}

function restoreUrl() {
  return chrome.runtime.getURL("restore.html");
}

/**
 * One session rule, redirecting main-frame navigation to restore.html and
 * carrying the original URL along in ?next= so the page can bounce back once
 * everything is enabled again.
 *
 * \\0 is the whole regex match. The captured URL is not percent-encoded, so
 * restore.js reads it back off the raw href rather than via URLSearchParams.
 */
function buildRule(phase, domains) {
  const condition =
    phase === "full"
      ? { regexFilter: "^.*$", resourceTypes: ["main_frame"], excludedRequestDomains: NEVER_BLOCK }
      : { regexFilter: "^.*$", resourceTypes: ["main_frame"], requestDomains: domains };

  return {
    id: RULE_ID,
    priority: RULE_PRIORITY,
    action: {
      type: "redirect",
      redirect: { regexSubstitution: `${restoreUrl()}?phase=${phase}&next=\\0` }
    },
    condition
  };
}

async function clearRules() {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const ids = existing.filter((r) => r.id === RULE_ID).map((r) => r.id);
  if (ids.length) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
  }
}

async function installRule(phase, domains) {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [RULE_ID],
      addRules: [buildRule(phase, domains)]
    });
    return;
  } catch (err) {
    // A malformed condition gets the whole rule rejected, which would leave the
    // lockdown silently off — the exact failure mode this is supposed to prevent.
    // Retry with the least exotic condition that still blocks something.
    console.error("[trio-watchdog] rule rejected, falling back:", err);
  }

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [RULE_ID],
    addRules: [
      {
        id: RULE_ID,
        priority: RULE_PRIORITY,
        action: {
          type: "redirect",
          redirect: { regexSubstitution: `${restoreUrl()}?phase=${phase}&next=\\0` }
        },
        condition:
          phase === "full"
            ? { regexFilter: "^.*$", resourceTypes: ["main_frame"] }
            : { regexFilter: "^.*$", resourceTypes: ["main_frame"], requestDomains: UNION_DOMAINS }
      }
    ]
  });
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function domainMatches(host, domains) {
  if (!host) return false;
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * DNR only fires on navigation, so a tab already sitting on YouTube would just
 * stay there. This sweeps what's already open.
 */
async function redirectOpenTabs(phase, domains) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (err) {
    log("tab sweep unavailable", err);
    return;
  }

  for (const tab of tabs) {
    const url = tab.url || "";
    if (!/^https?:/i.test(url)) continue;

    const host = hostOf(url);
    if (domainMatches(host, NEVER_BLOCK)) continue;
    if (phase !== "full" && !domainMatches(host, domains)) continue;

    const target = `${restoreUrl()}?phase=${phase}&next=${url}`;
    chrome.tabs.update(tab.id, { url: target }).catch(() => {});
  }
}

/**
 * The whole loop: look at the peers, then either stand down or clamp.
 */
async function evaluate(reason = "tick") {
  let down;
  try {
    down = await findDownPeers();
  } catch (err) {
    console.error("[trio-watchdog] peer check failed:", err);
    return;
  }

  if (down.length === 0) {
    const wasDown = await getDownSince();
    if (wasDown !== null) {
      log(`all peers back (${reason}) — standing down`);
      await setDownSince(null);
    }
    await clearRules();
    return;
  }

  const now = Date.now();
  let since = await getDownSince();
  if (since === null) {
    since = now;
    await setDownSince(since);
    log(`peer down (${reason}):`, down.map((d) => d.name).join(", "));
  }

  const phase = now - since >= GRACE_MS ? "full" : "partial";
  const domains = [...new Set([...UNION_DOMAINS, ...(await collectLocalDomains())])];

  await installRule(phase, domains);
  await redirectOpenTabs(phase, domains);
}

// --- Wake-ups -------------------------------------------------------------
// Registered synchronously at top level, because MV3 drops listeners added
// after the worker's first turn of the event loop.

/**
 * Create the alarm only if it isn't already there.
 *
 * chrome.alarms.create() on an existing name cancels and replaces it, restarting
 * the countdown from zero. This file runs top-to-bottom on every service worker
 * wake, and Hard Time Cap's worker wakes constantly for its own heartbeat — so
 * an unconditional create() here would reset the timer before it ever reached a
 * minute, and the escalation from partial to full lockdown would never fire.
 */
async function ensureAlarm() {
  const existing = await chrome.alarms.get(WATCHDOG_ALARM);
  if (!existing) {
    await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 1 });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) {
    evaluate("alarm").catch((err) => console.error("[trio-watchdog]", err));
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm().then(() => evaluate("startup")).catch((err) => console.error("[trio-watchdog]", err));
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm().then(() => evaluate("installed")).catch((err) => console.error("[trio-watchdog]", err));
});

chrome.management.onDisabled.addListener(() => {
  evaluate("peer-disabled").catch((err) => console.error("[trio-watchdog]", err));
});

chrome.management.onUninstalled.addListener(() => {
  evaluate("peer-uninstalled").catch((err) => console.error("[trio-watchdog]", err));
});

chrome.management.onEnabled.addListener(() => {
  evaluate("peer-enabled").catch((err) => console.error("[trio-watchdog]", err));
});

chrome.management.onInstalled.addListener(() => {
  evaluate("peer-installed").catch((err) => console.error("[trio-watchdog]", err));
});

// restore.js asks for the current picture, and pings after a successful enable.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "watchdog:status") {
    (async () => {
      sendResponse({
        down: await findDownPeers(),
        downSince: await getDownSince(),
        graceMs: GRACE_MS,
        trio: TRIO
      });
    })();
    return true;
  }
  if (msg?.type === "watchdog:recheck") {
    evaluate("restore-page").then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

ensureAlarm()
  .then(() => evaluate("load"))
  .catch((err) => console.error("[trio-watchdog]", err));
