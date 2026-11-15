/*
 * ThumbCheck by Stupidesigner
 * panel.js: the small panel you paste your title and thumbnail into.
 * It sits on top of the YouTube page and talks to core.js, which does the swap.
 */
(() => {
  'use strict';

  // If an older copy is still on the page (after an extension update), remove it first.
  const older = globalThis.ThumbCheckPanel;
  if (older && typeof older.destroy === 'function') {
    try { older.destroy(); } catch (e) { /* older copy is gone already */ }
  }

  const core = globalThis.ThumbCheckCore;
  if (!core) return;

  const ext = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ? chrome : null;
  const SITE = 'https://stupidesigner.com/';
  const MAX_WIDTH = 1280; // the size YouTube asks for (1280 x 720)
  const PASTE_KEY = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘V' : 'Ctrl+V';

  const TEXT = {
    idle: 'Paste a thumbnail and a title, then hit Check.',
    ready: 'Ready. Hit Check to drop it into the feed.',
    placed: 'It is in the feed now. Shuffle moves it to a new spot.',
    waiting: 'No videos on this page. It comes back on the next page that has them.',
    scrolled: 'It is in the feed now. The page scrolled to it.',
    updated: 'Updated in the same spot.',
    removed: 'Removed. The page is back to normal.',
    noImage: 'Add a thumbnail first.',
    noVideos: 'No videos to swap on this page. Open Home, Search or a video, then hit Check.',
    notImage: 'That is not an image. Use a JPG or PNG.',
    unreadable: 'Could not read that image. Try a JPG or PNG.',
    cropped: 'This image is not 16:9, so it is cropped to fit.'
  };

  const state = { open: false, mini: false, image: '', title: '', note: '' };
  const cleanups = [];
  const fontFaces = [];
  let host = null;
  let root = null;
  let ui = null;
  let saveTimer = 0;
  let noteTimer = 0;

  const CSS = [
    ':host { all: initial; }',
    '*, *::before, *::after { box-sizing: border-box; }',
    '[hidden] { display: none !important; }',
    '.wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;',
    '  font: 400 15px/1.45 "ThumbCheck Text", "DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;',
    '  color: #F5F1E9; -webkit-font-smoothing: antialiased; text-align: left; }',
    '.wrap.left { right: auto; left: 20px; }',
    '.panel { width: 320px; max-height: calc(100vh - 40px); overflow: auto; display: grid; gap: 14px; padding: 20px;',
    '  background: #161513; border: 1px solid rgba(245,241,233,.12); border-radius: 24px;',
    '  box-shadow: 0 24px 48px -24px rgba(0,0,0,.5); }',
    '.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }',
    '.name { margin: 0; color: #F5F1E9; letter-spacing: -0.01em;',
    '  font: 900 22px/1 "ThumbCheck Display", "Archivo Black", "Arial Black", system-ui, sans-serif; }',
    '.by { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; color: #B5AFA4; font-size: 14px;',
    '  line-height: 1; text-decoration: none; border-radius: 8px; }',
    '.by img { display: block; height: 24px; width: auto; color: #F5F1E9; font-weight: 700; }',
    '.tools { display: flex; gap: 2px; margin: -8px -10px 0 0; }',
    '.icon { width: 36px; height: 36px; padding: 0; border: 0; border-radius: 999px; background: transparent;',
    '  color: #B5AFA4; display: grid; place-items: center; cursor: pointer; transition: background-color .2s, color .2s; }',
    '.icon:hover { background: #201E1B; color: #F5F1E9; }',
    '.drop { position: relative; display: grid; place-items: center; width: 100%; aspect-ratio: 16 / 9; padding: 0;',
    '  overflow: hidden; border-radius: 16px; border: 1.5px dashed rgba(245,241,233,.28); background: #201E1B;',
    '  color: #B5AFA4; font: inherit; text-align: center; cursor: pointer; transition: border-color .2s, color .2s; }',
    '.drop:hover, .drop.over { border-color: #FDA501; color: #F5F1E9; }',
    '.drop.has { border: 1px solid rgba(245,241,233,.12); }',
    '.drop.has.over { border-color: #FDA501; }',
    '.preview { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }',
    '.hint { display: grid; gap: 6px; justify-items: center; padding: 12px; font-size: 14px; line-height: 1.3; }',
    '.hint strong { font-weight: 700; font-size: 15px; color: #F5F1E9; }',
    '.swap { position: absolute; right: 8px; bottom: 8px; padding: 5px 9px; border-radius: 8px; background: #0B0B0B;',
    '  color: #F5F1E9; font-size: 14px; line-height: 1; opacity: 0; transition: opacity .2s; }',
    '.drop.has:hover .swap, .drop.has:focus-visible .swap { opacity: 1; }',
    '.title { display: block; width: 100%; min-height: 66px; max-height: 108px; field-sizing: content; resize: none;',
    '  padding: 11px 12px; border-radius: 8px; border: 1px solid rgba(245,241,233,.12); background: #201E1B;',
    '  color: #F5F1E9; font: inherit; line-height: 1.4; outline: none; scrollbar-width: thin;',
    '  scrollbar-color: #5E5951 transparent; transition: border-color .2s, box-shadow .2s; }',
    '.title:focus { border-color: #FDA501; box-shadow: 0 0 0 1px #FDA501; }',
    '.title::placeholder { color: #948E84; opacity: 1; }',
    '.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 20px;',
    '  border: 0; border-radius: 999px; font: inherit; font-weight: 700; line-height: 1.1; cursor: pointer;',
    '  white-space: nowrap; transition: background-color .2s, color .2s, transform .2s; }',
    '.btn:active { transform: scale(.98); }',
    '.primary { width: 100%; min-height: 48px; font-size: 16px; background: #FDA501; color: #0B0B0B; }',
    '.primary:hover { background: #FFB52E; transform: translateY(-1px); }',
    '.secondary { background: transparent; color: #F5F1E9; box-shadow: inset 0 0 0 1.5px currentColor; }',
    '.secondary:hover { background: rgba(245,241,233,.09); }',
    '.btn:disabled { background: #201E1B; color: #948E84; box-shadow: none; cursor: default; transform: none; }',
    '.actions { display: grid; gap: 8px; }',
    '.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }',
    '.status { margin: 0; min-height: 40px; color: #B5AFA4; font-size: 14px; line-height: 1.4; }',
    '.pill { width: 56px; height: 56px; padding: 0; display: grid; place-items: center; cursor: pointer;',
    '  background: #161513; border: 1px solid rgba(245,241,233,.12); border-radius: 999px;',
    '  box-shadow: 0 24px 48px -24px rgba(0,0,0,.5); transition: transform .2s; }',
    '.pill:hover { transform: translateY(-1px); }',
    '.pill img { display: block; height: 40px; width: auto; }',
    '.icon:focus-visible, .drop:focus-visible, .btn:focus-visible, .pill:focus-visible,',
    '.by:focus-visible { outline: 3px solid #FDA501; outline-offset: 3px; }',
    '@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }'
  ].join('\n');

  // ---------- small helpers ----------

  function listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener(type, fn, options));
  }

  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === false || value == null) continue;
      if (key === 'class') node.className = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const kid of kids) if (kid != null) node.append(kid);
    return node;
  }

  function icon(d, size) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    const set = { viewBox: '0 0 24 24', width: size || 20, height: size || 20, fill: 'none', stroke: 'currentColor',
      'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
    for (const [key, value] of Object.entries(set)) svg.setAttribute(key, value);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  // The pictures and fonts that ship with the extension. The background script reads them and hands
  // them over, so the YouTube page itself never has to load a file from the extension.
  let assets = null;
  function getAssets() {
    if (!assets) {
      assets = new Promise(resolve => {
        if (!ext) { resolve(globalThis.__thumbcheckAssets || {}); return; } // only when testing outside the extension
        try {
          ext.runtime.sendMessage({ type: 'thumbcheck:assets' }, reply => {
            void ext.runtime.lastError;
            resolve((reply && reply.assets) || {});
          });
        } catch (e) {
          resolve({});
        }
      });
    }
    return assets;
  }

  async function loadAsset(img, path) {
    const all = await getAssets();
    if (all[path]) img.src = all[path];
  }

  // The brand fonts. If one fails to load, the system font takes over.
  async function loadFonts() {
    const wanted = [
      ['ThumbCheck Display', 'fonts/archivo-x125-800-900.woff2', '800 900'],
      ['ThumbCheck Text', 'fonts/dm-sans-400-700.woff2', '400 700']
    ];
    const all = await getAssets();
    for (const [family, path, weight] of wanted) {
      const data = all[path];
      if (!data) continue;
      try {
        const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), ch => ch.charCodeAt(0));
        const face = new FontFace(family, bytes.buffer, { weight });
        await face.load();
        document.fonts.add(face);
        fontFaces.push(face);
      } catch (e) { /* system font */ }
    }
  }

  function save(values) {
    if (!ext) return;
    try { ext.storage.local.set(values).catch(() => {}); } catch (e) { /* extension was reloaded */ }
  }

  // ---------- the panel ----------

  function build() {
    host = document.createElement('div');
    host.id = 'thumbcheck-root';
    root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;

    const wordmark = h('img', { alt: 'Stupidesigner' });
    const by = h('a', { class: 'by', href: SITE, target: '_blank', rel: 'noopener noreferrer', title: 'Open stupidesigner.com' },
      h('span', null, 'by'), wordmark);
    const minimise = h('button', { class: 'icon', type: 'button', title: 'Minimise', 'aria-label': 'Minimise ThumbCheck' }, icon('M5 12h14'));
    const hide = h('button', { class: 'icon', type: 'button', title: 'Hide', 'aria-label': 'Hide ThumbCheck' }, icon('M6 6l12 12M18 6L6 18'));
    const head = h('div', { class: 'head' },
      h('div', null, h('h2', { class: 'name' }, 'ThumbCheck'), by),
      h('div', { class: 'tools' }, minimise, hide));

    const preview = h('img', { class: 'preview', alt: 'Your thumbnail', hidden: true });
    const hint = h('span', { class: 'hint' },
      icon('M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z M4 15.5l4.2-4.2a1.5 1.5 0 0 1 2.1 0L16 17 M13.5 14.5l1.7-1.7a1.5 1.5 0 0 1 2.1 0L20 15.5 M15 8.5h.01', 28),
      h('strong', null, 'Paste your thumbnail'),
      h('span', null, PASTE_KEY + ', drop a file, or click to choose'));
    const drop = h('button', { class: 'drop', type: 'button', 'aria-label': 'Thumbnail. Paste, drop a file, or click to choose one.' },
      preview, hint, h('span', { class: 'swap' }, 'Replace'));
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, tabindex: '-1' });

    const title = h('textarea', { class: 'title', rows: '2', placeholder: 'Paste your title', 'aria-label': 'Video title', spellcheck: 'false' });

    const check = h('button', { class: 'btn primary', type: 'button' }, 'Check');
    const shuffle = h('button', { class: 'btn secondary', type: 'button', title: 'Move it to another random spot' }, 'Shuffle');
    const reset = h('button', { class: 'btn secondary', type: 'button', title: 'Take it off the page' }, 'Reset');
    const actions = h('div', { class: 'actions' }, check, h('div', { class: 'pair' }, shuffle, reset));

    const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });

    const panel = h('section', { class: 'panel', 'aria-label': 'ThumbCheck by Stupidesigner' }, head, drop, file, title, actions, status);

    const mascot = h('img', { alt: '' });
    const pill = h('button', { class: 'pill', type: 'button', title: 'ThumbCheck by Stupidesigner', 'aria-label': 'Open ThumbCheck', hidden: true }, mascot);

    const wrap = h('div', { class: 'wrap' }, panel, pill);
    root.append(style, wrap);
    ui = { wrap, panel, pill, drop, preview, hint, file, title, check, shuffle, reset, status };

    minimise.addEventListener('click', () => { state.mini = true; render(); });
    hide.addEventListener('click', () => { state.open = false; render(); });
    pill.addEventListener('click', () => { state.mini = false; render(); });
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const picked = file.files && file.files[0];
      file.value = '';
      if (picked) takeFile(picked);
    });
    title.addEventListener('input', () => {
      const clean = title.value.replace(/[\r\n]+/g, ' ');
      if (clean !== title.value) title.value = clean;
      setTitle(clean, true);
    });
    check.addEventListener('click', place);
    shuffle.addEventListener('click', place);
    reset.addEventListener('click', () => { core.clear(); say(TEXT.removed); });

    (document.body || document.documentElement).appendChild(host);
    loadAsset(wordmark, 'img/wordmark.png');
    loadAsset(mascot, 'img/mr-oops.png');
    loadFonts();
  }

  // Beside a video the Up next list is on the right, so the panel sits on the left and does not cover it.
  function side() {
    if (ui) ui.wrap.classList.toggle('left', location.pathname.startsWith('/watch'));
  }

  function render() {
    if (!host) {
      if (!state.open) return;
      build();
    }
    side();
    host.style.setProperty('display', state.open ? 'block' : 'none', 'important');
    ui.panel.hidden = state.mini;
    ui.pill.hidden = !state.mini;

    const has = !!state.image;
    ui.drop.classList.toggle('has', has);
    ui.preview.hidden = !has;
    ui.hint.hidden = has;
    if (has && ui.preview.getAttribute('src') !== state.image) ui.preview.src = state.image;
    if (!has) ui.preview.removeAttribute('src');

    if (root.activeElement !== ui.title && ui.title.value !== state.title) ui.title.value = state.title;

    const active = core.isActive();
    ui.check.disabled = !has;
    ui.shuffle.disabled = !active;
    ui.reset.disabled = !active;
    const resting = active ? (core.isPlaced() ? TEXT.placed : TEXT.waiting) : has ? TEXT.ready : TEXT.idle;
    ui.status.textContent = state.note || resting;
  }

  // ---------- actions ----------

  // Shows a short message under the buttons. It clears itself after a few seconds.
  function say(text) {
    state.note = text || '';
    clearTimeout(noteTimer);
    if (state.note) noteTimer = setTimeout(() => { state.note = ''; render(); }, 6000);
    render();
  }

  function place() {
    if (!state.image) { say(TEXT.noImage); return; }
    const result = core.place(state.image, state.title);
    say(result.ok ? (result.scrolled ? TEXT.scrolled : '') : TEXT.noVideos);
  }

  function setTitle(text, typing) {
    state.title = text;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save({ tc_title: state.title }), 400);
    if (core.isActive()) core.update(state.image, state.title);
    if (!typing) say(core.isActive() ? TEXT.updated : '');
  }

  // Shrinks the image to YouTube's size and keeps it for next time.
  async function takeFile(blob) {
    if (!blob || !/^image\//.test(blob.type)) { say(TEXT.notImage); return; }
    let bitmap;
    try { bitmap = await createImageBitmap(blob); } catch (e) { say(TEXT.unreadable); return; }
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const offRatio = Math.abs(bitmap.width / bitmap.height - 16 / 9) > 0.03;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();

    state.image = canvas.toDataURL('image/jpeg', 0.92);
    save({ tc_image: state.image });
    const moved = core.isActive() && core.update(state.image, state.title);
    say(offRatio ? TEXT.cropped : (moved ? TEXT.updated : ''));
  }

  function toggle() {
    if (!state.open) { state.open = true; state.mini = false; }
    else if (state.mini) state.mini = false;
    else state.open = false;
    say('');
    if (state.open && !state.mini && ui) ui.title.focus({ preventScroll: true });
  }

  function show() {
    state.open = true;
    state.mini = false;
    render();
  }

  // ---------- page-wide listeners (only do something while ThumbCheck is open) ----------

  const isImage = f => /^image\//.test(f.type);
  const hasFiles = e => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  // Cmd+V anywhere on the page: an image becomes the thumbnail, text becomes the title.
  listen(document, 'paste', e => {
    if (!state.open || !ui || !e.clipboardData) return;
    const image = Array.from(e.clipboardData.files || []).find(isImage);
    if (image) { e.preventDefault(); e.stopPropagation(); takeFile(image); return; }

    const path = e.composedPath();
    const target = path[0];
    if (target === ui.title) return; // normal paste into the title box
    const editable = target && target.nodeType === 1 &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (editable) return; // you are pasting into YouTube's own box, like search or a comment

    const text = (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    e.preventDefault();
    setTitle(text, false);
  }, true);

  // Drop an image anywhere on the page. Without this, a missed drop would open the file in the tab.
  listen(document, 'dragover', e => {
    if (!state.open || !ui || !hasFiles(e)) return;
    e.preventDefault();
    ui.drop.classList.add('over');
  }, true);
  listen(document, 'dragleave', e => {
    if (ui && !e.relatedTarget) ui.drop.classList.remove('over');
  }, true);
  listen(document, 'drop', e => {
    if (!state.open || !ui || !hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    ui.drop.classList.remove('over');
    const image = Array.from(e.dataTransfer.files || []).find(isImage);
    if (image) takeFile(image);
    else say(TEXT.notImage);
  }, true);

  // YouTube tells the page when you have moved to another screen.
  listen(document, 'yt-navigate-finish', side);

  // YouTube has one-key shortcuts (k, m, f, space and more). They must not fire while you type in the panel.
  function onKey(e) {
    if (!host || !ui || !e.composedPath().includes(host)) return;
    e.stopImmediatePropagation();
    if (e.type !== 'keydown' || e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey && e.composedPath()[0] === ui.title) {
      e.preventDefault(); // a title is one line
      if (!core.isActive()) place(); // once it is on the page, typing already updates it where it is
    } else if (e.key === 'Escape') {
      state.mini = true;
      render();
    }
  }
  for (const type of ['keydown', 'keypress', 'keyup']) listen(window, type, onKey, true);

  // ---------- extension wiring ----------

  function onMessage(message, sender, sendResponse) {
    if (!message || message.type !== 'thumbcheck:toggle') return;
    toggle();
    sendResponse({ ok: true });
  }

  function destroy() {
    for (const undo of cleanups.splice(0)) { try { undo(); } catch (e) { /* already gone */ } }
    clearTimeout(saveTimer);
    clearTimeout(noteTimer);
    try { core.clear(); } catch (e) { /* already gone */ }
    if (host) host.remove();
    for (const face of fontFaces.splice(0)) { try { document.fonts.delete(face); } catch (e) { /* already gone */ } }
    host = null;
    root = null;
    ui = null;
  }

  globalThis.ThumbCheckPanel = { toggle, show, destroy };

  // Keep the message under the buttons true when the preview goes on or off the page by itself.
  core.watch(() => { if (host) render(); });
  cleanups.push(() => core.watch(null));

  if (ext) {
    ext.runtime.onMessage.addListener(onMessage);
    cleanups.push(() => { try { ext.runtime.onMessage.removeListener(onMessage); } catch (e) { /* extension was reloaded */ } });

    // Bring back the last title and thumbnail.
    ext.storage.local.get(['tc_title', 'tc_image']).then(saved => {
      if (!state.title && typeof saved.tc_title === 'string') state.title = saved.tc_title;
      if (!state.image && typeof saved.tc_image === 'string') state.image = saved.tc_image;
      if (host) render();
    }).catch(() => {});

    // When the toolbar button opened YouTube for you, the panel opens by itself.
    try {
      ext.runtime.sendMessage({ type: 'thumbcheck:ready' }, reply => {
        void ext.runtime.lastError;
        if (reply && reply.open) show();
      });
    } catch (e) { /* extension was reloaded */ }
  }
})();
