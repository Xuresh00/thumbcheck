// End-to-end test: loads the real extension into Chrome and drives it on a stand-in YouTube page.
// Run: node e2e.js <path-to-extension-folder>
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

// Which browser to drive. By default Playwright's own Chromium. Set CHROME_PATH to use another build
// that still accepts --load-extension (Chrome for Testing or Chromium). Set CHROME_NO_SANDBOX=1 in containers.
const BROWSER = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' };
const SANDBOX = process.env.CHROME_NO_SANDBOX ? ['--no-sandbox'] : [];
const mock = require('./mock.js');

const EXT = path.resolve(process.argv[2] || '../extension');
const SHOTS = path.resolve(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-profile-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    ...BROWSER,
    viewport: { width: 1440, height: 900 },
    args: ['--headless=new', ...SANDBOX, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('https://www.youtube.com/')) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': mock.CSP }, body: mock.page() });
    }
    if (url.startsWith('chrome-extension://') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    return route.abort();
  });

  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const clickToolbar = async match => sw.evaluate(async m => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => m === 'youtube' ? (t.url || '').startsWith('https://www.youtube.com/') : !(t.url || '').startsWith('https://www.youtube.com/'));
    await onClick(tab);
    return tab ? { id: tab.id, url: tab.url || null } : null;
  }, match);

  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('https://www.youtube.com/');
  await sleep(600);

  const snap = () => page.evaluate(() => {
    const marked = [...document.querySelectorAll('[data-thumbcheck]')];
    const imgs = [...document.querySelectorAll('img[data-thumbcheck-img]')];
    const labels = [...document.querySelectorAll('[data-thumbcheck-title]')];
    const hidden = [...document.querySelectorAll('h3 a span, h3 a yt-formatted-string')].filter(e => e.style.display === 'none').length;
    const card = marked[0];
    const box = imgs[0] ? imgs[0].getBoundingClientRect() : null;
    return {
      marked: marked.length, imgs: imgs.length, labels: labels.length, hidden,
      tag: card ? card.tagName.toLowerCase() : null,
      href: card ? card.querySelector('a[href]').getAttribute('href') : null,
      label: labels[0] ? labels[0].textContent : null,
      together: !!card && card.contains(imgs[0]) && (!labels[0] || card.contains(labels[0])),
      shown: card ? card.querySelector('h3').innerText.trim() : null,
      box: box ? [Math.round(box.left), Math.round(box.top), Math.round(box.right), Math.round(box.bottom)] : null,
      imgNatural: imgs[0] ? imgs[0].naturalWidth : 0,
      inView: box ? box.top >= 0 && box.bottom <= innerHeight : null
    };
  });
  const status = () => page.locator('#thumbcheck-root .status').textContent();

  // 1. Nothing shows until the toolbar button is clicked
  ok('nothing on the page before the first click', await page.locator('#thumbcheck-root').count() === 0);
  await clickToolbar('youtube');
  await page.locator('#thumbcheck-root .panel').waitFor({ state: 'visible', timeout: 5000 });
  ok('toolbar click opens the panel', true);
  await sleep(900);
  const look = await page.evaluate(() => {
    const root = document.querySelector('#thumbcheck-root').shadowRoot;
    const fam = sel => getComputedStyle(root.querySelector(sel)).fontFamily;
    const loaded = [...document.fonts].filter(f => f.family.includes('ThumbCheck')).map(f => f.family + ':' + f.status);
    const imgs = [...root.querySelectorAll('.by img, .pill img')].map(i => i.naturalWidth);
    return { loaded, imgs, name: root.querySelector('.name').textContent, by: root.querySelector('.by').textContent, nameFont: fam('.name'), check: root.querySelector('.primary').disabled };
  });
  ok('brand fonts load from the extension', look.loaded.length === 2 && look.loaded.every(s => s.endsWith('loaded')), look.loaded);
  ok('wordmark and Mr. Oops pictures load', look.imgs.length === 2 && look.imgs.every(w => w > 0), look.imgs);
  ok('name shows as ThumbCheck by Stupidesigner', look.name === 'ThumbCheck' && look.by.trim() === 'by', look);
  ok('Check is off until there is a thumbnail', look.check === true);
  await page.locator('#thumbcheck-root .panel').screenshot({ path: path.join(SHOTS, '01-panel-empty.png') });

  // 2. Add a thumbnail and a title, then Check
  await page.locator('#thumbcheck-root input[type=file]').setInputFiles(path.join(__dirname, 'thumb-v1.png'));
  await sleep(500);
  await page.locator('#thumbcheck-root .title').fill('My brand new video title that is fairly long to test two lines');
  ok('status says ready', (await status()).startsWith('Ready'), await status());
  await page.locator('#thumbcheck-root .primary').click();
  await sleep(400);
  let s = await snap();
  ok('Check swaps exactly one card', s.marked === 1 && s.imgs === 1 && s.labels === 1 && s.hidden === 1 && s.together, s);
  ok('the card is a normal video', s.tag === 'ytd-rich-item-renderer' && /^\/watch\?v=vid\d+$/.test(s.href), s.href);
  ok('the title on the card is ours', s.shown === 'My brand new video title that is fairly long to test two lines', s.shown);
  ok('the thumbnail picture loaded and is on screen', s.imgNatural === 1280 && s.inView === true, [s.imgNatural, s.inView]);
  ok('status after Check', (await status()).startsWith('It is in the feed now'), await status());
  await page.screenshot({ path: path.join(SHOTS, '02-home-checked.png') });
  await page.locator('#thumbcheck-root .panel').screenshot({ path: path.join(SHOTS, '03-panel-filled.png') });

  // 3. Shuffle: always one card, never the same twice, never an ad, a Short or a mix, never under the panel
  const panelBox = await page.locator('#thumbcheck-root .panel').boundingBox();
  let prev = s.href, bad = [], seen = new Set([s.href]);
  for (let i = 0; i < 40; i++) {
    await page.locator('#thumbcheck-root .secondary >> nth=0').click();
    s = await snap();
    const under = s.box && !(s.box[2] <= panelBox.x || s.box[0] >= panelBox.x + panelBox.width || s.box[3] <= panelBox.y || s.box[1] >= panelBox.y + panelBox.height);
    if (s.marked !== 1 || s.imgs !== 1 || s.labels !== 1 || s.hidden !== 1 || !s.together) bad.push(['count', i, s]);
    if (s.href === prev) bad.push(['same twice', i, s.href]);
    if (!/^\/watch\?v=vid\d+$/.test(s.href)) bad.push(['wrong kind', i, s.href]);
    if (under) bad.push(['under panel', i, s.box]);
    if (!s.inView) bad.push(['off screen', i, s.box]);
    prev = s.href; seen.add(s.href);
  }
  ok('40 shuffles: one clean swap each time', bad.length === 0, bad.slice(0, 3));
  ok('shuffle uses several different spots', seen.size >= 3, [...seen]);

  // 4. Changing the picture or the title updates the same spot
  const before = s.href;
  await page.locator('#thumbcheck-root input[type=file]').setInputFiles(path.join(__dirname, 'thumb-v2.jpg'));
  await sleep(500);
  s = await snap();
  ok('new thumbnail replaces the old one in the same spot', s.href === before && s.marked === 1 && s.imgs === 1 && s.imgNatural === 1280, [s.href, before, s.imgNatural]);
  ok('status says updated', (await status()) === 'Updated in the same spot.', await status());
  await page.locator('#thumbcheck-root .title').fill('Edited title');
  await sleep(200);
  s = await snap();
  ok('typing a new title updates the card', s.shown === 'Edited title' && s.href === before && s.labels === 1 && s.hidden === 1, s.shown);

  // 5. YouTube redraws the card: the preview comes back
  await page.evaluate(() => document.querySelector('img[data-thumbcheck-img]').remove());
  await sleep(1700);
  s = await snap();
  ok('preview comes back after the card is redrawn', s.marked === 1 && s.imgs === 1 && s.labels === 1 && s.hidden === 1 && s.href === before, s);

  // 6. Typing in the panel must not reach the page's keyboard shortcuts; Enter runs Check; Esc minimises
  await page.evaluate(() => {
    window.__keys = [];
    for (const t of ['keydown', 'keypress', 'keyup']) { document.addEventListener(t, e => window.__keys.push(t + ':' + e.key)); document.addEventListener(t, e => window.__keys.push('cap:' + t + ':' + e.key), true); }
  });
  await page.locator('#thumbcheck-root .title').click();
  await page.keyboard.type('k m f');
  let keys = await page.evaluate(() => window.__keys);
  ok('keys typed in the panel do not reach the page', keys.length === 0, keys.slice(0, 6));
  ok('typing still works in the title box', (await page.locator('#thumbcheck-root .title').inputValue()).endsWith('k m f'));
  const hrefBeforeEnter = (await snap()).href;
  await page.keyboard.press('Enter');
  await sleep(300);
  s = await snap();
  ok('Enter while the preview is on the page keeps it where it is', s.marked === 1 && s.href === hrefBeforeEnter, [hrefBeforeEnter, s.href]);
  ok('Enter does not add a line break', !(await page.locator('#thumbcheck-root .title').inputValue()).includes('\n'));
  await page.keyboard.press('Escape');
  await sleep(200);
  ok('Esc minimises to the Mr. Oops button', await page.locator('#thumbcheck-root .pill').isVisible() && !(await page.locator('#thumbcheck-root .panel').isVisible()));
  await page.screenshot({ path: path.join(SHOTS, '04-home-minimised.png') });
  await page.locator('#thumbcheck-root .pill').click();
  ok('the button opens the panel again', await page.locator('#thumbcheck-root .panel').isVisible());
  await page.keyboard.press('Tab'); // leave the panel
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); document.body.focus(); window.__keys = []; });
  await page.locator('#masthead-container').click();
  await page.keyboard.press('j');
  keys = await page.evaluate(() => window.__keys);
  ok('keys pressed on the page itself still reach the page', keys.includes('keydown:j'), keys.slice(0, 4));

  // 7. Paste anywhere: an image becomes the thumbnail, text becomes the title
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d'); g.fillStyle = '#0a7'; g.fillRect(0, 0, 640, 360);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'pasted.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await sleep(500);
  s = await snap();
  ok('pasting an image sets the thumbnail', s.imgNatural === 640 && s.marked === 1, s.imgNatural);
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', '  Pasted title\nfrom the clipboard ');
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await sleep(300);
  s = await snap();
  ok('pasting text on the page sets the title', s.shown === 'Pasted title from the clipboard' && (await page.locator('#thumbcheck-root .title').inputValue()) === 'Pasted title from the clipboard', s.shown);

  // 7b. Pasting text into YouTube's own search box is left alone
  await page.evaluate(() => {
    const box = document.querySelector('#search'); box.focus();
    const dt = new DataTransfer(); dt.setData('text/plain', 'something for the search box');
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await sleep(200);
  ok('pasting into the search box does not change the title', (await page.locator('#thumbcheck-root .title').inputValue()) === 'Pasted title from the clipboard');

  // 7c. A real Ctrl+V with a real clipboard: first an image, then text
  let realPaste = { image: null, text: null };
  try {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.youtube.com' });
    await page.locator('#masthead-container').click({ position: { x: 5, y: 5 } });
    await page.evaluate(async () => {
      document.activeElement && document.activeElement.blur();
      const c = document.createElement('canvas'); c.width = 320; c.height = 180;
      const g = c.getContext('2d'); g.fillStyle = '#c0f'; g.fillRect(0, 0, 320, 180);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    });
    await page.keyboard.press('Control+V');
    await sleep(600);
    realPaste.image = (await snap()).imgNatural;
    await page.evaluate(() => navigator.clipboard.writeText('Title from a real clipboard'));
    await page.keyboard.press('Control+V');
    await sleep(400);
    realPaste.text = await page.locator('#thumbcheck-root .title').inputValue();
  } catch (e) { realPaste.error = String(e).slice(0, 200); }
  ok('real Ctrl+V with an image on the clipboard sets the thumbnail', realPaste.image === 320, realPaste);
  ok('real Ctrl+V with text on the clipboard sets the title', realPaste.text === 'Title from a real clipboard', realPaste);
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', 'Pasted title from the clipboard');
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await sleep(200);

  // 8. Not 16:9, and a file that is not an image
  await page.locator('#thumbcheck-root input[type=file]').setInputFiles(path.join(__dirname, 'thumb-square.png'));
  await sleep(500);
  ok('a square image gets the cropped note', (await status()) === 'This image is not 16:9, so it is cropped to fit.', await status());
  s = await snap();
  const fit = await page.evaluate(() => { const i = document.querySelector('img[data-thumbcheck-img]'); const r = i.getBoundingClientRect(); const p = i.parentElement.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(p.width), Math.round(p.height), getComputedStyle(i).objectFit]; });
  ok('the picture fills the thumbnail box exactly', fit[0] === fit[2] && fit[1] === fit[3] && fit[4] === 'cover', fit);
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await sleep(200);
  ok('dropping a non-image says so', (await status()) === 'That is not an image. Use a JPG or PNG.', await status());

  // 9. Moving to another YouTube page (Search, then a video): the preview follows
  await page.evaluate(() => { document.querySelector('ytd-browse').hidden = true; document.querySelector('ytd-search').hidden = false; scrollTo(0, 0); });
  await sleep(2600);
  s = await snap();
  ok('preview follows to Search', s.marked === 1 && s.tag === 'ytd-video-renderer' && s.imgs === 1 && s.labels === 1 && s.hidden === 1 && s.shown === 'Pasted title from the clipboard', s);
  const onSearch = await page.evaluate(() => {
    const pic = document.querySelector('img[data-thumbcheck-img]');
    const th = pic.closest('ytd-thumbnail');
    const r = pic.getBoundingClientRect(), t = th.getBoundingClientRect();
    return {
      fills: Math.round(r.width) === Math.round(t.width) && Math.round(r.height) === Math.round(t.height) && Math.round(t.height) > 200,
      badgeOnTop: !!(pic.compareDocumentPosition(th.querySelector('#overlays')) & Node.DOCUMENT_POSITION_FOLLOWING),
      parent: pic.parentElement.id
    };
  });
  ok('on Search the picture fills the thumbnail and the duration stays on top', onSearch.fills && onSearch.badgeOnTop && onSearch.parent === 'thumbnail', onSearch);
  await page.screenshot({ path: path.join(SHOTS, '05-search.png') });
  await page.evaluate(() => {
    document.querySelector('ytd-search').hidden = true; document.querySelector('ytd-watch-flexy').hidden = false; scrollTo(0, 0);
    history.pushState(null, '', '/watch?v=playing'); document.dispatchEvent(new Event('yt-navigate-finish', { bubbles: true }));
  });
  await sleep(2600);
  const sideBox = await page.locator('#thumbcheck-root .panel').boundingBox();
  ok('beside a video the panel moves to the left, away from the Up next list', sideBox.x === 20, sideBox.x);
  s = await snap();
  ok('preview follows to the Up next list', s.marked === 1 && s.tag === 'yt-lockup-view-model' && /^\/watch\?v=vid\d+$/.test(s.href) && s.hidden === 1, s);
  await page.screenshot({ path: path.join(SHOTS, '06-watch.png') });
  const leftovers = await page.evaluate(() => ({ imgs: document.querySelectorAll('img[data-thumbcheck-img]').length, labels: document.querySelectorAll('[data-thumbcheck-title]').length, hidden: [...document.querySelectorAll('h3 a span, h3 a yt-formatted-string')].filter(e => e.style.display === 'none').length }));
  ok('nothing left behind on the pages we came from', leftovers.imgs === 1 && leftovers.labels === 1 && leftovers.hidden === 1, leftovers);

  await page.evaluate(() => { history.pushState(null, '', '/'); document.dispatchEvent(new Event('yt-navigate-finish', { bubbles: true })); });
  await sleep(200);
  ok('back on other pages the panel returns to the right', (await page.locator('#thumbcheck-root .panel').boundingBox()).x > 1000);

  // 9b. A page with no videos: the message says so, and the preview returns when videos are back
  await page.evaluate(() => { document.querySelector('ytd-watch-flexy').hidden = true; });
  await sleep(1700);
  ok('on a page with no videos the message says so', (await snap()).marked === 0 && (await status()).startsWith('No videos on this page'), await status());
  await page.evaluate(() => { document.querySelector('ytd-watch-flexy').hidden = false; });
  await sleep(2600);
  ok('the preview returns when videos are back', (await snap()).marked === 1 && (await status()).startsWith('It is in the feed now'), await status());

  // 10. Reset puts everything back
  await page.locator('#thumbcheck-root .secondary >> nth=1').click();
  await sleep(300);
  s = await snap();
  const clean = await page.evaluate(() => ({ styleLeft: [...document.querySelectorAll('h3 a span, h3 a yt-formatted-string')].filter(e => e.hasAttribute('style')).length, posLeft: [...document.querySelectorAll('yt-image, a#thumbnail, .ytThumbnailViewModelImage')].filter(e => e.hasAttribute('style')).length }));
  ok('Reset removes the preview completely', s.marked === 0 && s.imgs === 0 && s.labels === 0 && s.hidden === 0 && clean.styleLeft === 0 && clean.posLeft === 0, { s, clean });
  ok('status after Reset', (await status()) === 'Removed. The page is back to normal.', await status());
  await sleep(1600);
  ok('it stays off after Reset', (await snap()).marked === 0);
  await page.locator('#thumbcheck-root .title').click();
  await page.keyboard.press('Enter');
  await sleep(300);
  ok('Enter in the title box runs Check when nothing is on the page yet', (await snap()).marked === 1);
  await page.locator('#thumbcheck-root .secondary >> nth=1').click();
  await sleep(200);

  // 11. Hide with X, toolbar brings it back; your title and thumbnail survive a reload
  await page.locator('#thumbcheck-root .icon >> nth=1').click();
  ok('X hides the panel', !(await page.locator('#thumbcheck-root .wrap').isVisible()));
  await clickToolbar('youtube');
  ok('toolbar click shows it again', await page.locator('#thumbcheck-root .panel').isVisible());
  await sleep(600);
  await page.reload();
  await sleep(600);
  ok('after a reload nothing shows until you click', await page.locator('#thumbcheck-root').count() === 0);
  await clickToolbar('youtube');
  await page.locator('#thumbcheck-root .panel').waitFor({ state: 'visible', timeout: 5000 });
  await sleep(500);
  const kept = await page.evaluate(() => { const r = document.querySelector('#thumbcheck-root').shadowRoot; return { title: r.querySelector('.title').value, img: r.querySelector('.preview').naturalWidth, hiddenPreview: r.querySelector('.preview').hidden, check: r.querySelector('.primary').disabled }; });
  ok('title and thumbnail are remembered after a reload', kept.title === 'Pasted title from the clipboard' && kept.img > 0 && !kept.hiddenPreview && !kept.check, kept);

  // 12. A second copy of the scripts (what happens after an extension update) replaces the first cleanly
  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
    await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['core.js', 'panel.js'] });
  });
  await sleep(300);
  ok('old panel is removed when the scripts load again', await page.locator('#thumbcheck-root').count() === 0);
  await clickToolbar('youtube');
  await sleep(400);
  ok('one panel only after loading twice', await page.locator('#thumbcheck-root').count() === 1 && await page.locator('#thumbcheck-root .panel').isVisible());

  // 13. Clicking the toolbar button on another site opens YouTube with the panel ready
  const other = await ctx.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  const [fresh] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }), clickToolbar('other')]);
  await fresh.waitForLoadState('domcontentloaded');
  let auto = false;
  try { await fresh.locator('#thumbcheck-root .panel').waitFor({ state: 'visible', timeout: 6000 }); auto = true; } catch (e) {}
  ok('from another site: YouTube opens with the panel ready', auto && fresh.url().startsWith('https://www.youtube.com/'), fresh.url());

  // 14. Light theme look, for the screenshot
  await fresh.evaluate(() => { document.documentElement.style.background = '#fff'; document.body.style.background = '#fff'; document.body.style.color = '#0f0f0f'; for (const el of document.querySelectorAll('#masthead-container, #guide, #chips')) el.style.background = '#fff'; for (const a of document.querySelectorAll('.ytLockupMetadataViewModelTitle')) a.style.color = '#0f0f0f'; });
  await fresh.locator('#thumbcheck-root input[type=file]').setInputFiles(path.join(__dirname, 'thumb-v1.png'));
  await sleep(500);
  await fresh.locator('#thumbcheck-root .primary').click();
  await sleep(400);
  await fresh.screenshot({ path: path.join(SHOTS, '07-home-light.png') });

  ok('no errors in the page console', errors.length === 0, errors.slice(0, 5));

  const failed = results.filter(r => !r.pass);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed');
  await ctx.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(2); });
