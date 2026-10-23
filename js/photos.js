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

  // Justified rows: pack tiles until the row, scaled to fill the width, drops to the target height
  function layout() {
    if (!grid || !grid.isConnected) return;
    const width = grid.clientWidth;
    if (!width) return;
    const target = targetRowHeight(width);
    const tiles = Array.from(grid.children).filter(el => el.classList.contains('photo-tile'));
    let row = [], ratioSum = 0;

    const flush = (last) => {
      if (!row.length) return;
      let h = (width - GAP * (row.length - 1)) / ratioSum;
      if (last) h = Math.min(h, target * 1.15); // a short last row stays left-aligned instead of ballooning
      let used = 0;
      row.forEach((tile, i) => {
        const isLast = i === row.length - 1 && !last;
        const w = isLast ? width - GAP * (row.length - 1) - used : Math.floor(+tile.dataset.ratio * h);
        used += w;
        tile.style.width = w + 'px';
        tile.style.height = h.toFixed(2) + 'px';
      });
      row = []; ratioSum = 0;
    };

    for (const tile of tiles) {
      row.push(tile);
      ratioSum += +tile.dataset.ratio;
      if ((width - GAP * (row.length - 1)) / ratioSum <= target) flush(false);
    }
    flush(true);
  }

  const albumMeta = a => [
    a.date && fmtDate(a.date, { year: 'numeric', month: 'short' }),
    a.location,
    `${gridPhotos(a).length} photo${gridPhotos(a).length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');

  function bannerHTML(a, tag) {
    const c = coverOf(a);
    return `
      <img class="album-cover" src="${esc(c.thumb)}" alt="" width="${esc(Number(c.w) || 0)}" height="${esc(Number(c.h) || 0)}" loading="lazy" decoding="async">
      <div class="album-text">
        <${tag} class="album-name">${esc(a.name)}</${tag}>
        <p class="album-meta">${esc(albumMeta(a))}</p>
      </div>`;
  }

  /* --- Featured slider: rotates through hand-picked photos above the album list --- */
  const SLIDE_MS = 5000;
  const slider = { items: [], idx: 0, timer: 0, layer: 0, paused: false, token: 0 };

  function featuredItems() {
    return (typeof PHOTO_FEATURED !== 'undefined' ? PHOTO_FEATURED : []).map(f => {
      const album = albumById.get(f.album);
      const photo = album && album.photos.find(p => p.id === f.photo);
      return photo ? { album, photo } : null;
    }).filter(Boolean);
  }

  function renderFeatured() {
    if (!featuredEl) return;
    slider.items = featuredItems();
    clearTimeout(slider.timer);
    if (!slider.items.length) { featuredEl.innerHTML = ''; return; }
    const multi = slider.items.length > 1;
    featuredEl.innerHTML = `
      <section class="featured" aria-roledescription="carousel" aria-label="Featured photos">
        <a class="featured-link" href="#">
          <div class="featured-stage">
            <img class="featured-img" alt="" decoding="async">
            <img class="featured-img" alt="" decoding="async">
          </div>
          <div class="featured-text">
            <span class="featured-label">Featured</span>
            <h2 class="featured-title"></h2>
            <p class="featured-meta"></p>
          </div>
        </a>
        ${multi ? `
        <button type="button" class="featured-arrow featured-prev" aria-label="Previous featured photo">${ICON.prev}</button>
        <button type="button" class="featured-arrow featured-next" aria-label="Next featured photo">${ICON.next}</button>
        <div class="featured-dots" role="tablist">${slider.items.map((_, i) =>
          `<button type="button" class="featured-dot" role="tab" data-i="${i}" aria-label="Featured photo ${i + 1}"></button>`).join('')}</div>` : ''}
      </section>`;
    slider.idx = -1;
    slider.layer = 0;
    // Hovering or focusing the slider pauses the rotation
    const sec = featuredEl.querySelector('.featured');
    const pause = () => { slider.paused = true; clearTimeout(slider.timer); };
    const resume = () => { slider.paused = false; armSlide(); };
    sec.addEventListener('mouseenter', pause);
    sec.addEventListener('mouseleave', resume);
    sec.addEventListener('focusin', pause);
    sec.addEventListener('focusout', e => { if (!sec.contains(e.relatedTarget)) resume(); });
    goToSlide(0, true);
  }

  function goToSlide(i, instant) {
    const n = slider.items.length;
    if (!n || !featuredEl.isConnected) return;
    i = (i + n) % n;
    if (i === slider.idx) return;
    slider.idx = i;
    const { album, photo } = slider.items[i];
    const sec = featuredEl.querySelector('.featured');
    const imgs = sec.querySelectorAll('.featured-img');
    const link = sec.querySelector('.featured-link');
    link.href = hashFor(album.id, photo.id);
    link.dataset.album = album.id;
    link.dataset.photo = photo.id;
    sec.querySelector('.featured-title').textContent = photo.title || album.name;
    sec.querySelector('.featured-meta').textContent = [photo.title ? album.name : '', album.date && fmtDate(album.date, { year: 'numeric', month: 'short' })].filter(Boolean).join(' · ');
    sec.querySelectorAll('.featured-dot').forEach((d, k) => { d.classList.toggle('active', k === i); d.setAttribute('aria-selected', k === i); });

    // Decode into the hidden layer, then crossfade the layers
    const token = ++slider.token;
    const next = imgs[1 - slider.layer];
    const im = new Image();
    im.decoding = 'async';
    im.src = photo.src;
    const swap = () => {
      if (token !== slider.token || !sec.isConnected) return;
      next.src = photo.src;
      next.alt = photo.title || '';
      if (instant || reduceMotion.matches) next.classList.add('no-fade');
      else next.classList.remove('no-fade');
      imgs[slider.layer].classList.remove('is-active');
      next.classList.add('is-active');
      slider.layer = 1 - slider.layer;
      armSlide();
    };
    im.decode().catch(() => {}).then(swap);
    // Warm the next slide's image
    if (n > 1) { const p2 = slider.items[(i + 1) % n].photo; const pre = new Image(); pre.src = p2.src; }
  }

  function armSlide() {
    clearTimeout(slider.timer);
    if (slider.items.length < 2 || slider.paused || reduceMotion.matches || document.hidden) return;
    slider.timer = setTimeout(() => goToSlide(slider.idx + 1), SLIDE_MS);
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) armSlide(); else clearTimeout(slider.timer); });

  // Swipe between slides on touch
  let slideSwipe = null;
  document.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && e.target.closest('.featured-stage')) slideSwipe = { x: e.clientX, y: e.clientY }; }, true);
  document.addEventListener('pointerup', e => {
    if (!slideSwipe) return;
    const dx = e.clientX - slideSwipe.x, dy = e.clientY - slideSwipe.y;
    slideSwipe = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) { e.preventDefault(); goToSlide(slider.idx + (dx < 0 ? 1 : -1)); slideSwipe = 'done'; setTimeout(() => { slideSwipe = null; }, 0); }
  }, true);

  // Section view: one banner per album (folder), newest first
  function renderList() {
    currentAlbum = null;
    shown = [];
    grid = null;
    root.classList.remove('in-album');
    if (featuredEl && !featuredEl.children.length) renderFeatured();
    armSlide();
    const albums = PHOTO_ALBUMS.filter(a => a.section === section).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    viewEl.innerHTML = albums.length
      ? `<div class="album-list">${albums.map(a => `
          <a class="album-card" href="#${esc(a.id)}" data-album="${esc(a.id)}">${bannerHTML(a, 'h2')}</a>`).join('')}</div>`
      : '<p class="photo-empty">Nothing here yet.</p>';
  }

  // Album view: banner with the name on top, then the grid
  function renderAlbum(a) {
    currentAlbum = a;
    shown = gridPhotos(a);
    section = a.section;
    updateChips();
    root.classList.add('in-album');
    clearTimeout(slider.timer);
    viewEl.innerHTML = `
      <div class="album-banner">
        <a class="album-back" href="${esc(location.pathname)}" data-back>&#8592; ${esc(sectionName(a.section))}</a>
        ${bannerHTML(a, 'h2')}
      </div>
      <div class="photo-grid">${shown.map((p, i) => {
        const w = Number(p.w) || 0, h = Number(p.h) || 0, ratio = w && h ? (w / h).toFixed(4) : '1.5';
        return `
        <a class="photo-tile" href="${esc(p.src)}" data-id="${esc(p.id)}" data-ratio="${esc(ratio)}" aria-label="${esc(photoLabel(p, a, i))}">
          <img src="${esc(p.thumb)}" alt="${esc(photoLabel(p, a, i))}" width="${esc(w)}" height="${esc(h)}" loading="lazy" decoding="async">
        </a>`; }).join('')}</div>`;
    grid = viewEl.querySelector('.photo-grid');
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
  function parseHash() {
    const m = location.hash.match(/^#([^/]+)(?:\/([^/]+))?$/);
    return m ? { album: m[1], photo: m[2] || null } : { album: null, photo: null };
  }
  const hashFor = (albumId, photoId) => albumId ? '#' + albumId + (photoId ? '/' + photoId : '') : location.pathname + location.search;

  function applyRoute(r, { animate = true } = {}) {
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
    clearTimeout(slider.timer);
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

    const dot = e.target.closest('.featured-dot');
    if (dot) { goToSlide(+dot.dataset.i); return; }
    if (e.target.closest('.featured-prev')) { goToSlide(slider.idx - 1); return; }
    if (e.target.closest('.featured-next')) { goToSlide(slider.idx + 1); return; }

    const feat = e.target.closest('.featured-link');
    if (feat) {
      if (slideSwipe === 'done') { e.preventDefault(); return; } // a swipe, not a click
      e.preventDefault();
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
      <a class="pv-original" target="_blank" rel="noopener">Open original &#8599;</a>
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
  const original    = $('.pv-original');

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
    original.href = p.src;
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
    // Mouse: a click on the dark area around the photo closes; the photo itself zooms on double-click
    if (!overImg(e.clientX, e.clientY)) closeViewer();
  }

  // Pointer capture retargets click/dblclick to the stage, so test the point against the photo's box
  const overImg = (x, y) => { const r = img.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  stage.addEventListener('dblclick', e => {
    if (overImg(e.clientX, e.clientY)) toggleZoomAt(e.clientX, e.clientY);
  });

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
