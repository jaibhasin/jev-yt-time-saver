// ============================================================================
// popup.js  —  Quick status + master toggle from the toolbar icon
// ----------------------------------------------------------------------------
// Reads the extension's status (on/off, key present) and lets the user flip
// the master switch or jump to the options page.
// ============================================================================

const els = {
  enabled: document.getElementById("enabled"),
  keyStatus: document.getElementById("key-status"),
  options: document.getElementById("options"),
};

/** Pull the current state from storage and reflect it in the popup. */
async function refresh() {
  const s = await chrome.storage.local.get({
    enabled: true,
    apiKey: "",
  });
  els.enabled.checked = s.enabled;
  els.keyStatus.textContent = s.apiKey ? "set ✓" : "not set";
  els.keyStatus.className = s.apiKey ? "status ok" : "status warn";
}

// Toggling the switch writes `enabled` so the content script reacts live.
els.enabled.addEventListener("change", async (e) => {
  await chrome.storage.local.set({ enabled: e.target.checked });
});

// Open the full options page (it lives in a tab because we set open_in_tab).
els.options.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.addEventListener("DOMContentLoaded", refresh);
