// ============================================================================
// content.js  —  Content Script (runs on https://www.youtube.com/*)
// ----------------------------------------------------------------------------
// This script runs inside the YouTube page and talks to the background worker
// (background.js). It does NOT do the AI work itself. Its jobs are:
//
//   1. Find every "video card" on the page (home feed, search, subscriptions).
//   2. Read the visible text: title, channel, and description (when present).
//   3. Send each card to the background worker for classification.
//   4. When the worker says a video is a likely time-waster, dim the
//      thumbnail and drop a small "timeout" (⏰) badge on it.
//
// YouTube loads videos lazily as you scroll, so we watch the DOM with a
// MutationObserver and re-scan whenever new cards appear.
// ============================================================================

// The custom elements YouTube uses for the different video-card surfaces:
//   home / subscriptions -> ytd-rich-item-renderer
//   search results       -> ytd-video-renderer
//   older grid layouts   -> ytd-grid-video-renderer
//   watch-page sidebar   -> ytd-compact-video-renderer
const ITEM_SELECTORS = [
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-compact-video-renderer",
];

// Keep a reference to whether the extension is usable, so we don't spam the
// background service worker with dozens of messages when it's off.
let isActive = false;

// Controls how many videos we classify at once (protects the API rate limit and
// keeps the page responsive). The queue pulls from this pool.
const LIMIT_QUEUE = 6;
let activeJobs = 0;
const pendingJobs = [];

// ---------------------------------------------------------------------------
// Extraction: pull title / channel / description out of a video card
// ---------------------------------------------------------------------------

/** Pull the 11-character video id out of a YouTube link (e.g. /watch?v=abc123). */
function getVideoId(anchor) {
  if (!anchor) return null;
  const href = anchor.getAttribute("href") || anchor.href || "";
  const m = href.match(/[?&]v=([\w-]{11})/);
  return m ? m[1] : null;
}

/**
 * Extract the readable details from a single video card.
 * Returns an object { videoId, title, channel, description }, or null when
 * the element isn't actually a video (e.g. a channel card or an ad).
 */
function extractVideo(item) {
  // The thumbnail/click target is the reliable source of the video id.
  const link =
    item.querySelector("a#thumbnail") ||
    item.querySelector('a[href*="/watch?v="]');

  const videoId = getVideoId(link);
  if (!videoId) return null;

  // Title lives in #video-title (an <a>). Its `title` attribute usually has the
  // full, untruncated title; fall back to the visible text.
  const titleEl = item.querySelector("#video-title");
  const title =
    (titleEl && (titleEl.getAttribute("title") || titleEl.textContent)) || "";

  // Channel name is inside ytd-channel-name.
  const channelEl = item.querySelector("ytd-channel-name a, ytd-channel-name #text");
  const channel = (channelEl && channelEl.textContent.trim()) || "";

  // The description is NOT always rendered (home feed hides it). Grab it when
  // it's there; the background worker can fetch it later if missing.
  const descEl = item.querySelector("#description-text, yt-formatted-string#description-text");
  const description = (descEl && descEl.textContent.trim()) || "";

  if (!title) return null; // no title -> not a real video card we care about.

  return { videoId, title, channel, description };
}

// ---------------------------------------------------------------------------
// Visual treatment: dim the card and add the timeout badge
// ---------------------------------------------------------------------------

/** Apply the "this is a time-waster" look once a verdict comes back. */
function applyFlagged(item, result) {
  item.classList.add("yt-time-saver-flagged");

  // Avoid stacking two badges if we somehow run twice.
  if (item.querySelector(".yt-time-saver-badge")) return;

  const badge = document.createElement("div");
  badge.className = "yt-time-saver-badge";
  badge.textContent = "⏰";
  badge.title =
    `YT Time Saver: likely a time-waster\n` +
    `waste score: ${(result.waste * 100).toFixed(0)}%  ` +
    `confidence: ${(result.confidence * 100).toFixed(0)}%`;
  item.appendChild(badge);
}

// ---------------------------------------------------------------------------
// The scanning pipeline
// ---------------------------------------------------------------------------

/**
 * Process one card: get its text, ask the background to classify, then draw.
 * Returns a Promise so the queue can track how many jobs are in flight.
 */
function processItem(item) {
  return new Promise((resolve) => {
    const video = extractVideo(item);
    if (!video) {
      item.setAttribute("data-yts-state", "skip"); // not a video; don't retry.
      resolve();
      return;
    }

    chrome.runtime
      .sendMessage({ type: "classify", payload: video })
      .then((result) => {
        if (result && result.flagged) applyFlagged(item, result);
      })
      .catch(() => {
        /* message failed; ignore and leave the card untouched. */
      })
      .finally(() => {
        item.setAttribute("data-yts-state", "done");
        resolve();
      });
  });
}

/**
 * Start a job if we have room, otherwise hold it in the queue until a slot
 * frees up. Completing one job immediately pulls the next waiting one.
 */
function runItem(item) {
  if (activeJobs >= LIMIT_QUEUE) {
    pendingJobs.push(item);
    return;
  }
  activeJobs++;
  processItem(item).finally(() => {
    activeJobs--;
    if (pendingJobs.length > 0) runItem(pendingJobs.shift());
  });
}

/** Pull unprocessed cards off the page and feed them into the job queue. */
function scan() {
  const items = document.querySelectorAll(ITEM_SELECTORS.join(","));
  for (const item of items) {
    // Skip cards we've already handled (or already saw aren't videos).
    if (item.getAttribute("data-yts-state")) continue;
    item.setAttribute("data-yts-state", "queued");
    runItem(item);
  }
}

// ---------------------------------------------------------------------------
// Wired together: initial scan, then observe for anything new
// ---------------------------------------------------------------------------

let scanTimer = null;
function scheduleScan() {
  if (scanTimer) return;
  // Debounce: YouTube inserts many nodes at once on scroll, so wait briefly.
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scan();
  }, 350);
}

function start() {
  scan();
  // Watch the whole document for newly added video cards.
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  // A second pass a bit later catches cards YouTube hydrates after load.
  setTimeout(scan, 1200);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  // Read the master switch + API key so we know whether to bother scanning.
  const { enabled, apiKey } = await chrome.storage.local.get({
    enabled: true,
    apiKey: "",
  });
  isActive = enabled && !!apiKey;
  if (!isActive) {
    console.warn("[YT Time Saver] disabled or missing API key — not scanning.");
    return;
  }
  start();
}

// If the user turns the extension on / enters a key while a tab is open,
// reinitialise so it starts scanning without needing a page reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!("enabled" in changes) && !("apiKey" in changes)) return;
  boot();
});

boot();
