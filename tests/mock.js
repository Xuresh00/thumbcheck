// Builds a stand-in YouTube page with the same card markup the real site uses (captured live on 15 Nov 2026).
// One document holds three "pages" (Home, Search, Watch) so the test can switch between them like YouTube does.

const colors = ['#7a1f1f', '#1f4d7a', '#2f6b3a', '#6b2f6a', '#7a5a1f', '#1f6b6b', '#40407a', '#7a3f1f', '#2d2d2d', '#5a1f3f', '#1f3f5a', '#3f5a1f'];
const thumb = (i, label) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${colors[i % colors.length]}"/><text x="50%" y="54%" font-family="Arial" font-size="56" font-weight="700" fill="#fff" text-anchor="middle">${label}</text></svg>`);

const titles = [
  'I Tried Every Budget Laptop So You Do Not Have To', 'The Real Reason Old Games Looked Better', 'How This Tiny Shop Makes 400 Knives A Week',
  '10 Photoshop Tricks I Wish I Knew Sooner', 'Why Nobody Can Beat This Chess Opening', 'Building A Desk From One Sheet Of Plywood',
  'The Strange History Of The Loading Bar', 'We Drove 3,000 km In A 40 Year Old Van', 'A Day In The Life Of A Lighthouse Keeper',
  'Street Food Tour That Went Completely Wrong', 'The Maths Behind Every Rainbow', 'Restoring A Rusted Bike I Found In A River',
  'Is This The Best Camera Under 500', 'Tiny Cabin Build, Start To Finish', 'What Happens If You Never Stop Zooming'
];

function lockup(i, { compact = false, stack = false, list = false } = {}) {
  const id = 'vid' + String(i).padStart(4, '0');
  const href = `/watch?v=${id}` + (list ? '&list=RD' + id : '');
  return `<yt-lockup-view-model><div class="ytLockupViewModelHost ytLockupViewModelVertical content-id-${id}${compact ? ' ytLockupViewModelCompact' : ''}${stack ? ' ytLockupViewModelCollectionStack2' : ''}">
    <a class="ytLockupViewModelContentImage" href="${href}" aria-hidden="true"><yt-thumbnail-view-model>
      <div class="ytThumbnailViewModelImage"><img class="ytCoreImageHost ytCoreImageFillParentHeight ytCoreImageFillParentWidth" src="${thumb(i, stack ? 'MIX' : 'VIDEO ' + i)}"></div>
      <yt-thumbnail-bottom-overlay-view-model class="ytThumbnailBottomOverlayViewModelHost"><div class="ytThumbnailBottomOverlayViewModelBadgeContainer"><badge-shape class="ytBadgeShapeHost"><div class="ytBadgeShapeText">1${i % 10}:3${i % 10}</div></badge-shape></div></yt-thumbnail-bottom-overlay-view-model>
    </yt-thumbnail-view-model></a>
    <div class="ytLockupViewModelMetadata"><yt-lockup-metadata-view-model class="ytLockupMetadataViewModelHost">
      <div class="ytLockupMetadataViewModelAvatar"><div class="avatar"></div></div>
      <div class="ytLockupMetadataViewModelTextContainer">
        <h3 class="ytLockupMetadataViewModelHeadingReset"><a class="ytLockupMetadataViewModelTitle" href="${href}" aria-label="${titles[i % titles.length]}"><span class="ytAttributedStringHost ytAttributedStringWhiteSpacePreWrap" role="text">${titles[i % titles.length]}</span></a></h3>
        <div class="ytLockupMetadataViewModelMetadata"><div class="ytContentMetadataViewModelMetadataRow"><span class="meta">Channel ${i}</span></div><div class="ytContentMetadataViewModelMetadataRow"><span class="meta">${100 + i * 7}k views</span><span class="meta"> • ${i + 1} days ago</span></div></div>
      </div></yt-lockup-metadata-view-model></div>
  </div></yt-lockup-view-model>`;
}

