/*
 * ThumbCheck by Stupidesigner
 * core.js: finds the real video cards on a YouTube page and swaps one of them
 * for your thumbnail and title. Nothing is uploaded anywhere. The page only
 * changes on your own screen, and Reset (or a page reload) puts it back.
 */
(() => {
  'use strict';

  // If an older copy is still on the page (after an extension update), undo its work first.
  const before = globalThis.ThumbCheckCore;
  if (before && typeof before.clear === 'function') {
    try { before.clear(); } catch (e) { /* older copy is gone already */ }
  }

  const MARK = 'data-thumbcheck';
  const STYLE_ID = 'thumbcheck-page-style';

  // Every kind of video card YouTube uses right now (checked on 15 Nov 2026) plus the older ones.
  const CARD = [
    'ytd-rich-item-renderer',     // Home and Subscriptions grid
    'ytd-video-renderer',         // Search results
    'yt-lockup-view-model',       // new card, used on Home and next to a video
    'ytd-compact-video-renderer', // older "up next" card
    'ytd-grid-video-renderer'     // older grids
  ].join(',');

  const ADS = [
    'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-promoted-video-renderer',
    'ytd-display-ad-renderer', 'ytd-promoted-sparkles-web-renderer', 'ytd-search-pyv-renderer'
  ].join(',');

  // Mixes and playlists have a stacked look, so a single thumbnail would look wrong there.
  const STACKS = '[class*="CollectionStack"], ytd-playlist-thumbnail, ytd-thumbnail-overlay-bottom-panel-renderer';

  let want = null;      // the preview you asked for: { src, title }
  let live = null;      // the swap that is on the page right now
  let lastCard = null;  // so Shuffle never lands on the same card twice in a row
  let lastCount = -1;   // how many usable videos the page had on the previous look
  let timer = 0;
  let listener = null;  // the panel asks to be told when the preview goes on or off the page

  function changed() {
    if (typeof listener !== 'function') return;
    try { listener(); } catch (e) { /* the panel is gone */ }
  }

  function ensurePageStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      // The swapped card is a picture, not a link: no hover preview of the old video, no clicks.
      '[' + MARK + '], [' + MARK + '] * { pointer-events: none !important; }',
      'img[data-thumbcheck-img] { position: absolute !important; top: 0 !important; left: 0 !important;',
      '  width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important;',
      '  object-fit: cover !important; display: block !important; margin: 0 !important; padding: 0 !important;',
      '  border: 0 !important; border-radius: inherit; opacity: 1 !important; visibility: visible !important;',
      '  background: #000; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function cards() {
    const found = Array.from(document.querySelectorAll(CARD));
    // Home wraps the new card inside a grid item. Keep the outer one only.
    return found.filter(el => !(el.parentElement && el.parentElement.closest(CARD)));
  }

  // Works out which pieces of a card to change. Returns null when the card is not a normal video.
  function partsOf(card) {
    if (!card || !card.isConnected || card.hasAttribute(MARK)) return null;
    if (card.closest(ADS) || card.querySelector(ADS)) return null;
    if (card.querySelector(STACKS)) return null;

    let link = null;
    let img = null;
    for (const a of card.querySelectorAll('a[href*="/watch?v="]')) {
      const i = a.querySelector('img');
      if (i) { link = a; img = i; break; }
    }
    if (!link) return null; // Shorts, ads, channels and anything else without a normal video link
    if (/[?&]list=/.test(link.getAttribute('href') || '')) return null;

    const box = thumbBox(img, link);
    if (!box) return null; // hidden or not drawn yet

    const titleLink = card.querySelector('h3 a[href*="/watch"], a#video-title, a#video-title-link, #video-title');
    if (!titleLink) return null;

    return { card, box, img, titleLink };
  }

  // The element that has the size of the thumbnail. Usually the image's parent. On Search the
  // parent is a thin inline wrapper, so the real box is one level up (the thumbnail link).
  function thumbBox(img, link) {
    for (let el = img.parentElement; el; el = el.parentElement) {
      const rect = el.getBoundingClientRect();
      const display = getComputedStyle(el).display;
      if (rect.width >= 90 && rect.height >= 50 && display !== 'inline' && display !== 'contents') return el;
      if (el === link) break;
    }
    return null;
  }

  function usable() {
    return cards().map(partsOf).filter(Boolean);
  }

  // The element that holds the title text, so it can be hidden without touching YouTube's own text.
  function titleHolder(titleLink) {
    const withText = Array.from(titleLink.querySelectorAll('span, yt-formatted-string'))
      .filter(el => el.textContent.trim());
    return withText.find(el => !withText.some(other => other !== el && other.contains(el))) || null;
  }

  function hits(card, x, y) {
    const el = document.elementFromPoint(x, y);
    return !!el && (el === card || card.contains(el));
  }

  // 2 = whole thumbnail on screen and not covered, 1 = middle of it on screen, 0 = off screen or covered.
  function visibility(p) {
    const r = p.box.getBoundingClientRect();
    const pad = 6;
    const xs = [r.left + pad, r.left + r.width / 2, r.right - pad];
    const ys = [r.top + pad, r.top + r.height / 2, r.bottom - pad];
    const inside = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
    if (inside && xs.every(x => ys.every(y => hits(p.card, x, y)))) return 2;
    return hits(p.card, xs[1], ys[1]) ? 1 : 0;
  }

  function distanceFromMiddle(p) {
    const r = p.box.getBoundingClientRect();
    return Math.abs(r.top + r.height / 2 - window.innerHeight / 2);
  }

  // Picks a random normal video, from the ones you can see right now when there are any.
  function choose() {
    const all = usable();
    if (!all.length) return null;
    const fresh = all.filter(p => p.card !== lastCard);
    const pool = (fresh.length ? fresh : all).map(p => ({ p, seen: visibility(p) }));

    let best = pool.filter(s => s.seen === 2);
    if (!best.length) best = pool.filter(s => s.seen === 1);
    if (!best.length) {
      best = pool.slice().sort((a, b) => distanceFromMiddle(a.p) - distanceFromMiddle(b.p)).slice(0, 4);
    }
    return best[Math.floor(Math.random() * best.length)];
  }

  // Remembers one inline style of an element and returns a function that puts it back exactly.
  function remember(el, property) {
    const hadAttribute = el.hasAttribute('style');
    const value = el.style.getPropertyValue(property);
    const priority = el.style.getPropertyPriority(property);
    return () => {
      if (value) el.style.setProperty(property, value, priority);
      else el.style.removeProperty(property);
      if (!hadAttribute && !el.getAttribute('style')) el.removeAttribute('style');
    };
  }

  function apply(p, src, title) {
    const undo = [];

    // Thumbnail: ours sits on top of the original, inside the same rounded box,
    // so the duration badge and YouTube's own layout stay exactly as they are.
    const pic = document.createElement('img');
    pic.setAttribute('data-thumbcheck-img', '');
    pic.alt = '';
    pic.draggable = false;
    pic.src = src;
    if (getComputedStyle(p.box).position === 'static') {
      const restore = remember(p.box, 'position');
      p.box.style.position = 'relative';
      undo.push(restore);
    }
    // Goes right after the original picture, so anything YouTube draws on top (the duration) stays on top.
    let original = p.img;
    while (original.parentElement && original.parentElement !== p.box) original = original.parentElement;
    original.after(pic);
    undo.push(() => pic.remove());

    // Title: hide YouTube's text and put ours next to it, with the same look.
    let label = null;
    let holder = null;
    if (title) {
      holder = titleHolder(p.titleLink);
      if (holder) {
        label = document.createElement('span');
        label.className = holder.className;
        label.setAttribute('data-thumbcheck-title', '');
        label.textContent = title;
        const restore = remember(holder, 'display');
        holder.style.setProperty('display', 'none', 'important');
        holder.after(label);
        undo.push(() => { label.remove(); restore(); });
      } else {
        const oldText = p.titleLink.textContent;
        p.titleLink.textContent = title;
        undo.push(() => { p.titleLink.textContent = oldText; });
      }
    }

    p.card.setAttribute(MARK, '');
    undo.push(() => p.card.removeAttribute(MARK));

    live = { card: p.card, pic, label, holder, undo };
    changed();
  }

  function removeLive() {
    if (!live) return;
    const steps = live.undo.slice().reverse();
    live = null;
    for (const step of steps) {
      try { step(); } catch (e) { /* the card is gone, nothing to undo */ }
    }
    changed();
  }

  function intact() {
    if (!live) return false;
    const { card, pic, label, holder } = live;
    if (!card.isConnected || !card.contains(pic)) return false;
    if (card.getBoundingClientRect().width === 0) return false; // you moved to another page
    if (label && (!card.contains(label) || !holder.isConnected || holder.style.display !== 'none')) return false;
    return true;
  }

  // Runs while a preview is wanted. If YouTube redraws the card, or you move to
  // another page, the preview is put back as soon as the page has videos again.
  function tick() {
    if (!want) { stop(); return; }
    if (intact()) return;

    const card = live ? live.card : null;
    removeLive();

    const same = card ? partsOf(card) : null;
    if (same) { apply(same, want.src, want.title); return; }

    const count = usable().length;
    const settled = count > 0 && count === lastCount; // wait until the page has stopped adding videos
    lastCount = count;
    if (!settled) return;

    const pick = choose();
    if (pick) { apply(pick.p, want.src, want.title); lastCard = pick.p.card; }
  }

  function start() {
    if (!timer) timer = setInterval(tick, 700);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = 0; }
  }

  // Puts the preview on a random video. Calling it again moves it to a different one.
  function place(src, title) {
    removeLive();
    if (!src) { want = null; stop(); return { ok: false, reason: 'no-image' }; }
    ensurePageStyle();
    const pick = choose();
    if (!pick) { want = null; stop(); return { ok: false, reason: 'no-videos' }; }
    want = { src, title: String(title || '').trim() };
    apply(pick.p, want.src, want.title);
    lastCard = pick.p.card;
    lastCount = -1;
    const scrolled = pick.seen < 2;
    if (scrolled) pick.p.card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    start();
    return { ok: true, scrolled };
  }

  // Changes the picture or the title of the preview without moving it.
  function update(src, title) {
    if (!want || !src) return false;
    want = { src, title: String(title || '').trim() };
    if (live) {
      const card = live.card;
      removeLive();
      const p = partsOf(card);
      if (p) apply(p, want.src, want.title);
    }
    return true;
  }

  // Takes the preview off the page and puts the original video back.
  function clear() {
    want = null;
    stop();
    removeLive();
  }

  globalThis.ThumbCheckCore = {
    place,
    update,
    clear,
    isActive: () => !!want,   // a preview is switched on
    isPlaced: () => !!live,   // and it is on the page right now
    watch: fn => { listener = fn; },
    count: () => usable().length
  };
})();
