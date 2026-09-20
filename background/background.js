// ============================================================================
// background.js  —  Service Worker
// ----------------------------------------------------------------------------
// This is the "engine room" of the extension. It runs in the background and
// never touches the YouTube page directly. The content script (content.js)
// collects video info from the page and sends it here. This file:
//
//   1. Reads the user's settings + API key (stored by the options page).
//   2. Calls the TypeSafe "System One" API to classify each video.
//   3. Turns the structured answers into a single "time-waste" score.
//   4. Caches results so we don't re-classify the same video twice.
//   5. Returns the verdict to the content script, which does the visual work.
//
// Why put the API call here and not in the content script?
//   - The API key never lives on the YouTube page, so it stays safer.
//   - The service worker can fetch cross-origin (it has host_permissions).
//   - It centralises the scoring/caching logic in one place.
// ============================================================================

const API_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest"; // TypeSafe's flagship System One model.

// Default settings used when nothing is saved yet. The options page overwrites
// these in chrome.storage.local.
const DEFAULTS = {
  enabled: true,            // Master on/off switch for the whole extension.
  apiKey: "",               // TypeSafe API key (paste in the options page).
  threshold: 0.6,           // A video is flagged when its waste score >= this.
  confidenceMin: 0.5,       // We only trust/act when confidence >= this.
  fetchDescription: true,   // Best-effort fetch of the description (home feed hides it).
};

// Cache tuning. We keep classifications in chrome.storage.session so they
// survive service-worker restarts within the same browser session (and are
// cleared when the browser closes).
const CLASSIFIER_VERSION = 2;
const CACHE_MAX_ENTRIES = 600;  // Don't let the cache grow forever.
const CACHE_TTL_MS = 30 * 60 * 1000; // Re-classify after 30 minutes.
const REQUEST_TIMEOUT_MS = 15000;

/** Keep a slow YouTube or TypeSafe request from outliving the service worker. */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Read the saved settings from chrome.storage.local, merged with defaults. */
async function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Load the whole classification cache as a plain object keyed by videoId.
 * Each entry looks like: { waste, confidence, flagged, ts }
 */
async function getCache() {
  const data = await chrome.storage.session.get("cache");
  return data.cache || {};
}

/** Save the cache back to chrome.storage.session, capping its size. */
async function setCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX_ENTRIES) {
    // Drop the oldest entries first (oldest `ts`).
    keys
      .sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0))
      .slice(0, keys.length - CACHE_MAX_ENTRIES)
      .forEach((k) => delete cache[k]);
  }
  await chrome.storage.session.set({ cache });
}

// ---------------------------------------------------------------------------
// TypeSafe request + scoring
// ---------------------------------------------------------------------------

/**
 * Build the `state` (the text a video is judged against). This is the raw
 * material Jev reads. When the description is empty (common on the home feed),
 * the content script may not have it, so we fetch it below.
 */
function buildState(video) {
  const parts = [];
  if (video.title) parts.push(`Title: ${video.title}`);
  if (video.channel) parts.push(`Channel: ${video.channel}`);
  if (video.duration) parts.push(`Duration: ${video.duration}`);
  if (video.description) parts.push(`Description: ${video.description}`);
  return parts.join("\n");
}

/**
 * The questions we ask Jev in ONE call. Asking them together evaluates all of
 * them in parallel against the same state — adding more questions barely
 * changes the response time or cost.
 *
 * We split "is this worth the user's time?" into focused judgments and
 * combine them in code (the "composite scoring" pattern from the TypeSafe
 * docs). Usefulness carries most of the weight. The other signals catch
 * entertaining, addictive, or spammy videos whose titles can look harmless.
 */
function buildQuestions() {
  return {
    usefulness: {
      type: "score",
      instructions:
        "How useful is this video for productive work, education, learning durable knowledge, building a practical skill, or completing a real task? Judge the likely primary viewer payoff from the title, channel, and description. Popularity, production quality, celebrity interest, passive inspiration, and entertainment value do not count as usefulness by themselves.",
      criteria: [
        "No meaningful work, education, knowledge, skill-building, or productivity value",
        "Mostly entertainment, opinion, vague inspiration, or shallow information with only incidental useful value",
        "Meaningfully informative or practical and likely to teach useful knowledge or help with a task",
        "Directly actionable, in-depth, or clearly valuable for work, study, skill-building, or productivity",
      ],
    },
    entertainment: {
      type: "noul",
      instructions:
        "The video's primary payoff is passive entertainment, celebrity interest, music, comedy, drama, spectacle, gossip, or amusement rather than work, education, learning, knowledge, skill-building, or productivity.",
    },
    attentionTrap: {
      type: "noul",
      instructions:
        "The video uses clickbait, outrage, shock, hype, rapid stimulation, or curiosity manipulation to encourage compulsive clicking or prolonged watching.",
    },
    spam: {
      type: "noul",
      instructions:
        "The video is low-effort, repetitive, recycled, misleading, mass-produced, or filler content with little substance.",
    },
  };
}

