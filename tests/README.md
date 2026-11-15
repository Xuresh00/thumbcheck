# ThumbCheck tests

These drive the real extension in a real Chromium with [Playwright](https://playwright.dev).

```
npm install
npx playwright install chromium
npm test               # 53 checks on a stand-in YouTube page (mock.js)
npm run test:live      # 15 checks on the real youtube.com, signed out
npm run test:fallback  # a YouTube tab that was open before the extension was installed
```

Options:

- `CHROME_PATH=/path/to/chrome` uses another browser build. It has to accept `--load-extension`, so use Chrome for Testing or Chromium. Regular Google Chrome no longer does.
- `CHROME_NO_SANDBOX=1` adds `--no-sandbox`, which containers and some CI machines need.

## When YouTube changes its page

`mock.js` copies the card markup YouTube used on 15 Nov 2026:

- Home and Up next: `yt-lockup-view-model` (inside `ytd-rich-item-renderer` on Home)
- Search: `ytd-video-renderer`, where the thumbnail image sits in a thin inline `yt-image` wrapper

When the markup changes, look at the live page first, update `extension/core.js` (the `CARD` list, `partsOf`, `thumbBox`, `titleHolder`), copy the new markup into `mock.js`, then run all three.

Signed-out Home has no videos, so `test:live` cannot check Home. Check Home in a signed-in browser.