const richItem = inner => `<ytd-rich-item-renderer class="style-scope ytd-rich-grid-renderer"><div id="content" class="style-scope ytd-rich-item-renderer">${inner}</div></ytd-rich-item-renderer>`;
const shortCard = i => richItem(`<ytm-shorts-lockup-view-model-v2><a href="/shorts/short${i}"><img class="short" src="${thumb(i, 'SHORT')}"></a><h3><a href="/shorts/short${i}"><span>Short number ${i}</span></a></h3></ytm-shorts-lockup-view-model-v2>`);
const adCard = i => richItem(`<ytd-ad-slot-renderer><a href="/watch?v=advert${i}"><img src="${thumb(i, 'AD')}"></a><h3><a href="/watch?v=advert${i}"><span>Sponsored thing ${i}</span></a></h3></ytd-ad-slot-renderer>`);

function searchItem(i) {
  const id = 'srch' + String(i).padStart(4, '0');
  return `<ytd-video-renderer><div id="dismissible" class="style-scope ytd-video-renderer">
    <ytd-thumbnail class="style-scope ytd-video-renderer"><a id="thumbnail" class="yt-simple-endpoint inline-block style-scope" href="/watch?v=${id}&pp=abc"><yt-image><img class="ytCoreImageHost ytCoreImageFillParentHeight ytCoreImageFillParentWidth" src="${thumb(i + 3, 'RESULT ' + i)}"></yt-image>
      <div id="overlays" class="style-scope ytd-thumbnail"><span class="badge">1${i}:0${i}</span></div></a></ytd-thumbnail>
    <div class="text-wrapper style-scope ytd-video-renderer"><div id="meta"><div id="title-wrapper"><h3 class="title-and-badge style-scope ytd-video-renderer">
      <a id="video-title" class="yt-simple-endpoint style-scope ytd-video-renderer" href="/watch?v=${id}&pp=abc" aria-label="${titles[(i + 5) % titles.length]}"><yt-icon id="inline-title-icon"></yt-icon><yt-formatted-string class="style-scope ytd-video-renderer">${titles[(i + 5) % titles.length]}</yt-formatted-string></a>
    </h3></div><div class="meta">${50 + i}k views • ${i + 2} months ago</div><div class="meta">Search Channel ${i}</div><div class="meta desc">A short description line for this search result, like the real page shows.</div></div></div>
  </div></ytd-video-renderer>`;
}

