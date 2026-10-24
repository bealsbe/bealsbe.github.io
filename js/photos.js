'use strict';

/* Photography page: sections -> albums (one per folder) -> justified photo grid + full-screen viewer.
   Reads PHOTO_SECTIONS / PHOTO_ALBUMS / PHOTO_FEATURED from the bucket manifest loaded by
   js/photos-source.js, which also provides the PHOTO_DATA_READY promise.
   Routing lives in the hash:  #<album>   opens an album,  #<album>/<photo>  opens the viewer. */
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse       = window.matchMedia('(hover: none) and (pointer: coarse)');
  let albumById      = new Map();  // rebuilt in init() once the data source has settled
  const sectionName  = id => (PHOTO_SECTIONS.find(c => c.id === id) || {}).name || id;
  const esc          = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp        = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmtDate      = (d, opts) => { try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, opts || { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return d; } };
  const coverOf      = a => a.photos.find(p => p.id === a.cover) || a.photos[0];
  const looksLikeFilename = t => /^[A-Za-z]{0,5}\d{3,}[A-Za-z]{0,2}$/.test(String(t || '').replace(/[\s_-]+/g, ''));
  const photoLabel   = (p, album, i) => p.title || (album ? `${album.name}${i >= 0 ? ` · ${i + 1}` : ''}` : '');
  const gridPhotos   = a => a.photos.filter(p => p.id !== '_cover'); // a cover.jpg is banner-only

  /* ======================= Page: sections, album list, album grid ======================= */
  const GAP = 8;
  let root = null, filtersEl = null, viewEl = null, featuredEl = null, grid = null, ro = null;
  let section = null;
  let currentAlbum = null;   // album object while inside one, else null
  let shown = [];            // photos in the open album, in grid order

  function targetRowHeight(width) {
    return width < 500 ? 150 : width < 800 ? 190 : 230;
  }

  // Justified rows: split the tiles into rows so that every row fills the width exactly and row
  // heights stay as close to the target as possible (a linear partition over the tiles, so the
  // last row is as full as any other). Only an album with too few photos to fill a row at a sane
  // height falls back to a short, left-aligned last row.
  function layout() {
    if (!grid || !grid.isConnected) return;
    // Fractional width floored: clientWidth rounds up, and a row a hair wider than the real box
    // wraps its last tile to the next line (seen at 125% display scaling)
    const width = Math.floor(grid.getBoundingClientRect().width);
    if (!width) return;
    const target = targetRowHeight(width);
    const tiles = Array.from(grid.children).filter(el => el.classList.contains('photo-tile'));
    const n = tiles.length;
    if (!n) return;
    const ratios = tiles.map(t => { const r = Number(t.dataset.ratio); return r > 0.1 && r < 10 ? r : 1.5; });
    const rowHeight = (count, ratioSum) => (width - GAP * (count - 1)) / ratioSum;
    const minH = target * 0.5, maxH = target * 1.6;

    // Sizes one row of tiles [from, to) at height h; the last tile absorbs the rounding so the
    // widths add up to the grid width exactly (unless the row is deliberately left ragged)
    const place = (from, to, h, ragged) => {
      let used = 0;
      for (let k = from; k < to; k++) {
        const isLast = k === to - 1 && !ragged;
        const w = isLast ? width - GAP * (to - from - 1) - used : Math.floor(ratios[k] * h);
        used += w;
        tiles[k].style.width = w + 'px';
        tiles[k].style.height = h.toFixed(2) + 'px';
      }
    };

    // best[j] = lowest total deviation for the first j tiles; prev[j] = where that last row starts
    const best = new Float64Array(n + 1).fill(Infinity);
    const prev = new Int32Array(n + 1).fill(-1);
    best[0] = 0;
    for (let j = 1; j <= n; j++) {
      let sum = 0;
      for (let i = j - 1; i >= 0; i--) {
        sum += ratios[i];
        const h = rowHeight(j - i, sum);
        if (h < minH) break;                       // more tiles only make the row shorter
        if (h > maxH || best[i] === Infinity) continue;
        const d = (h - target) / target;
        const cost = best[i] + d * d;
        if (cost < best[j]) { best[j] = cost; prev[j] = i; }
      }
    }

    if (best[n] < Infinity) {
      for (let j = n; j > 0; j = prev[j]) {
        const i = prev[j];
        let sum = 0;
        for (let k = i; k < j; k++) sum += ratios[k];
        place(i, j, rowHeight(j - i, sum), false);
      }
      return;
    }

    // Fallback (very small albums): greedy rows, last one short and left-aligned
    let start = 0, sum = 0;
    for (let k = 0; k < n; k++) {
      sum += ratios[k];
      if (rowHeight(k - start + 1, sum) <= target) { place(start, k + 1, rowHeight(k - start + 1, sum), false); start = k + 1; sum = 0; }
    }
    if (start < n) place(start, n, Math.min(rowHeight(n - start, sum), target * 1.15), true);
  }

  const albumMeta = a => [
    a.date && fmtDate(a.date, { year: 'numeric', month: 'short' }),
    a.location,
    `${gridPhotos(a).length} photo${gridPhotos(a).length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');

  // Album cards are small enough for the thumbnail; the hero banner spans the whole card, so it
  // gets the full image with the thumbnail as a placeholder until it arrives
  function bannerHTML(a, tag, full = false) {
    const c = coverOf(a);
    const bg = full ? ` style="background-image: url('${esc(c.thumb)}')"` : '';
    return `
      <img class="album-cover${full ? ' album-cover--full' : ''}" src="${esc(full ? c.src : c.thumb)}" alt="" width="${esc(Number(c.w) || 0)}" height="${esc(Number(c.h) || 0)}" loading="${full ? 'eager' : 'lazy'}" decoding="async"${bg} data-focus-src="${esc(c.thumb)}"${c.focus ? ` data-focus="${esc(c.focus.x)},${esc(c.focus.y)}"` : ''}>
      <div class="album-text">
        <${tag} class="album-name">${esc(a.name)}</${tag}>
        <p class="album-meta">${esc(albumMeta(a))}</p>
      </div>`;
  }

  /* --- Cover focus: keep the subject in view when a cover is cropped to the banner or card shape.
     The manifest may give a focus point per photo (0..1, from the manager app). Otherwise a tiny
     saliency pass over the thumbnail measures where the detail and colour are, per row and column,
     and the crop window with the most of it wins. Needs CORS on the bucket for pixel access;
     without it the crop stays centred. --- */
  const focusCache = new Map();   // thumb URL -> Promise<{ rows, cols } | null>

  function analyseCover(url) {
    if (focusCache.has(url)) return focusCache.get(url);
    const job = new Promise(resolve => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.decoding = 'async';
      im.onload = () => {
        try {
          const W = 64, H = Math.max(8, Math.round(W * im.naturalHeight / im.naturalWidth));
          const cv = document.createElement('canvas');
          cv.width = W; cv.height = H;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(im, 0, 0, W, H);
          const d = ctx.getImageData(0, 0, W, H).data;
          const lum = new Float32Array(W * H), sat = new Float32Array(W * H);
          for (let i = 0; i < W * H; i++) {
            const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
            sat[i] = mx ? (mx - mn) / mx : 0;
          }
          const rows = new Float32Array(H), cols = new Float32Array(W);
          for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
            const i = y * W + x;
            const gx = lum[i + 1] - lum[i - 1], gy = lum[i + W] - lum[i - W];
            const edge = Math.sqrt(gx * gx + gy * gy) / 255;
            const w = edge * edge * 4 + sat[i] * 0.6;   // detail and colour both count
            rows[y] += w; cols[x] += w;
          }
          resolve({ rows, cols });
        } catch { resolve(null); } // canvas tainted (no CORS) or other failure: keep the centre
      };
      im.onerror = () => resolve(null);
      im.src = url;
    });
    focusCache.set(url, job);
    return job;
  }

  // Fraction (0..1) of the overflow to scroll so the window holding the most energy is visible.
  // A gentle bias toward the middle breaks ties between similar windows.
  function bestOffset(profile, visibleFraction) {
    const n = profile.length, win = Math.max(1, Math.min(n, Math.round(visibleFraction * n)));
    if (win >= n) return 0.5;
    let sum = 0;
    for (let i = 0; i < win; i++) sum += profile[i];
    let best = 0, bestScore = -1;
    for (let start = 0; ; start++) {
      const centre = (start + win / 2) / n;
      const score = sum * (1 - 0.2 * Math.abs(centre - 0.5));
      if (score > bestScore) { bestScore = score; best = start; }
      if (start + win >= n) break;
      sum += profile[start + win] - profile[start];
    }
    return best / (n - win);
  }

  // object-position for this cover in its current box, from a focus point or the energy profiles
  function applyFocus(img) {
    const box = img.parentElement, f = img._focus;
    if (!box || !f) return;
    const iw = Number(img.getAttribute('width')) || img.naturalWidth, ih = Number(img.getAttribute('height')) || img.naturalHeight;
    const cw = box.clientWidth, ch = box.clientHeight;
    if (!iw || !ih || !cw || !ch) return;
    const scale = Math.max(cw / iw, ch / ih);
    const overX = iw * scale - cw, overY = ih * scale - ch;
    let px = 50, py = 50;
    if (f.point) {
      if (overX > 1) px = clamp((f.point.x * iw * scale - cw / 2) / overX, 0, 1) * 100;
      if (overY > 1) py = clamp((f.point.y * ih * scale - ch / 2) / overY, 0, 1) * 100;
    } else {
      if (overX > 1) px = bestOffset(f.cols, cw / (iw * scale)) * 100;
      if (overY > 1) py = bestOffset(f.rows, ch / (ih * scale)) * 100;
    }
    const pos = `${px.toFixed(1)}% ${py.toFixed(1)}%`;
    img.style.objectPosition = pos;
    if (img.classList.contains('album-cover--full')) img.style.backgroundPosition = pos;
  }

  async function focusCovers(scope) {
    for (const img of scope.querySelectorAll('.album-cover[data-focus-src]')) {
      let f = null;
      if (img.dataset.focus) { const [x, y] = img.dataset.focus.split(',').map(Number); if (x >= 0 && x <= 1 && y >= 0 && y <= 1) f = { point: { x, y } }; }
      if (!f) f = await analyseCover(img.dataset.focusSrc);
      if (f && img.isConnected) { img._focus = f; applyFocus(img); }
    }
  }
  function refocusCovers() {
    document.querySelectorAll('.album-cover[data-focus-src]').forEach(img => { if (img._focus) applyFocus(img); });
  }
  window.addEventListener('resize', refocusCovers);

  /* --- Featured belt: a conveyor of hand-picked photos at their real aspect ratio. It drifts
     slowly on its own, eases to a stop while hovered or handled, and can be wheel-scrolled,
     dragged or swiped like any strip. Photos repeat so it loops without a visible seam.

     Only the photos near the viewport exist in the DOM. Each one is a small, absolutely placed
     element with its own compositor-run transform animation sliding it left at BELT_SPEED, and
     photos are recycled as they leave one side and are needed on the other. One huge animated
     track would be refused by Firefox's compositor (it falls back to repainting every frame),
     so the animated pieces are kept smaller than the viewport. The strip itself is a native
     horizontal scroller, so wheel, drag, swipe and keyboard focus all move it the usual way. --- */
  const BELT_SPEED = 20;    // px per second
  const BELT_GAP = 8;       // px between photos, matches .belt-track's spacing in the CSS
  const BELT_RUN = 200000;  // px each photo's animation covers before it would ever end
  const TRACK_SPAN = 16;    // scroller content is this many viewports wide, re-centred as you near an end
  const BELT_MAX = 100;     // safety ceiling; every featured photo stays in rotation below it
  const BELT_AHEAD = 3;     // photos fetched ahead of the last one placed in each direction
  const belt = { items: [], el: null, track: null, placed: [], height: 0, trackW: 0, rate: 0, raf: 0, last: 0, hover: false, hold: 0, drag: null, dragged: false, warmed: new Map() };

  // The set is shuffled once per page load and keeps that order until the frontend reloads
  let featuredOrder = null;
  function featuredItems() {
    const items = (typeof PHOTO_FEATURED !== 'undefined' ? PHOTO_FEATURED : []).map(f => {
      const album = albumById.get(f.album);
      const photo = album && !album.unlisted && album.photos.find(p => p.id === f.photo);
      return photo ? { album, photo } : null;
    }).filter(Boolean);
    const key = it => it.album.id + '/' + it.photo.id;
    if (!featuredOrder) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      featuredOrder = new Map(items.map((it, i) => [key(it), i]));
    }
    const rank = it => featuredOrder.has(key(it)) ? featuredOrder.get(key(it)) : Infinity;
    return items.sort((a, b) => rank(a) - rank(b)).slice(0, BELT_MAX);
  }

  const beltItemWidth = ({ photo }) => belt.height * ((Number(photo.w) || 3) / (Number(photo.h) || 2));

  function beltItemEl({ album, photo }, width, copy) {
    const a = document.createElement('a');
    a.className = 'belt-item';
    a.href = hashFor(album.id, photo.id);
    a.dataset.album = album.id;
    a.dataset.photo = photo.id;
    a.style.width = width + 'px';
    if (copy) { a.setAttribute('aria-hidden', 'true'); a.tabIndex = -1; }
    a.innerHTML = `
        <img src="${esc(photo.thumb)}" alt="${esc(photoLabel(photo, album, -1))}" decoding="async">
        ${photo.title ? `<span class="belt-caption"><span class="belt-title">${esc(photo.title)}</span></span>` : ''}`;
    return a;
  }

  function renderFeatured() {
    if (!featuredEl) return;
    beltStop();
    belt.items = featuredItems();
    belt.el = belt.track = null;
    if (!belt.items.length) { featuredEl.innerHTML = ''; return; }
    featuredEl.innerHTML = `
      <section class="belt-section" aria-label="Featured photos">
        <div class="belt"><div class="belt-track"></div></div>
      </section>`;
    belt.el = featuredEl.querySelector('.belt');
    belt.track = featuredEl.querySelector('.belt-track');

    const el = belt.el;
    el.addEventListener('mouseenter', () => { belt.hover = true; beltStart(); });
    el.addEventListener('mouseleave', () => { belt.hover = false; beltStart(); });
    el.addEventListener('focusin', () => { belt.hover = true; beltStart(); });
    el.addEventListener('focusout', e => { if (!el.contains(e.relatedTarget)) { belt.hover = false; beltStart(); } });
    el.addEventListener('wheel', () => beltHold(2500), { passive: true });
    el.addEventListener('touchstart', () => beltHold(4000), { passive: true });
    el.addEventListener('touchend', () => beltHold(2500), { passive: true });
    el.addEventListener('scroll', onBeltScroll, { passive: true });
    // Mouse drag scrolls the strip. No pointer capture: it would retarget the click to the strip
    // and the photo under the pointer would no longer open.
    el.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      belt.drag = { x: e.clientX, from: el.scrollLeft };
      belt.dragged = false;
      beltStart();
      e.preventDefault(); // no native image/link drag
    });

    beltStart();
  }

  // Thumbnails are fetched lazily: a photo's own <img> loads when it is placed (already a margin
  // outside the viewport, so many seconds ahead of the drift), and each placement also warms the
  // next few photos in the direction the strip is growing, so a scroll finds them cached. Each
  // URL is fetched once per page; the Image objects are kept so the browser holds them decoded.
  function warmBeltThumb(photo) {
    const src = photo.thumb;
    if (!src || belt.warmed.has(src)) return;
    const im = new Image();
    im.decoding = 'async';
    im.src = src;
    belt.warmed.set(src, im);
  }
  function warmBeltAhead(idx, dir) {
    const n = belt.items.length;
    for (let k = 1; k <= Math.min(BELT_AHEAD, n - 1); k++) warmBeltThumb(belt.items[((idx + dir * k) % n + n) % n].photo);
  }

  // Where a placed photo is right now, in scroller coordinates
  const placedX = it => it.startX - BELT_SPEED * ((it.anim && it.anim.currentTime) || 0) / 1000;

  // x is the photo's position in the same frame of reference as its neighbour's startX. The new
  // animation is locked to the neighbour's clock (same start time and rate), so the spacing
  // between them is exact for as long as both exist instead of depending on when this ran.
  function placeBeltItem(idx, x, atFront, ref) {
    const item = belt.items[idx];
    const w = beltItemWidth(item);
    const copy = belt.placed.some(o => o.idx === idx);
    const el = beltItemEl(item, w, copy);
    if (atFront) belt.track.prepend(el); else belt.track.append(el);
    if (!belt.warmed.has(item.photo.thumb)) belt.warmed.set(item.photo.thumb, null); // its <img> is fetching it
    warmBeltAhead(idx, atFront ? -1 : 1);

    const placed = { idx, el, w, startX: x, anim: null };
    if (typeof el.animate === 'function') {
      const anim = placed.anim = el.animate(
        [{ transform: `translate3d(${x}px, 0, 0)` }, { transform: `translate3d(${x - BELT_RUN}px, 0, 0)` }],
        { duration: (BELT_RUN / BELT_SPEED) * 1000, fill: 'forwards', easing: 'linear' }
      );
      const ra = ref && ref.anim;
      if (ra && ra.startTime !== null && ra.playState === 'running') {
        anim.playbackRate = ra.playbackRate;
        anim.startTime = ra.startTime;
      } else {
        anim.playbackRate = belt.rate;
        if (ra) anim.currentTime = ra.currentTime || 0;
        if (!belt.rate) anim.pause();
      }
    } else {
      el.style.transform = `translate3d(${x}px, 0, 0)`;
    }
    if (atFront) belt.placed.unshift(placed); else belt.placed.push(placed);
    return placed;
  }
  function removeBeltItem(placed) {
    if (placed.anim) placed.anim.cancel();
    placed.el.remove();
  }

  // Add photos where the viewport (plus a margin) is uncovered and drop the ones far outside it
  function layoutBelt() {
    const el = belt.el;
    if (!el || !belt.items.length || !belt.height) return;
    const n = belt.items.length, cw = el.clientWidth, sl = el.scrollLeft;
    const margin = Math.max(300, cw * 0.5);
    const lo = sl - margin, hi = sl + cw + margin;
    if (!belt.placed.length) placeBeltItem(0, sl, false);
    let tail = belt.placed[belt.placed.length - 1];
    while (placedX(tail) + tail.w + BELT_GAP < hi && belt.placed.length < 400) {
      tail = placeBeltItem((tail.idx + 1) % n, tail.startX + tail.w + BELT_GAP, false, tail);
    }
    let head = belt.placed[0];
    while (placedX(head) > lo && belt.placed.length < 400) {
      const idx = (head.idx - 1 + n) % n;
      head = placeBeltItem(idx, head.startX - BELT_GAP - beltItemWidth(belt.items[idx]), true, head);
    }
    while (belt.placed.length > 1 && placedX(belt.placed[0]) + belt.placed[0].w < lo - margin) removeBeltItem(belt.placed.shift());
    while (belt.placed.length > 1 && placedX(belt.placed[belt.placed.length - 1]) > hi + margin) removeBeltItem(belt.placed.pop());
  }

  // Size the scroller's content and start in the middle of it, with the first photo at the left edge
  function buildBelt() {
    const el = belt.el, track = belt.track;
    if (!el || !track) return;
    for (const p of belt.placed) removeBeltItem(p);
    belt.placed = [];
    belt.height = el.clientHeight;
    belt.trackW = Math.max(1, el.clientWidth) * TRACK_SPAN;
    track.style.width = belt.trackW + 'px';
    if (!belt.height) return; // hidden (an album is open); built again when shown
    el.scrollLeft = belt.trackW / 2;
    layoutBelt();
  }

  // The user scrolled: keep the viewport covered, and when it nears an end of the content jump
  // everything back to the middle in the same frame so nothing visibly moves
  function onBeltScroll() {
    const el = belt.el;
    if (!el || !belt.trackW) return;
    const sl = el.scrollLeft;
    if (sl < belt.trackW * 0.2 || sl > belt.trackW * 0.8 - el.clientWidth) {
      const shift = belt.trackW / 2 - sl;
      el.scrollLeft = sl + shift;
      if (belt.drag) belt.drag.from += shift;
      for (const p of belt.placed) {
        p.startX += shift;
        if (p.anim) p.anim.effect.setKeyframes([{ transform: `translate3d(${p.startX}px, 0, 0)` }, { transform: `translate3d(${p.startX - BELT_RUN}px, 0, 0)` }]);
        else p.el.style.transform = `translate3d(${p.startX}px, 0, 0)`;
      }
    }
    layoutBelt();
  }

  const beltWantsMotion = () => !belt.hover && !belt.drag && performance.now() > belt.hold && !document.hidden && !reduceMotion.matches;

  // Ease the playback rate toward 1 (drifting) or 0 (still) so the strip glides to a stop and
  // picks up again instead of jerking. The loop only runs while the rate is changing or a hold
  // is pending; while drifting it also tops up photos on the right every so often.
  function beltTick(now) {
    belt.raf = 0;
    if (!belt.el || !belt.el.isConnected) return;
    const dt = Math.min(0.1, (now - belt.last) / 1000);
    belt.last = now;
    const target = beltWantsMotion() ? 1 : 0;
    const k = 1 - Math.exp(-dt * (target ? 3 : 6)); // ~1s to ease in, ~0.5s to ease out
    let rate = belt.rate + (target - belt.rate) * k;
    if (Math.abs(target - rate) < 0.01) rate = target;
    if (rate !== belt.rate) {
      belt.rate = rate;
      for (const { anim } of belt.placed) {
        if (!anim) continue;
        if (rate && anim.playState === 'paused') anim.play();
        // updatePlaybackRate changes speed in step with the compositor, so there is no hitch
        if (anim.updatePlaybackRate) anim.updatePlaybackRate(rate); else anim.playbackRate = rate;
        if (!rate) anim.pause();
      }
    }
    const settled = rate === target && (target === 1 || performance.now() > belt.hold);
    if (!settled) belt.raf = requestAnimationFrame(beltTick);
    else if (target === 1) beltRefill();
  }
  // While drifting, photos arrive from the right at BELT_SPEED; a cheap periodic check keeps the
  // margin stocked without a per-frame loop
  function beltRefill() {
    clearTimeout(belt.refill);
    belt.refill = setTimeout(() => {
      if (!belt.el || !belt.el.isConnected || belt.raf) return;
      layoutBelt();
      if (beltWantsMotion()) beltRefill();
    }, 1000);
  }
  function beltStart() {
    if (!belt.el || belt.raf) return;
    // After a stop (an album was open, which also hides the strip and drops its scroll position)
    // the strip is rebuilt
    if (!belt.placed.length) buildBelt();
    clearTimeout(belt.refill);
    belt.last = performance.now();
    belt.raf = requestAnimationFrame(beltTick);
  }
  function beltStop() {
    if (belt.raf) cancelAnimationFrame(belt.raf);
    belt.raf = 0;
    clearTimeout(belt.refill);
    for (const p of belt.placed) removeBeltItem(p);
    belt.placed = [];
    belt.rate = 0;
  }
  const beltHold = ms => { belt.hold = Math.max(belt.hold, performance.now() + ms); beltStart(); };

  window.addEventListener('pointermove', e => {
    if (!belt.drag || !belt.el) return;
    const dx = e.clientX - belt.drag.x;
    if (Math.abs(dx) > 4) { belt.dragged = true; belt.el.classList.add('is-dragging'); }
    belt.el.scrollLeft = belt.drag.from - dx;
  });
  const endBeltDrag = () => { if (!belt.drag) return; belt.drag = null; belt.el && belt.el.classList.remove('is-dragging'); beltHold(1500); };
  window.addEventListener('pointerup', endBeltDrag);
  window.addEventListener('pointercancel', endBeltDrag);

  document.addEventListener('visibilitychange', () => { if (!currentAlbum) beltStart(); });
  let beltResize = 0;
  window.addEventListener('resize', () => {
    if (!belt.el || !belt.el.clientHeight) return;
    clearTimeout(beltResize);
    beltResize = setTimeout(() => { buildBelt(); beltStart(); }, 150);
  });

  // Section view: one banner per album (folder), newest first
  function renderList() {
    currentAlbum = null;
    shown = [];
    grid = null;
    root.classList.remove('in-album');
    if (featuredEl && !featuredEl.children.length) renderFeatured();
    else beltStart();
    const albums = PHOTO_ALBUMS.filter(a => a.section === section && !a.unlisted).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    viewEl.innerHTML = albums.length
      ? `<div class="album-list">${albums.map(a => `
          <a class="album-card" href="#${esc(a.id)}" data-album="${esc(a.id)}">${bannerHTML(a, 'h2')}</a>`).join('')}</div>`
      : '<p class="photo-empty">Nothing here yet.</p>';
    focusCovers(viewEl);
  }

  // Album view: banner with the name on top, then the grid
  function renderAlbum(a) {
    currentAlbum = a;
    shown = gridPhotos(a);
    if (!a.unlisted) { section = a.section; updateChips(); } // unlisted albums belong to no section
    root.classList.add('in-album');
    beltStop();
    viewEl.innerHTML = `
      <div class="album-banner">
        <a class="album-back" href="${esc(location.pathname)}" data-back>&#8592; ${esc(a.unlisted ? 'Back' : sectionName(a.section))}</a>
        ${bannerHTML(a, 'h2', true)}
      </div>
      <div class="photo-grid">${shown.map((p, i) => {
        const w = Number(p.w) || 0, h = Number(p.h) || 0, ratio = w && h ? (w / h).toFixed(4) : '1.5';
        return `
        <a class="photo-tile" href="${esc(p.src)}" data-id="${esc(p.id)}" data-ratio="${esc(ratio)}" aria-label="${esc(photoLabel(p, a, i))}">
          <img src="${esc(p.thumb)}" alt="${esc(photoLabel(p, a, i))}" width="${esc(w)}" height="${esc(h)}" loading="lazy" decoding="async">
        </a>`; }).join('')}</div>`;
    grid = viewEl.querySelector('.photo-grid');
    focusCovers(viewEl);
    layout();
    if (ro) ro.disconnect();
    ro = new ResizeObserver(layout);
    ro.observe(grid);
    grid.querySelectorAll('img').forEach(img => { if (img.complete && img.naturalWidth) img.classList.add('is-loaded'); });
  }

  function renderChips() {
    filtersEl.innerHTML = PHOTO_SECTIONS.map(c =>
      `<button type="button" class="photo-chip${c.id === section ? ' active' : ''}" role="tab" aria-selected="${c.id === section}" data-section="${esc(c.id)}">${esc(c.name)}</button>`
    ).join('');
  }
  function updateChips() {
    filtersEl.querySelectorAll('.photo-chip').forEach(c => {
      const on = c.dataset.section === section;
      c.classList.toggle('active', on);
      c.setAttribute('aria-selected', on);
    });
    try { sessionStorage.setItem('photoSection', section); } catch {}
  }

  // Swap what the page shows. Uses the same "morph" as the tab switch (js/transitions.js + the
  // html[data-vt="morph"] rules in style.css): the card frame animates to its new size while the old
  // and new contents crossfade. Falls back to a short fade without the View Transitions API.
  let morphsRunning = 0;
  function swapView(render, animate) {
    if (!animate || reduceMotion.matches) { render(); return; }
    let style = 'morph';
    try { style = sessionStorage.getItem('transition') || style; } catch {}
    if (style !== 'fade' && typeof document.startViewTransition === 'function') {
      const html = document.documentElement;
      html.dataset.vt = 'morph';
      morphsRunning++;
      const vt = document.startViewTransition(render);
      vt.finished.catch(() => {}).then(() => {
        if (--morphsRunning === 0 && html.dataset.vt === 'morph') delete html.dataset.vt;
      });
      return;
    }
    viewEl.classList.add('is-switching');
    setTimeout(() => { render(); viewEl.classList.remove('is-switching'); }, 150);
  }

  function setSection(id) {
    if (id === section && !currentAlbum) return;
    section = id;
    updateChips();
    if (currentAlbum) { history.pushState(null, '', location.pathname + location.search); }
    swapView(renderList, true);
  }

  // --- hash routing ---
  // #<album>, #<album>/<photo>, and for private albums #u/<folder> and #u/<folder>/<photo>
  function parseHash() {
    const m = location.hash.match(/^#(u\/[a-z0-9-]+|[^/]+)(?:\/([^/]+))?$/);
    return m ? { album: m[1], photo: m[2] || null } : { album: null, photo: null };
  }
  const hashFor = (albumId, photoId) => albumId ? '#' + albumId + (photoId ? '/' + photoId : '') : location.pathname + location.search;

  // A private album is fetched the first time its link is opened, then routed like any other
  const privateLoads = new Map();
  function loadPrivate(r) {
    const id = r.album;
    if (!privateLoads.has(id)) privateLoads.set(id, typeof loadPrivateAlbum === 'function' ? loadPrivateAlbum(id.slice(2)) : Promise.resolve(null));
    if (!viewEl.children.length) viewEl.innerHTML = '<p class="photo-empty">Loading album…</p>';
    privateLoads.get(id).then(a => {
      if (!root || !root.isConnected || parseHash().album !== id) return; // navigated away meanwhile
      if (!a) {
        privateLoads.delete(id); // allow a retry
        renderList();
        viewEl.insertAdjacentHTML('afterbegin', '<p class="photo-empty">That album link isn’t valid, or the album is no longer shared.</p>');
        return;
      }
      albumById.set(id, a);
      if (r.photo && !isOpen) { // deep link to a photo: Back returns to the album grid
        history.replaceState(null, '', hashFor(id, null));
        history.pushState({ viewer: true }, '', hashFor(id, r.photo));
      }
      applyRoute(parseHash(), { animate: false });
    });
  }

  function applyRoute(r, { animate = true } = {}) {
    if (r.album && r.album.startsWith('u/') && !albumById.has(r.album)) { loadPrivate(r); return; }
    const album = r.album ? albumById.get(r.album) : null;
    const photo = album && r.photo ? album.photos.find(p => p.id === r.photo) : null;
    if (album !== currentAlbum || !viewEl.children.length) {
      const changed = album !== currentAlbum;
      // No morph when the viewer is about to cover the page anyway
      swapView(() => {
        album ? renderAlbum(album) : renderList();
        if (changed) window.scrollTo(0, 0); // inside the swap so the morph starts from the top
      }, animate && !photo);
    }
    if (photo) {
      if (!isOpen || items !== album.photos) openViewer(album.photos, album.photos.indexOf(photo), { push: false });
      else if (items[idx] !== photo) show(album.photos.indexOf(photo), 0);
    } else if (isOpen) {
      closeViewer({ fromHistory: true });
    }
  }

  let initToken = 0;
  async function init() {
    if (ro) { ro.disconnect(); ro = null; }
    root = document.querySelector('.photo-card');
    filtersEl = document.querySelector('.photo-filters');
    viewEl = document.querySelector('.photo-view');
    featuredEl = document.querySelector('.photo-featured');
    grid = null;
    beltStop();
    if (!root || !filtersEl || !viewEl) return;

    // Wait for the manifest; bail if the card was swapped meanwhile
    const token = ++initToken;
    const status = typeof PHOTO_DATA_READY !== 'undefined' ? await PHOTO_DATA_READY : 'manifest';
    if (token !== initToken || !root.isConnected) return;
    albumById = new Map(PHOTO_ALBUMS.map(a => [a.id, a]));
    // Titles that are just camera filenames ("1145 0160", "Owo07969", "DSC01234") are treated as
    // untitled; the UI then shows the album name instead
    for (const a of PHOTO_ALBUMS) for (const p of a.photos) if (looksLikeFilename(p.title)) p.title = '';

    if (status === 'error' || !PHOTO_SECTIONS.length) {
      filtersEl.innerHTML = '';
      if (featuredEl) featuredEl.innerHTML = '';
      viewEl.innerHTML = `<p class="photo-empty">${status === 'error'
        ? 'The photo library could not be loaded right now. Please try again in a moment.'
        : 'No albums yet.'}</p>`;
      return;
    }

    try { section = sessionStorage.getItem('photoSection') || section; } catch {}
    if (!PHOTO_SECTIONS.some(c => c.id === section)) section = PHOTO_SECTIONS[0].id;
    renderChips();

    // Deep link to a photo: make the album the "closed" history entry so Back returns to its grid
    const r = parseHash();
    if (r.album && r.photo && albumById.has(r.album) && !isOpen) {
      history.replaceState(null, '', hashFor(r.album, null));
      history.pushState({ viewer: true }, '', hashFor(r.album, r.photo));
    }
    applyRoute(r, { animate: false });
  }

  // Thumbnails fade in as they arrive (load doesn't bubble, so listen in the capture phase)
  document.addEventListener('load', e => {
    if (e.target.matches?.('.photo-tile img, .album-cover')) e.target.classList.add('is-loaded');
  }, true);

  document.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const chip = e.target.closest('.photo-chip');
    if (chip && filtersEl?.contains(chip)) { setSection(chip.dataset.section); return; }

    const feat = e.target.closest('.belt-item');
    if (feat) {
      e.preventDefault();
      if (belt.dragged) { belt.dragged = false; return; } // a drag, not a click
      history.pushState(null, '', hashFor(feat.dataset.album, feat.dataset.photo));
      applyRoute(parseHash());
      return;
    }

    const card = e.target.closest('.album-card');
    if (card) {
      e.preventDefault();
      history.pushState(null, '', hashFor(card.dataset.album, null));
      applyRoute(parseHash());
      return;
    }

    const back = e.target.closest('.album-back');
    if (back) {
      e.preventDefault();
      history.pushState(null, '', hashFor(null));
      applyRoute(parseHash());
      return;
    }

    const tile = e.target.closest('.photo-tile');
    if (tile && currentAlbum) {
      e.preventDefault();
      openViewer(shown, shown.findIndex(p => p.id === tile.dataset.id));
    }
  });

  /* ======================= Viewer ======================= */
  const ICON = {
    close:   '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    prev:    '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    next:    '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    info:    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    play:    '<svg class="icon-play" viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z"/></svg>',
    pause:   '<svg class="icon-pause" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
    zoomIn:  '<svg class="icon-zoom-in" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M11 8v6M8 11h6"/></svg>',
    zoomOut: '<svg class="icon-zoom-out" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8 11h6"/></svg>',
  };

  const pv = document.createElement('div');
  pv.className = 'pv';
  pv.setAttribute('role', 'dialog');
  pv.setAttribute('aria-modal', 'true');
  pv.setAttribute('aria-label', 'Photo viewer');
  pv.innerHTML = `
    <div class="pv-progress"></div>
    <div class="pv-top">
      <span class="pv-counter"></span>
      <span class="pv-title"></span>
      <div class="pv-actions">
        <button type="button" class="pv-btn pv-zoom" aria-label="Zoom" title="Zoom (Z)">${ICON.zoomIn}${ICON.zoomOut}</button>
        <button type="button" class="pv-btn pv-play" aria-label="Slideshow" aria-pressed="false" title="Slideshow (Space)">${ICON.play}${ICON.pause}</button>
        <button type="button" class="pv-btn pv-infobtn" aria-label="Details" aria-pressed="false" title="Details (I)">${ICON.info}</button>
        <button type="button" class="pv-btn pv-close" aria-label="Close" title="Close (Esc)">${ICON.close}</button>
      </div>
    </div>
    <div class="pv-stage">
      <img class="pv-img" alt="" draggable="false">
      <div class="pv-spinner"></div>
    </div>
    <button type="button" class="pv-arrow pv-prev" aria-label="Previous photo">${ICON.prev}</button>
    <button type="button" class="pv-arrow pv-next" aria-label="Next photo">${ICON.next}</button>
    <div class="pv-film" role="list" aria-label="Filmstrip"></div>
    <aside class="pv-info" aria-label="Photo details">
      <div class="pv-info-head">
        <span class="pv-info-label">Details</span>
        <button type="button" class="pv-btn pv-info-close" aria-label="Close details">&times;</button>
      </div>
      <h2 class="pv-info-title"></h2>
      <p class="pv-info-caption"></p>
      <dl class="pv-meta"></dl>
    </aside>`;
  document.body.appendChild(pv);

  const $ = sel => pv.querySelector(sel);
  const stage    = $('.pv-stage');
  const img      = $('.pv-img');
  const counter  = $('.pv-counter');
  const titleEl  = $('.pv-title');
  const film     = $('.pv-film');
  const progress = $('.pv-progress');
  const zoomBtn  = $('.pv-zoom');
  const playBtn  = $('.pv-play');
  const infoBtn  = $('.pv-infobtn');
  const closeBtn = $('.pv-close');
  const prevBtn  = $('.pv-prev');
  const nextBtn  = $('.pv-next');
  const infoTitle   = $('.pv-info-title');
  const infoCaption = $('.pv-info-caption');
  const meta        = $('.pv-meta');

  const INTERVAL = 4000;
  let items = [], idx = 0;
  let isOpen = false, playing = false, infoOpen = false;
  let timer = 0, hideTimer = 0, showToken = 0;
  let returnFocus = null;
  const zoom = { s: 1, x: 0, y: 0 };

  try { infoOpen = sessionStorage.getItem('pvInfo') === '1'; } catch {}

  // --- image cache: keeps the current photo and its neighbours decoded ---
  const cache = new Map();
  function loadImage(p) {
    let im = cache.get(p.id);
    if (!im) {
      im = new Image();
      im.decoding = 'async';
      im.src = p.src;
      cache.set(p.id, im);
      if (cache.size > 12) cache.delete(cache.keys().next().value);
    }
    return im;
  }
  const preload = i => { if (items.length > 1) loadImage(items[(i + items.length) % items.length]); };

  function fillInfo(p) {
    infoTitle.textContent = p.title || (currentAlbum ? currentAlbum.name : '');
    infoCaption.textContent = p.caption || '';
    infoCaption.hidden = !p.caption;
    const x = p.exif || {};
    const rows = [
      ['Album', currentAlbum && currentAlbum.name],
      ['Date', p.date && fmtDate(p.date)],
      ['Camera', x.camera],
      ['Lens', x.lens],
      ['Focal length', x.focal],
      ['Aperture', x.aperture],
      ['Shutter', x.shutter],
      ['ISO', x.iso],
      ['Size', p.w && p.h && `${p.w} × ${p.h}`],
    ].filter(([, v]) => v !== undefined && v !== null && v !== '');
    meta.innerHTML = rows.map(([k, v]) => `<div class="pv-meta-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  }

  function buildFilm() {
    film.innerHTML = items.map((p, i) => {
      const w = Number(p.w) || 3, h = Number(p.h) || 2;   // numbers only reach the style attribute
      return `<button type="button" class="pv-thumb" role="listitem" data-i="${esc(i)}" style="aspect-ratio: ${esc(w)} / ${esc(h)}" aria-label="${esc(p.title)}">
        <img src="${esc(p.thumb)}" alt="" loading="lazy" decoding="async">
      </button>`; }).join('');
  }

  function centerThumb(instant) {
    const t = film.children[idx];
    if (!t) return;
    film.querySelectorAll('.pv-thumb.active').forEach(el => el.classList.remove('active'));
    t.classList.add('active');
    const left = t.offsetLeft - (film.clientWidth - t.offsetWidth) / 2;
    film.scrollTo({ left, behavior: instant || reduceMotion.matches ? 'auto' : 'smooth' });
  }

  function show(i, dir = 0) {
    if (!items.length) return;
    idx = (i + items.length) % items.length;
    const p = items[idx];
    resetZoom();
    counter.textContent = `${idx + 1} / ${items.length}`;
    titleEl.textContent = p.title || (currentAlbum ? currentAlbum.name : '');
    fillInfo(p);
    centerThumb(dir === 0);
    if (isOpen && currentAlbum) history.replaceState(history.state, '', hashFor(currentAlbum.id, p.id));

    // Decode off-screen first, then swap: the previous photo stays until the next one is ready
    const token = ++showToken;
    const im = loadImage(p);
    const apply = () => {
      if (token !== showToken) return;
      pv.classList.remove('loading');
      img.src = p.src;
      img.alt = p.title || (currentAlbum ? currentAlbum.name : '');
      img.classList.remove('swap-left', 'swap-right', 'swap-fade');
      if (!reduceMotion.matches) {
        void img.offsetWidth; // restart the animation
        img.classList.add(dir > 0 ? 'swap-right' : dir < 0 ? 'swap-left' : 'swap-fade');
      }
      if (playing) restartTimer();
    };
    if (im.complete && im.naturalWidth) apply();
    else {
      pv.classList.add('loading');
      im.decode().catch(() => {}).then(apply);
    }
    preload(idx + 1);
    preload(idx - 1);
  }

  const next = () => show(idx + 1, 1);
  const prev = () => show(idx - 1, -1);

  function openViewer(list, i, { push = true } = {}) {
    if (!list.length) return;
    items = list;
    buildFilm();
    returnFocus = document.activeElement;
    isOpen = true;
    pv.classList.add('visible');
    pv.classList.toggle('info-open', infoOpen);
    infoBtn.setAttribute('aria-pressed', infoOpen);
    document.documentElement.classList.add('pv-open');
    const p = items[(i + items.length) % items.length];
    if (push && currentAlbum) history.pushState({ viewer: true }, '', hashFor(currentAlbum.id, p.id));
    show(i, 0);
    closeBtn.focus({ preventScroll: true });
    armHide();
  }

  function closeViewer({ fromHistory = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    stopSlideshow();
    clearTimeout(hideTimer);
    pv.classList.remove('visible', 'immersive', 'loading');
    document.documentElement.classList.remove('pv-open');
    resetZoom();
    if (!fromHistory) {
      if (history.state && history.state.viewer) history.back();
      else if (currentAlbum) history.replaceState(null, '', hashFor(currentAlbum.id, null));
    }
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  // --- slideshow ---
  function restartTimer() {
    clearTimeout(timer);
    progress.style.animation = 'none';
    void progress.offsetWidth;
    progress.style.animation = '';
    timer = setTimeout(() => { if (playing && isOpen) next(); }, INTERVAL);
  }
  function startSlideshow() {
    playing = true;
    pv.classList.add('playing');
    playBtn.setAttribute('aria-pressed', 'true');
    restartTimer();
  }
  function stopSlideshow() {
    playing = false;
    clearTimeout(timer);
    pv.classList.remove('playing');
    playBtn.setAttribute('aria-pressed', 'false');
  }
  const toggleSlideshow = () => (playing ? stopSlideshow() : startSlideshow());

  // --- details panel ---
  function toggleInfo(force) {
    infoOpen = force === undefined ? !infoOpen : !!force;
    pv.classList.toggle('info-open', infoOpen);
    infoBtn.setAttribute('aria-pressed', infoOpen);
    try { sessionStorage.setItem('pvInfo', infoOpen ? '1' : '0'); } catch {}
    if (infoOpen) { clearTimeout(hideTimer); pv.classList.remove('immersive'); }
    else armHide();
  }

  // --- immersive mode: chrome hides after a quiet moment on desktop, on tap on touch ---
  function armHide() {
    clearTimeout(hideTimer);
    if (coarse.matches || infoOpen || !isOpen) return;
    hideTimer = setTimeout(() => pv.classList.add('immersive'), 2500);
  }
  function wake() {
    pv.classList.remove('immersive');
    armHide();
  }
  pv.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return; // touch taps also fire compat mouse events; those are handled by tap()
    pv.classList.remove('immersive');
    if (e.target.closest('.pv-top, .pv-film, .pv-arrow, .pv-info')) clearTimeout(hideTimer);
    else armHide();
  });

  // --- zoom & pan ---
  function applyTransform() {
    img.style.transform = zoom.s === 1 ? '' : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
    pv.classList.toggle('zoomed', zoom.s > 1);
  }
  function resetZoom() {
    zoom.s = 1; zoom.x = 0; zoom.y = 0;
    applyTransform();
  }
  function clampPan() {
    const r = stage.getBoundingClientRect();
    const maxX = Math.max(0, (img.clientWidth * zoom.s - r.width) / 2);
    const maxY = Math.max(0, (img.clientHeight * zoom.s - r.height) / 2);
    zoom.x = clamp(zoom.x, -maxX, maxX);
    zoom.y = clamp(zoom.y, -maxY, maxY);
  }
  function maxScale() {
    const p = items[idx];
    return Math.max(4, p && p.w ? p.w / Math.max(1, img.clientWidth) : 4);
  }
  // Scale about a screen point so whatever is under the cursor/fingers stays put
  function setZoom(s, cx, cy) {
    s = clamp(s, 1, maxScale());
    if (s < 1.02) { resetZoom(); return; }
    const r = stage.getBoundingClientRect();
    const px = cx - (r.left + r.width / 2);
    const py = cy - (r.top + r.height / 2);
    const ux = (px - zoom.x) / zoom.s;
    const uy = (py - zoom.y) / zoom.s;
    zoom.s = s;
    zoom.x = px - ux * s;
    zoom.y = py - uy * s;
    clampPan();
    applyTransform();
  }
  function toggleZoomAt(cx, cy) {
    if (zoom.s > 1) { resetZoom(); return; }
    const p = items[idx];
    const r = stage.getBoundingClientRect();
    if (cx === undefined) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    // 1:1 device pixels, but never less than 2x so the button always does something visible
    const one = p && p.w ? p.w / (img.clientWidth * (window.devicePixelRatio || 1)) : 2;
    setZoom(Math.max(2, one), cx, cy);
  }

  const pointers = new Map();
  let drag = null, pinch = null;
  let lastTap = 0, tapTimer = 0;

  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      drag = { sx: e.clientX, sy: e.clientY, tx: zoom.x, ty: zoom.y, moved: false, type: e.pointerType };
      if (zoom.s > 1) img.classList.add('is-dragging');
    } else if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), s: zoom.s };
      drag = null;
      img.classList.remove('is-dragging');
      img.classList.add('is-pinching');
      clearTimeout(tapTimer);
    }
  });

  stage.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setZoom(pinch.s * dist / pinch.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
    if (zoom.s > 1) {
      zoom.x = drag.tx + dx;
      zoom.y = drag.ty + dy;
      clampPan();
      applyTransform();
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) { pinch = null; img.classList.remove('is-pinching'); }
    if (!drag) return;
    const d = drag; drag = null;
    img.classList.remove('is-dragging');
    if (e.type === 'pointercancel') return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (zoom.s === 1 && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      dx < 0 ? next() : prev();
      wake();
      return;
    }
    if (d.moved) return;
    tap(e, d);
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  function tap(e, d) {
    if (d.type === 'touch') {
      const now = performance.now();
      if (now - lastTap < 300) {           // double tap: zoom
        clearTimeout(tapTimer);
        lastTap = 0;
        toggleZoomAt(e.clientX, e.clientY);
        return;
      }
      lastTap = now;
      tapTimer = setTimeout(() => {         // single tap: toggle the chrome
        if (zoom.s === 1) pv.classList.toggle('immersive');
      }, 300);
      return;
    }
    // Mouse: a click on the photo zooms in at that point (and back out); the dark area closes
    if (overImg(e.clientX, e.clientY)) toggleZoomAt(e.clientX, e.clientY);
    else closeViewer();
  }

  // Pointer capture retargets click/dblclick to the stage, so test the point against the photo's box
  const overImg = (x, y) => { const r = img.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    setZoom(zoom.s * factor, e.clientX, e.clientY);
    wake();
  }, { passive: false });

  window.addEventListener('resize', () => {
    if (isOpen && zoom.s > 1) { clampPan(); applyTransform(); }
  });

  // --- controls ---
  closeBtn.addEventListener('click', () => closeViewer());
  prevBtn.addEventListener('click', () => { prev(); });
  nextBtn.addEventListener('click', () => { next(); });
  zoomBtn.addEventListener('click', () => toggleZoomAt());
  playBtn.addEventListener('click', toggleSlideshow);
  infoBtn.addEventListener('click', () => toggleInfo());
  $('.pv-info-close').addEventListener('click', () => toggleInfo(false));
  film.addEventListener('click', e => {
    const t = e.target.closest('.pv-thumb');
    if (t) { const i = +t.dataset.i; show(i, Math.sign(i - idx)); }
  });

  document.addEventListener('keydown', e => {
    if (!isOpen) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Tab') {                   // keep focus inside the dialog
      const f = Array.from(pv.querySelectorAll('button, a[href]')).filter(el => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    switch (e.key) {
      case 'Escape':     closeViewer(); break;
      case 'ArrowRight': next(); break;
      case 'ArrowLeft':  prev(); break;
      case ' ':          e.preventDefault(); toggleSlideshow(); break;
      case 'i': case 'I': toggleInfo(); break;
      case 'z': case 'Z': toggleZoomAt(); break;
      case 'Home':       show(0, -1); break;
      case 'End':        show(items.length - 1, 1); break;
      default: return;
    }
    wake();
  });

  // Back/forward: re-read the hash and show whatever it names
  window.addEventListener('popstate', () => {
    if (root && root.isConnected) applyRoute(parseHash());
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) stopSlideshow();
  });

  /* ======================= Start ======================= */
  // Runs last: a deep link can open the viewer during init, so the viewer has to exist first
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('pageswap', init); // transitions.js swapped the card in
})();
