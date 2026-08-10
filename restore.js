// The interstitial every blocked navigation lands on.
//
// Its one job is to supply the user gesture that chrome.management.setEnabled()
// demands. The background worker knows exactly which peer is down and wants it
// back on, but is not allowed to say so without a click — so this page collects
// the click.
//
// The gesture is fragile: awaiting anything before calling setEnabled drops the
// "user activated" flag and the call silently fails. So the list of peers to
// re-enable is fetched up front on page load, and the handler fires setEnabled
// synchronously as its very first act.

const els = {
  headline: document.getElementById("headline"),
  lede: document.getElementById("lede"),
  missing: document.getElementById("missing"),
  button: document.getElementById("restore"),
  status: document.getElementById("status"),
  escalation: document.getElementById("escalation")
};

// The original URL is appended raw by the DNR rule and can contain & and #, so
// URLSearchParams would truncate it. Split the raw href instead.
function nextUrl() {
  const marker = "&next=";
  const at = location.href.indexOf(marker);
  if (at === -1) return null;
  const url = location.href.slice(at + marker.length);
  return /^https?:/i.test(url) ? url : null;
}

function phase() {
  return new URLSearchParams(location.search).get("phase") || "partial";
}

let pending = [];

function ask(message) {
  return chrome.runtime.sendMessage(message);
}

function fmtDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function renderEscalation(state) {
  if (phase() === "full") {
    els.escalation.innerHTML =
      "<strong>Full lockdown.</strong> Every site is blocked, not just the usual ones. " +
      "It lifts the moment all three are enabled.";
    return;
  }
  if (!state.downSince) {
    els.escalation.textContent = "";
    return;
  }
  const remaining = state.downSince + state.graceMs - Date.now();
  els.escalation.innerHTML =
    `Right now only the usual sites are blocked. In <strong>${fmtDuration(remaining)}</strong> ` +
    "this escalates to blocking every site.";
}

function renderMissing(down) {
  els.missing.innerHTML = "";
  for (const peer of down) {
    const li = document.createElement("li");
    li.textContent = peer.name;
    if (peer.uninstalled) {
      const note = document.createElement("small");
      note.textContent = "Uninstalled — reinstall it from chrome://extensions, this button can't.";
      li.appendChild(note);
    }
    els.missing.appendChild(li);
  }
}

async function refresh() {
  let state;
  try {
    state = await ask({ type: "watchdog:status" });
  } catch {
    els.status.textContent = "Couldn't reach the background worker. Reload the page.";
    return;
  }

  const down = state?.down ?? [];

  if (down.length === 0) {
    els.headline.textContent = "All three are on";
    els.lede.textContent = "Sending you back.";
    els.missing.innerHTML = "";
    els.escalation.textContent = "";
    els.button.disabled = true;
    els.button.textContent = "Done";
    const back = nextUrl();
    setTimeout(() => {
      if (back) location.replace(back);
      else els.lede.textContent = "You can close this tab.";
    }, 600);
    return;
  }

  els.headline.textContent =
    down.length === 1 ? "A blocker is switched off" : "Two blockers are switched off";
  renderMissing(down);
  renderEscalation(state);

  pending = down.filter((p) => !p.uninstalled && p.mayEnable);

  if (pending.length === 0) {
    els.button.disabled = true;
    els.button.textContent = "Can't fix this from here";
    els.status.textContent =
      "Chrome won't let another extension re-enable this one. Go to chrome://extensions and do it there.";
    return;
  }

  els.button.disabled = false;
  els.button.textContent =
    pending.length === 1 ? `Turn ${pending[0].name} back on` : "Turn them back on";
}

els.button.addEventListener("click", () => {
  // Synchronous, first thing, no await before it — this is the gesture.
  const attempts = pending.map((peer) =>
    chrome.management.setEnabled(peer.id, true).then(
      () => ({ peer, ok: true }),
      (err) => ({ peer, ok: false, err })
    )
  );

  els.button.disabled = true;
  els.status.textContent = "Asking Chrome…";

  Promise.all(attempts).then(async (results) => {
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      els.status.textContent =
        `Chrome refused for ${failed.map((f) => f.peer.name).join(", ")}. ` +
        "Enable it from chrome://extensions instead.";
      els.button.disabled = false;
      return;
    }
    els.status.textContent = "Back on.";
    await ask({ type: "watchdog:recheck" }).catch(() => {});
    refresh();
  });
});

refresh();
setInterval(refresh, 5000);
