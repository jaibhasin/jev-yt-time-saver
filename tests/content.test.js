const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.attributes = {};
    this.children = [];
    this.classList = new FakeClassList(this);
    this.listeners = {};
    this.parentNode = null;
    this.textContent = "";
    this.title = "";
    this.type = "";
  }

  set className(value) {
    this.classList.values = new Set(value.split(/\s+/).filter(Boolean));
  }

  get className() {
    return [...this.classList.values].join(" ");
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(
      (child) => child !== this
    );
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  click() {
    const event = {
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
    };
    this.listeners.click(event);
    return event;
  }

  querySelector(selector) {
    if (!selector.startsWith(".")) return null;
    const className = selector.slice(1);
    const queue = [...this.children];
    while (queue.length > 0) {
      const element = queue.shift();
      if (element.classList.contains(className)) return element;
      queue.push(...element.children);
    }
    return null;
  }
}

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "content.js"),
  "utf8"
);

const context = vm.createContext({
  chrome: {
    runtime: { sendMessage: async () => ({ flagged: false }) },
    storage: {
      local: { get: async () => ({ enabled: false, apiKey: "" }) },
      onChanged: { addListener() {} },
    },
  },
  console,
  document: {
    createElement: (tagName) => new FakeElement(tagName),
    querySelectorAll: () => [],
  },
  URLSearchParams,
  window: { location: { pathname: "/", search: "" } },
  MutationObserver: class {
    observe() {}
  },
  setTimeout,
});

vm.runInContext(source, context);

function applyFlagged(item, videoId = "abcdefghijk") {
  context.item = item;
  context.videoId = videoId;
  vm.runInContext(
    "applyFlagged(item, { waste: 0.87, confidence: 0.91 }, videoId)",
    context
  );
}

test("flagging adds a full-card shield with an intentional reveal action", () => {
  const item = new FakeElement("ytd-rich-item-renderer");

  applyFlagged(item);

  assert.equal(item.classList.contains("yt-time-saver-flagged"), true);
  const shield = item.querySelector(".yt-time-saver-shield");
  assert.ok(shield);
  assert.equal(shield.getAttribute("role"), "group");
  assert.match(shield.title, /Waste score: 87%/);
  assert.equal(
    item.querySelector(".yt-time-saver-title").textContent,
    "Likely time-waster"
  );
  assert.equal(
    item.querySelector(".yt-time-saver-reveal").textContent,
    "Show anyway"
  );
});

test("show anyway removes the shield and remembers the video", () => {
  const item = new FakeElement("ytd-rich-item-renderer");
  const videoId = "lmnopqrstuv";

  applyFlagged(item, videoId);
  const event = item.querySelector(".yt-time-saver-reveal").click();

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.equal(item.classList.contains("yt-time-saver-flagged"), false);
  assert.equal(item.getAttribute("data-yts-revealed"), "true");
  assert.equal(item.querySelector(".yt-time-saver-shield"), null);

  applyFlagged(item, videoId);
  assert.equal(item.querySelector(".yt-time-saver-shield"), null);
});

test("repeated results do not stack duplicate shields", () => {
  const item = new FakeElement("ytd-rich-item-renderer");

  applyFlagged(item);
  applyFlagged(item);

  assert.equal(
    item.children.filter((child) =>
      child.classList.contains("yt-time-saver-shield")
    ).length,
    1
  );
});

// The helper builds a bare anchor that only reports its href, the way our
// extraction code reads YouTube's <a> elements.
function anchorFor(href) {
  return { getAttribute: (name) => (name === "href" ? href : null) };
}

