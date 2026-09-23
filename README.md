# YT Time Saver 🛡️ — Watch on purpose, not on impulse.

> A cover over the YouTube videos that look more distracting than useful.

[![version](https://img.shields.io/badge/version-0.1.0-2ea44f?style=flat-square)](manifest.json)
[![Chrome](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![powered by Jev](https://img.shields.io/badge/powered%20by-Jev-6E56CF?style=flat-square)](https://docs.typesafe.ai/introduction)
[![stars](https://img.shields.io/github/stars/jaibhasin/jev-yt-time-saver?style=flat-square&logo=github&label=stars)](https://github.com/jaibhasin/jev-yt-time-saver/stargazers)

![YT Time Saver demo](assets/gif123.gif)

## Why

YouTube is very good at keeping you watching. This extension decides which thumbnails and titles look like time-wasters and drops a shield over the whole card, so you still see it exists — but you have to mean it to watch.

Nothing is ever hidden permanently. Every covered video has a reveal, and once you reveal it, it stays revealed for that tab.

## What it does

- Scans the home feed, search results, subscriptions, and the watch-page sidebar.
- Reads the signals YouTube shows (title, channel, duration) plus your current search intent, and asks [Jev](https://docs.typesafe.ai/introduction) to score each video.
- Covers likely time-wasters with a dimmed shield you can click to reveal.
- Handles YouTube's lazy-loading feed with a `MutationObserver`, so new cards are checked as you scroll.
- Keeps your key local — the API key lives only in your browser's extension storage.

## Quick install

You'll need Chrome and your own [TypeSafe API key](https://console.typesafe.ai/keys).

1. [Download the code](https://github.com/jaibhasin/jev-yt-time-saver/archive/refs/heads/main.zip) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Open **YT Time Saver** from Chrome's extensions menu, click **Settings**, paste your API key, and save.
5. Open or refresh YouTube.

## Settings

Open the extension's **Settings** page to tune it:

- **Enable the extension** — turn shielding on or off.
- **Waste threshold** — higher means only very likely time-wasters get covered.
- **Minimum confidence** — how sure Jev must be before it acts.
- **Fetch the video description** — the home feed hides descriptions in the DOM, so this asks YouTube's player API for them to give Jev more signal.

## How it works

`content.js` runs on the page, finds each video card, and sends its visible text to `background.js`, which talks to the Jev API. Verdicts come back and the content script covers the card. See the comments at the top of [`content/content.js`](content/content.js) for the full flow.