function page() {
  const home = [];
  for (let i = 0; i < 18; i++) {
    if (i === 4) home.push(adCard(i));
    else if (i === 7 || i === 8) home.push(shortCard(i));
    else if (i === 10) home.push(richItem(lockup(i, { stack: true, list: true })));
    else home.push(richItem(lockup(i)));
  }
  const search = Array.from({ length: 8 }, (_, i) => searchItem(i)).join('');
  const related = Array.from({ length: 10 }, (_, i) => lockup(i + 20, { compact: true, stack: i === 2, list: i === 2 })).join('');

  return `<!doctype html><html dark><head><meta charset="utf-8"><title>YouTube (stand-in)</title><style>
  html, body { margin: 0; background: #0f0f0f; color: #f1f1f1; font-family: Roboto, Arial, sans-serif; }
  [hidden] { display: none !important; }
  a { color: inherit; text-decoration: none; }
  #masthead-container { position: fixed; top: 0; left: 0; right: 0; height: 56px; background: #0f0f0f; z-index: 2020; display: flex; align-items: center; padding: 0 16px; font-weight: 700; }
  #guide { position: fixed; top: 56px; left: 0; bottom: 0; width: 240px; background: #0f0f0f; }
  ytd-browse, ytd-search, ytd-watch-flexy { display: block; margin: 56px 0 0 240px; }
  ytd-watch-flexy { margin-left: 0; padding: 24px; }
  #chips { position: sticky; top: 56px; height: 56px; background: #0f0f0f; z-index: 2000; display: flex; align-items: center; padding: 0 24px; gap: 12px; }
  #chips span { background: #272727; border-radius: 8px; padding: 6px 12px; font-size: 14px; }
  ytd-rich-grid-renderer { display: block; padding: 24px 16px; }
  ytd-rich-grid-renderer #contents { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 40px 16px; }
  ytd-rich-item-renderer, yt-lockup-view-model, ytd-video-renderer, ytm-shorts-lockup-view-model-v2, ytd-ad-slot-renderer { display: block; }
  .ytLockupViewModelHost { display: flex; flex-direction: column; }
  .ytLockupViewModelContentImage { display: block; }
  yt-thumbnail-view-model { display: block; position: relative; overflow: hidden; border-radius: 12px; aspect-ratio: 16 / 9; background: #222; }
  .ytThumbnailViewModelImage { position: absolute; inset: 0; }
  img.ytCoreImageHost { display: inline-block; width: 100%; height: 100%; object-fit: cover; }
  yt-thumbnail-bottom-overlay-view-model { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: flex-end; padding: 8px; }
  .ytBadgeShapeText, .badge { background: rgba(0,0,0,.8); color: #fff; font-size: 12px; font-weight: 500; padding: 1px 4px; border-radius: 4px; }
  .ytLockupViewModelMetadata { margin-top: 12px; }
  yt-lockup-metadata-view-model { display: flex; gap: 12px; }
  .avatar { width: 36px; height: 36px; border-radius: 50%; background: #444; }
  h3 { margin: 0; }
  .ytLockupMetadataViewModelTitle { display: flow-root; -webkit-line-clamp: 2; max-height: 44px; overflow: hidden; font: 500 16px/22px Roboto, Arial, sans-serif; color: #f1f1f1; }
  .ytAttributedStringWhiteSpacePreWrap { white-space: pre-wrap; }
  .meta { color: #aaa; font-size: 14px; line-height: 20px; }
  .ytLockupViewModelCompact { flex-direction: row; gap: 8px; margin-bottom: 8px; }
  .ytLockupViewModelCompact .ytLockupViewModelContentImage { width: 168px; flex: none; }
  .ytLockupViewModelCompact .ytLockupViewModelMetadata { margin-top: 0; }
  .ytLockupViewModelCompact .ytLockupMetadataViewModelAvatar { display: none; }
  .ytLockupViewModelCompact .ytLockupMetadataViewModelTitle { font: 500 14px/20px Roboto, Arial, sans-serif; max-height: 40px; }
  img.short { width: 100%; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 12px; }
  ytd-search { padding: 24px; }
  ytd-video-renderer #dismissible { display: flex; gap: 16px; margin-bottom: 16px; max-width: 1100px; }
  ytd-thumbnail { display: block; position: relative; width: 500px; flex: none; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 12px; }
  ytd-thumbnail a#thumbnail { display: block; position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
  yt-image { display: inline; }
  ytd-thumbnail #overlays { position: absolute; right: 8px; bottom: 8px; }
  a#video-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font: 400 18px/26px Roboto, Arial, sans-serif; }
  #columns { display: flex; gap: 24px; }
  #primary { flex: 1; }
  #player { aspect-ratio: 16 / 9; background: #000; border-radius: 12px; }
  #secondary { width: 402px; flex: none; }
  </style></head><body>
  <div id="masthead-container">YouTube (stand-in page for testing)<input id="search" placeholder="Search" style="margin-left:24px;width:360px;height:32px"></div>
  <div id="guide"></div>
  <ytd-browse page-subtype="home"><div id="chips"><span>All</span><span>Gaming</span><span>Music</span></div>
    <ytd-rich-grid-renderer><div id="contents">${home.join('')}</div></ytd-rich-grid-renderer></ytd-browse>
  <ytd-search hidden><ytd-item-section-renderer><div id="contents">${search}</div></ytd-item-section-renderer></ytd-search>
  <ytd-watch-flexy hidden><div id="columns"><div id="primary"><div id="player"></div><h1>Some video that is playing</h1></div>
    <div id="secondary"><div id="related"><ytd-watch-next-secondary-results-renderer><div id="items"><ytd-item-section-renderer><div id="contents">${related}</div></ytd-item-section-renderer></div></ytd-watch-next-secondary-results-renderer></div></div></div></ytd-watch-flexy>
  </body></html>`;
}

// The headers the real site sends (read from youtube.com on 15 Nov 2026), so the test runs under the same rules.
const CSP = "script-src 'unsafe-eval' 'self' 'unsafe-inline' https://www.google.com https://*.youtube.com https://www.youtube.com;report-uri https://csp.withgoogle.com/csp/youtube_main/allowlist, base-uri 'self';object-src 'none';script-src 'report-sample' 'nonce-4fdRcctBhOPj4kBuS0nGtg' 'unsafe-inline' 'strict-dynamic' https: http: 'unsafe-eval';report-uri https://csp.withgoogle.com/csp/youtube_main/strict, require-trusted-types-for 'script'";

module.exports = { page, CSP };
