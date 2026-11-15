// A YouTube tab that was already open before the extension was installed has no ThumbCheck scripts in it.
// The toolbar button must add them and open the panel. (Simulated with a copy that never auto-loads its scripts.)
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require('playwright');

// Which browser to drive. By default Playwright's own Chromium. Set CHROME_PATH to use another build
// that still accepts --load-extension (Chrome for Testing or Chromium). Set CHROME_NO_SANDBOX=1 in containers.
const BROWSER = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' };
const SANDBOX = process.env.CHROME_NO_SANDBOX ? ['--no-sandbox'] : [];
const mock = require('./mock.js');
(async () => {
  // a copy of the extension that never auto-loads its scripts
  const SRC = path.resolve(process.argv[2] || '../extension');
  const EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-nocs-'));
  fs.cpSync(SRC, EXT, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  delete manifest.content_scripts;
  fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-')), { headless: false, ...BROWSER, viewport: { width: 1440, height: 900 }, args: ['--headless=new', ...SANDBOX, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  await ctx.route('**/*', r => r.request().url().startsWith('https://www.youtube.com/') ? r.fulfill({ status: 200, contentType: 'text/html', headers: { 'content-security-policy': mock.CSP }, body: mock.page() }) : r.continue());
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const page = ctx.pages()[0]; await page.goto('https://www.youtube.com/');
  await new Promise(r => setTimeout(r, 500));
  const click = () => sw.evaluate(async () => { const t = await chrome.tabs.query({ url: 'https://www.youtube.com/*' }); await onClick(t[0]); return t[0] && t[0].url; });
  console.log('scripts in page before click:', await page.locator('#thumbcheck-root').count());
  console.log('tab url seen by the button:', await click());
  await page.locator('#thumbcheck-root .panel').waitFor({ state: 'visible', timeout: 5000 });
  console.log('PASS panel opened after the button added the scripts');
  await click();
  await new Promise(r => setTimeout(r, 300));
  console.log((await page.locator('#thumbcheck-root .wrap').isVisible()) ? 'FAIL second click should hide' : 'PASS second click hides it (one copy only)', 'roots:', await page.locator('#thumbcheck-root').count());
  await ctx.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
