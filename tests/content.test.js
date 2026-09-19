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
