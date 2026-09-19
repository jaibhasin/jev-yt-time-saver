// ============================================================================
// options.js  —  Loads and saves the user's settings
// ----------------------------------------------------------------------------
// This runs on the options page. It reads the current values from
// chrome.storage.local, populates the form, and lets the user save new values.
// The background worker and content script read the same storage to behave.
// ============================================================================

// Defaults that match background.js if the user has never saved anything.
const DEFAULTS = {
  enabled: true,
  apiKey: "",
  threshold: 0.6,
  confidenceMin: 0.5,
  fetchDescription: true,
};

// Grab every element we care about once.
const els = {
  apiKey: document.getElementById("api-key"),
  enabled: document.getElementById("enabled"),
  threshold: document.getElementById("threshold"),
  thresholdValue: document.getElementById("threshold-value"),
  confidence: document.getElementById("confidence"),
  confidenceValue: document.getElementById("confidence-value"),
  fetchDescription: document.getElementById("fetch-description"),
  save: document.getElementById("save"),
  status: document.getElementById("status"),
};

/** Load saved settings into the form. */
async function load() {
  const s = await chrome.storage.local.get(DEFAULTS);
  els.apiKey.value = s.apiKey;
  els.enabled.checked = s.enabled;
  els.threshold.value = s.threshold;
  els.confidence.value = s.confidenceMin;
  els.fetchDescription.checked = s.fetchDescription;
  updateLabels();
}

/** Show the live slider values next to their labels. */
function updateLabels() {
  els.thresholdValue.textContent = parseFloat(els.threshold.value).toFixed(2);
  els.confidenceValue.textContent = parseFloat(els.confidence.value).toFixed(2);
}

/** Save whatever the form currently holds back into storage. */
async function save() {
  // The `enabled` checkbox stores a boolean; sliders store floats.
  await chrome.storage.local.set({
    enabled: els.enabled.checked,
    apiKey: els.apiKey.value.trim(),
    threshold: parseFloat(els.threshold.value),
    confidenceMin: parseFloat(els.confidence.value),
    fetchDescription: els.fetchDescription.checked,
  });
  flash("Saved ✓");
}

/** Show a short confirmation message. */
function flash(message) {
  els.status.textContent = message;
  setTimeout(() => (els.status.textContent = ""), 2000);
}

// Wire up listeners.
document.addEventListener("DOMContentLoaded", load);
els.threshold.addEventListener("input", updateLabels);
els.confidence.addEventListener("input", updateLabels);
els.save.addEventListener("click", save);

// Pressing Enter in the key field saves too.
els.apiKey.addEventListener("keydown", (e) => {
  if (e.key === "Enter") save();
});