/**
 * Turn the TypeSafe answers into a single 0..1 "time-waste" score.
 *
 * Weights let us control how much each signal matters. Low usefulness is the
 * main signal. Entertainment, attention traps, and spam refine the result.
 *
 * `confidence` comes from the `usefulness` Score answer and tells us how certain
 * Jev is. We use it to avoid acting on guesses (highlighting the docs' lesson:
 * "I don't know" is a useful signal).
 */
function computeWaste(answers) {
  const usefulnessAnswer = answers.usefulness;
  const usefulnessMax = usefulnessAnswer && usefulnessAnswer.legend
    ? Object.keys(usefulnessAnswer.legend).length - 1
    : 3;
  const usefulnessScore = usefulnessAnswer ? usefulnessAnswer.score : 0;
  const lowUsefulness = 1 - usefulnessScore / usefulnessMax;
  const entertainment = answers.entertainment ? answers.entertainment.noul : 0;
  const attentionTrap = answers.attentionTrap ? answers.attentionTrap.noul : 0;
  const spam = answers.spam ? answers.spam.noul : 0;

  // A lack of useful payoff is the main reason to flag a video. The remaining
  // signals distinguish shallow or addictive consumption from useful content.
  const waste =
    lowUsefulness * 0.8 +
    entertainment * 0.1 +
    attentionTrap * 0.06 +
    spam * 0.04;
  const confidence = usefulnessAnswer && usefulnessAnswer.confidence != null
    ? usefulnessAnswer.confidence
    : 0.5;

  return { waste, confidence };
}

/** Decide whether a video should be flagged, based on the user's thresholds. */
function shouldFlag(result, settings) {
  return (
    result.waste >= settings.threshold &&
    result.confidence >= settings.confidenceMin
  );
}

// ---------------------------------------------------------------------------
// Description fetching (best-effort)
// ---------------------------------------------------------------------------
//
// On YouTube's home feed, video cards DON'T render the description in the DOM,
// so the content script often has an empty description. To get it we ask
// YouTube's own (un-official) "innertube" player API for the video metadata.
// This is optional and wrapped in try/catch — if it fails we simply continue
// with title + channel only.

async function fetchDescription(videoId) {
  // YouTube may reject this unauthenticated metadata request. That is fine:
  // classification falls back to the title and channel. Never commit a
  // Google/YouTube client key to a public extension repository.
  const url = "https://www.youtube.com/youtubei/v1/player";
  const body = {
    context: {
      client: {
        clientName: "WEB",
        clientVersion: "2.20240101.00.00",
      },
    },
    videoId,
  };
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data && data.videoDetails && data.videoDetails.shortDescription
    ? data.videoDetails.shortDescription
    : null;
}

// ---------------------------------------------------------------------------
// Classify one video
// ---------------------------------------------------------------------------

/**
 * The main workhorse: given a video object, return a verdict.
 * Returns { status, flagged, waste, confidence } or { status: "no-key" }.
 */
async function classify(video) {
  const settings = await getSettings();

  // If the user disabled the extension or hasn't added a key, do nothing.
  if (!settings.enabled) return { status: "disabled", flagged: false };
  if (!settings.apiKey) return { status: "no-key", flagged: false };

  // Short-circuit on a cached verdict so scrolling back doesn't re-call the API.
  const cache = await getCache();
  const cached = cache[video.videoId];
  if (
    cached &&
    cached.classifierVersion === CLASSIFIER_VERSION &&
    Date.now() - cached.ts < CACHE_TTL_MS
  ) {
    return { status: "cache", flagged: cached.flagged, waste: cached.waste, confidence: cached.confidence };
  }

  // Try to fill in a missing description when the user allowed it.
  let description = video.description;
  if (!description && settings.fetchDescription) {
    try {
      const fetched = await fetchDescription(video.videoId);
      if (fetched) description = fetched;
    } catch (_) {
      /* ignore — title + channel is still a useful fallback */
    }
  }

  const state = buildState({ ...video, description });

  let data;
  try {
    const res = await fetchWithTimeout(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        state,
        questions: buildQuestions(),
      }),
    });

    if (res.status === 401) return { status: "bad-key", flagged: false };
    if (!res.ok) return { status: "error", flagged: false };

    data = await res.json();
  } catch (_) {
    // Network error or the service worker's fetch failed. Don't flag anything.
    return { status: "network-error", flagged: false };
  }

  const answers = data.answers || {};
  const result = computeWaste(answers);
  const flagged = shouldFlag(result, settings);

  // Remember this verdict for later.
  const entry = {
    waste: result.waste,
    confidence: result.confidence,
    flagged,
    classifierVersion: CLASSIFIER_VERSION,
    ts: Date.now(),
  };
  cache[video.videoId] = entry;
  await setCache(cache);

  return {
    status: "ok",
    flagged,
    waste: result.waste,
    confidence: result.confidence,
  };
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------
// The content script posts messages here. We reply via sendResponse and return
// `true` to keep the message channel open for the async reply.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "classify") {
    classify(message.payload)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ status: "error", flagged: false }));
    return true; // async — we'll call sendResponse later.
  }
  if (message && message.type === "getStatus") {
    getSettings().then((s) =>
      sendResponse({ enabled: s.enabled, hasApiKey: !!s.apiKey })
    );
    return true;
  }
});
