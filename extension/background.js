/*
 * ThumbCheck by Stupidesigner
 * background.js: handles the toolbar button.
 * Click it on YouTube and the panel opens or closes. Click it anywhere else and YouTube opens with the panel ready.
 */
const YOUTUBE = 'https://www.youtube.com/';
const TOGGLE = { type: 'thumbcheck:toggle' };

async function onClick(tab) {
  if (!tab || tab.id == null) return;

  try {
    await chrome.tabs.sendMessage(tab.id, TOGGLE);
    return;
  } catch (e) { /* this tab has no panel yet */ }

  if (tab.url && tab.url.startsWith(YOUTUBE)) {
    // A YouTube tab that was already open when the extension was installed or updated.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['core.js', 'panel.js'] });
      await chrome.tabs.sendMessage(tab.id, TOGGLE);
    } catch (e) {
      console.warn('ThumbCheck could not start on this tab:', e);
    }
    return;
  }

  // Not on YouTube: open it, and show the panel as soon as the page has loaded.
  const created = await chrome.tabs.create({ url: YOUTUBE });
  await chrome.storage.session.set({ openInTab: created.id });
}

chrome.action.onClicked.addListener(onClick);

// The panel's pictures and fonts. They are read here and handed to the panel,
// so the YouTube page itself never loads a file from the extension.
const ASSETS = ['img/wordmark.png', 'img/mr-oops.png', 'fonts/archivo-x125-800-900.woff2', 'fonts/dm-sans-400-700.woff2'];

async function readAsset(file) {
  const response = await fetch(chrome.runtime.getURL(file));
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  const type = file.endsWith('.png') ? 'image/png' : 'font/woff2';
  return 'data:' + type + ';base64,' + btoa(binary);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'thumbcheck:assets') {
    Promise.all(ASSETS.map(readAsset))
      .then(list => sendResponse({ assets: Object.fromEntries(ASSETS.map((file, i) => [file, list[i]])) }))
      .catch(() => sendResponse({ assets: {} }));
    return true; // the answer comes a moment later
  }
  if (!message || message.type !== 'thumbcheck:ready') return undefined;
  const tabId = sender.tab ? sender.tab.id : null;
  chrome.storage.session.get('openInTab').then(({ openInTab }) => {
    const open = tabId != null && openInTab === tabId;
    if (open) chrome.storage.session.remove('openInTab');
    sendResponse({ open });
  }).catch(() => sendResponse({ open: false }));
  return true; // the answer comes a moment later
});
