// Live test: the real extension, in real Chrome, on the real youtube.com (signed out).
// Run: node live.js <path-to-extension-folder>
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

// Which browser to drive. By default Playwright's own Chromium. Set CHROME_PATH to use another build
// that still accepts --load-extension (Chrome for Testing or Chromium). Set CHROME_NO_SANDBOX=1 in containers.
const BROWSER = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' };
const SANDBOX = process.env.CHROME_NO_SANDBOX ? ['--no-sandbox'] : [];

const EXT = path.resolve(process.argv[2] || '../extension');
const SHOTS = path.resolve(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass: !!pass }); console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-live-')), {
    headless: false,
    ...BROWSER,
    viewport: { width: 1440, height: 900 },
    args: ['--headless=new', ...SANDBOX, '--mute-audio', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const clickToolbar = () => sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
    await onClick(tabs[0]);
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error' && /thumbcheck|chrome-extension/i.test(m.text())) errors.push(m.text().slice(0, 200)); });

  await page.goto('https://www.youtube.com/results?search_query=thumbnail+design+tips', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('ytd-video-renderer a#thumbnail img', { timeout: 45000 });
  await sleep(2500);
  ok('real YouTube search page loaded', true, await page.evaluate(() => ({ results: document.querySelectorAll('ytd-video-renderer').length, url: location.pathname })));

  const snap = () => page.evaluate(() => {
    const marked = [...document.querySelectorAll('[data-thumbcheck]')];
    const imgs = [...document.querySelectorAll('img[data-thumbcheck-img]')];
    const labels = [...document.querySelectorAll('[data-thumbcheck-title]')];
    const hidden = [...document.querySelectorAll('h3 a span, h3 a yt-formatted-string')].filter(e => e.style.display === 'none').length;
    const card = marked[0];
    const r = imgs[0] ? imgs[0].getBoundingClientRect() : null;
    const b = imgs[0] ? imgs[0].parentElement.getBoundingClientRect() : null;
    return {
      marked: marked.length, imgs: imgs.length, labels: labels.length, hidden,
      tag: card ? card.tagName.toLowerCase() : null,
      href: card ? (card.querySelector('a[href*="/watch"]').getAttribute('href') || '').slice(0, 20) : null,
      shown: card ? card.querySelector('h3').innerText.trim() : null,
      fills: !!r && Math.round(r.width) === Math.round(b.width) && Math.round(r.height) === Math.round(b.height) && r.width > 100,
      inView: !!r && r.top >= 0 && r.bottom <= innerHeight,
      natural: imgs[0] ? imgs[0].naturalWidth : 0,
      inSidebar: card ? !!card.closest('#secondary') : null
    };
  });
  const status = () => page.locator('#thumbcheck-root .status').textContent();
  const one = s => s.marked === 1 && s.imgs === 1 && s.labels === 1 && s.hidden === 1 && s.fills;

  // Open the panel under YouTube's real rules
  await clickToolbar();
  await page.locator('#thumbcheck-root .panel').waitFor({ state: 'visible', timeout: 8000 });
  await sleep(1200);
  const look = await page.evaluate(() => {
    const root = document.querySelector('#thumbcheck-root').shadowRoot;
    return {
      fonts: [...document.fonts].filter(f => f.family.includes('ThumbCheck')).map(f => f.family + ':' + f.status),
      pics: [...root.querySelectorAll('.by img, .pill img')].map(i => i.naturalWidth),
      nameFont: getComputedStyle(root.querySelector('.name')).fontFamily.split(',')[0]
    };
  });
  ok('panel opens on real YouTube with brand fonts and pictures', look.fonts.length === 2 && look.fonts.every(f => f.endsWith('loaded')) && look.pics.every(w => w > 0), look);

  const TITLE = 'I Redesigned 100 Thumbnails. Here Is What Actually Got Clicks';
  await page.locator('#thumbcheck-root input[type=file]').setInputFiles(path.join(__dirname, 'thumb-v1.png'));
  await sleep(600);
  await page.locator('#thumbcheck-root .title').fill(TITLE);
  await page.locator('#thumbcheck-root .primary').click();
  await sleep(500);
  let s = await snap();
  ok('Check swaps one real search result', one(s) && s.tag === 'ytd-video-renderer' && s.shown === TITLE && s.inView && s.natural === 1280, s);
  await page.screenshot({ path: path.join(SHOTS, 'live-01-search.png') });

  let bad = [], prev = s.href, seen = new Set([s.href]);
  for (let i = 0; i < 15; i++) {
    await page.locator('#thumbcheck-root .secondary >> nth=0').click();
    s = await snap();
    if (!one(s) || s.href === prev || !s.inView || s.tag !== 'ytd-video-renderer') bad.push([i, s]);
    prev = s.href; seen.add(s.href);
  }
  ok('15 shuffles on real search results', bad.length === 0, bad.length ? bad.slice(0, 2) : { spots: seen.size });

  // YouTube's shortcuts must not fire while typing in the panel ("/" normally jumps to the search box)
  await page.locator('#thumbcheck-root .title').click();
  await page.keyboard.type(' / k m f');
  const typed = await page.evaluate(() => ({ focusOnPanel: document.activeElement && document.activeElement.id === 'thumbcheck-root', full: !!document.fullscreenElement, url: location.pathname }));
  ok('typing in the panel does not trigger YouTube shortcuts', typed.focusOnPanel && !typed.full && typed.url === '/results' && (await page.locator('#thumbcheck-root .title').inputValue()).includes(' / k m f'), typed);
  await page.locator('#thumbcheck-root .title').fill(TITLE);

  // Real clipboard paste
  let pasted = {};
  try {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.youtube.com' });
    await page.evaluate(async () => {
      document.activeElement && document.activeElement.blur();
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const g = c.getContext('2d'); g.fillStyle = '#FDA501'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#0B0B0B'; g.font = '900 170px Arial'; g.textAlign = 'center'; g.fillText('PASTED V2', 640, 420);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    });
    await page.locator('ytd-search').click({ position: { x: 2, y: 2 } }).catch(() => {});
    const before = (await snap()).href;
    await page.keyboard.press('Control+V');
    await sleep(900);
    s = await snap();
    pasted = { same: s.href === before, one: one(s), status: await status() };
  } catch (e) { pasted.error = String(e).slice(0, 160); }
  ok('real paste of a new thumbnail updates the same spot', pasted.same && pasted.one && pasted.status === 'Updated in the same spot.', pasted);

  // Move to a video page the way a viewer does (click a result)
  await page.locator('ytd-video-renderer:not([data-thumbcheck]) a#video-title').nth(1).click();
  await page.waitForURL(/\/watch\?v=/, { timeout: 30000 });
  await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.pause(); } });
  let followed = false;
  for (let i = 0; i < 40 && !followed; i++) { await sleep(700); s = await snap(); followed = s.marked === 1 && s.inSidebar === true; }
  await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.pause(); } });
  ok('the preview follows to the Up next list on a real video page', followed && one(s) && s.tag === 'yt-lockup-view-model' && s.shown === TITLE, s);
  const box = await page.locator('#thumbcheck-root .panel').boundingBox();
  ok('panel sits on the left beside a video', box.x === 20, box.x);
  await sleep(600);
  await page.screenshot({ path: path.join(SHOTS, 'live-02-watch.png') });

  // Shortcuts on the video page: k (play/pause), m (mute), f (fullscreen) must not fire from the panel
  const v0 = await page.evaluate(() => { const v = document.querySelector('video'); return v ? { paused: v.paused, muted: v.muted } : null; });
  await page.locator('#thumbcheck-root .title').click();
  await page.keyboard.type('kmf');
  await sleep(700);
  const v1 = await page.evaluate(() => { const v = document.querySelector('video'); return v ? { paused: v.paused, muted: v.muted, full: !!document.fullscreenElement } : null; });
  ok('k, m and f typed in the panel leave the video alone', !!v0 && !!v1 && v0.paused === v1.paused && v0.muted === v1.muted && !v1.full, { v0, v1 });
  await page.locator('#thumbcheck-root .title').fill(TITLE);

  // Hovering the swapped card must not start the old video's preview
  const spot = await page.evaluate(() => { const r = document.querySelector('img[data-thumbcheck-img]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(spot[0], spot[1], { steps: 8 });
  await sleep(2600);
  const hover = await page.evaluate(() => { const card = document.querySelector('[data-thumbcheck]'); const p = document.querySelector('ytd-video-preview'); const r = p ? p.getBoundingClientRect() : { width: 0 }; return { videosInCard: card.querySelectorAll('video').length, previewWidth: Math.round(r.width), still: !!card.querySelector('img[data-thumbcheck-img]') }; });
  ok('hovering the swapped card does not play the old video', hover.videosInCard === 0 && hover.previewWidth === 0 && hover.still, hover);

  // Up next shuffles
  bad = []; prev = (await snap()).href;
  for (let i = 0; i < 10; i++) {
    await page.locator('#thumbcheck-root .secondary >> nth=0').click();
    s = await snap();
    if (!one(s) || s.href === prev || !s.inSidebar) bad.push([i, s]);
    prev = s.href;
  }
  ok('10 shuffles in the real Up next list', bad.length === 0, bad.slice(0, 2));

  // Signed-out Home has no videos: the message must say so, then the preview returns on going back
  await page.locator('a#logo').first().click();
  await page.waitForURL('https://www.youtube.com/', { timeout: 30000 });
  await sleep(4000);
  const homeCount = await page.evaluate(() => document.querySelectorAll('ytd-rich-item-renderer a[href*="/watch?v="]').length);
  s = await snap();
  if (homeCount === 0) ok('Home with no videos (signed out): honest message', s.marked === 0 && (await status()).startsWith('No videos on this page'), await status());
  else ok('Home has videos: preview follows', one(s) && s.tag === 'ytd-rich-item-renderer', s);
  await page.screenshot({ path: path.join(SHOTS, 'live-03-home-signed-out.png') });
  await page.goBack();
  let back = false;
  for (let i = 0; i < 30 && !back; i++) { await sleep(700); s = await snap(); back = s.marked === 1; }
  await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.pause(); } });
  ok('going back: the preview returns', back && one(s), s);

  // Reset
  await page.locator('#thumbcheck-root .secondary >> nth=1').click();
  await sleep(400);
  s = await snap();
  ok('Reset on the real page removes everything', s.marked === 0 && s.imgs === 0 && s.labels === 0 && s.hidden === 0, s);

  ok('no errors from the extension', errors.length === 0, errors.slice(0, 4));
  const failed = results.filter(r => !r.pass);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' live checks passed');
  await ctx.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('LIVE TEST CRASHED', e); process.exit(2); });
