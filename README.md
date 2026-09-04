<div align="center">

# IG Downloader

**A download button for every piece of Instagram media — right where it lives.**

Posts · Reels · Carousels · Profile pictures · Stories

[![Chrome](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop/concepts/manifest-v3)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-built_with-fbf0c9?logo=bun&logoColor=black)](https://bun.sh)
[![License](https://img.shields.io/badge/license-private-lightgrey)](#license)

</div>

---

IG Downloader overlays a small, unobtrusive button on top of every image and video on Instagram. One click saves the original-quality file straight to `Downloads/Instagram/` — no copy-pasting URLs, no third-party downloader sites, no re-encoding.

## What it does

| Where | What you get |
| --- | --- |
| Feed & profile posts | Photo or video in the highest available resolution |
| Carousels | Every item, in order, in one click |
| Reels | Video file, not a `blob:` stream |
| Profile grid | Button on every thumbnail |
| Profile picture | Full-resolution HD version |
| Stories & highlights | Current item, or the whole reel |

The button talks back: it spins while resolving, turns green when files are saved, and turns red with the reason in the tooltip when something fails.

## How it works

Instagram serves video through `blob:` URLs, so the real source never appears in the DOM. Instead of scraping, the extension reads the shortcode from the card you clicked and asks Instagram's own web API — using **your** logged-in session, from your tab. There is no middleman server, no account, no token of its own.

Resolution order for a post:

1. `/api/v1/media/{pk}/info/` — pk derived from the shortcode
2. `/graphql/query` with a post `doc_id` — fallback
3. `/api/v1/users/web_profile_info/` — profile pictures and user ids
4. `/api/v1/feed/reels_media/` — stories and highlights

If Instagram rotates a route, the button turns red and tells you. The identifiers live at the top of [`src/instagram.ts`](src/instagram.ts).

## Install

Requires [Bun](https://bun.sh).

```sh
bun install
bun run build    # generates dist/
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `dist/` folder

After each rebuild, hit the refresh icon on the extension card and reload the Instagram tab.

## Development

```sh
bun run build   # bundle content + background scripts into dist/
bun run check   # tsc --noEmit
bun test
```

```
src/
├── content.ts      # DOM scanning, button overlay, state machine
├── instagram.ts    # Instagram web API client
├── background.ts   # chrome.downloads wiring
└── messages.ts     # content ⇄ background contract
```

## Limitations

- You must be logged in to Instagram in the tab — the extension borrows that session.
- Carousels download every item at once.
- A story without an id in the URL downloads the whole reel.

## License

Personal project, published as-is. Instagram's terms apply to whatever you download.