test("extractVideo includes the duration shown on a home-feed card", () => {
  const thumbnail = {
    getAttribute: (name) => (name === "href" ? "/watch?v=dQw4w9WgXcQ" : null),
    textContent: "12:34",
  };
  const title = {
    getAttribute: (name) => (name === "title" ? "A useful video" : null),
    textContent: "A useful video",
  };
  const channel = { textContent: "A channel" };
  const duration = { textContent: "12:34" };
  const item = {
    textContent: "A useful video A channel 12:34",
    querySelector(selector) {
      if (selector === "a#thumbnail") return thumbnail;
      if (selector.includes("#video-title")) return title;
      if (selector.includes("ytd-channel-name")) return channel;
      if (selector.includes("#description-text")) return null;
      if (selector.includes("ytd-thumbnail-overlay-time-status-renderer")) {
        return duration;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('/watch?v=')) return [thumbnail];
      if (selector.includes('/shorts/')) return [];
      if (selector.includes('a[href^="/@"]')) return [channel];
      return [];
    },
  };

  context.item = item;
  const video = vm.runInContext("extractVideo(item)", context);

  assert.equal(video.duration, "12:34");
});

test("extractVideo sends sponsored video cards through the normal classifier path", () => {
  const thumbnail = {
    getAttribute: (name) => (name === "href" ? "/watch?v=dQw4w9WgXcQ" : null),
    textContent: "",
  };
  const title = {
    getAttribute: (name) => (name === "title" ? "Free for students" : null),
    textContent: "Free for students",
  };
  const channel = { textContent: "Gemini Notebook" };
  const item = {
    textContent: "Sponsored Free for students Gemini Notebook",
    querySelector(selector) {
      if (selector === "a#thumbnail") return thumbnail;
      if (selector.includes("#video-title")) return title;
      if (selector.includes("ytd-channel-name")) return channel;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('/watch?v=')) return [thumbnail];
      if (selector.includes('/shorts/')) return [];
      if (selector.includes('a[href^="/@"]')) return [channel];
      return [];
    },
  };

  context.item = item;
  const video = vm.runInContext("extractVideo(item)", context);

  assert.equal(video.videoId, "dQw4w9WgXcQ");
  assert.equal(video.title, "Free for students");
  assert.equal(video.channel, "Gemini Notebook");
  assert.equal(video.description, "");
  assert.equal(video.duration, "");
  assert.equal(video.searchQuery, "");
});

test("the scan list includes YouTube sponsored video renderers", () => {
  const selectors = vm.runInContext("ITEM_SELECTORS", context);

  assert.ok(selectors.includes("ytd-promoted-video-renderer"));
  assert.ok(selectors.includes("ytd-compact-promoted-video-renderer"));
});

test("extractVideo includes the active search query on search results", () => {
  const thumbnailForSearch = {
    getAttribute: (name) => (name === "href" ? "/watch?v=dQw4w9WgXcQ" : null),
    textContent: "",
  };
  const titleForSearch = {
    getAttribute: (name) => (name === "title" ? "A useful video" : null),
    textContent: "A useful video",
  };
  const channelForSearch = { textContent: "A channel" };

  context.window = {
    location: { pathname: "/results", search: "?search_query=learn+sourdough+bread" },
  };
  context.item = {
    textContent: "A useful video A channel",
    querySelector(selector) {
      if (selector === "a#thumbnail") return thumbnailForSearch;
      if (selector.includes("#video-title")) return titleForSearch;
      if (selector.includes("ytd-channel-name")) return channelForSearch;
      if (selector.includes("#description-text")) return null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('/watch?v=')) return [thumbnailForSearch];
      if (selector.includes('/shorts/')) return [];
      if (selector.includes('a[href^="/@"]')) return [channelForSearch];
      return [];
    },
  };

  const video = vm.runInContext("extractVideo(item)", context);

  assert.equal(video.searchQuery, "learn sourdough bread");
});

test("getVideoId reads a classic /watch?v= link", () => {
  context.anchor = anchorFor("/watch?v=dQw4w9WgXcQ");
  const id = vm.runInContext("getVideoId(anchor)", context);
  assert.equal(id, "dQw4w9WgXcQ");
});

test("getVideoId reads a Shorts /shorts/ID link", () => {
  context.anchor = anchorFor("/shorts/dQw4w9WgXcQ");
  const id = vm.runInContext("getVideoId(anchor)", context);
  assert.equal(id, "dQw4w9WgXcQ");
});

test("getVideoId returns null for links without a video id", () => {
  context.anchor = anchorFor("/@SomeChannel/featured");
  const id = vm.runInContext("getVideoId(anchor)", context);
  assert.equal(id, null);
});
