# YT Time Saver

You opened YouTube for one tutorial.
An hour later, you're watching something you never meant to click.

YT Time Saver is a small Chrome extension that puts a cover over videos that look more distracting than useful, powered by [Jev from TypeSafe](https://docs.typesafe.ai/introduction).
Hit **Show anyway** whenever you want to watch one.
You still get the final say.

## Try it

You'll need Chrome and your own [TypeSafe API key](https://console.typesafe.ai/keys).

1. [Download the code](https://github.com/jaibhasin/jev-yt-time-saver/archive/refs/heads/main.zip) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Open **YT Time Saver** from Chrome's extensions menu, click **Settings**, paste your API key, and save.
5. Open or refresh YouTube.

No build step or dependencies to install.
API usage is through your own TypeSafe account.

## What it looks at

Jev evaluates a video's title, channel, and available description for usefulness, entertainment, attention traps, and spam.
The extension combines those signals and covers videos above your chosen threshold, provided the usefulness judgment meets your minimum confidence setting.

It judges metadata, not the video itself.
It's opinionated toward learning and getting things done, so entertainment can get covered too.
It will get some calls wrong.
That's what **Show anyway** is for.

## Your data

Your API key and settings stay in local browser storage.
The key authenticates requests to TypeSafe, and video metadata is sent there for classification.
Optional description fetching requests metadata from YouTube; you can turn it off in Settings.
There's no separate backend or analytics in this extension.

## Development

Plain JavaScript, CSS, and Chrome Manifest V3.
After editing, reload the extension in `chrome://extensions` and refresh YouTube.

Run the tests with Node.js:

```sh
node --test tests/*.test.js
```

Found a broken layout or an odd classification?
[Open an issue](https://github.com/jaibhasin/jev-yt-time-saver/issues) with what happened and, if possible, the video link.
