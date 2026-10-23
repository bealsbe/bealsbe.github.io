'use strict';

/* Where the photography section gets its data: the manifest.json in the R2 bucket.
   Fetches <base><manifest> and prefixes every relative src/thumb with <base>; absolute URLs in the
   manifest are left alone. The manifest (and the bucket) is built by the desktop app in
   ../beals-site-manager (sibling project, not part of this repo); its docs/manifest.md documents
   the shape. This file defines the globals PHOTO_SECTIONS, PHOTO_ALBUMS and PHOTO_FEATURED that
   js/photos.js reads once PHOTO_DATA_READY settles ('manifest' on success, 'error' otherwise, in
   which case the globals are empty and the page shows a message instead of albums).
   Dev override: open /photos/?manifest=<url> (or ?manifest=default); remembered per tab. Only
   URLs on this site's origin or the configured bucket origin are accepted, so a crafted link can't
   point the page at someone else's manifest. */
var PHOTO_SECTIONS = [];
var PHOTO_ALBUMS = [];
var PHOTO_FEATURED = [];

const PHOTO_SOURCE = {
  base: 'https://photos.beals.link/',        // bucket public URL (R2 custom domain), trailing slash
  manifest: 'manifest.json',
  // Optional thumbnail template used instead of the manifest's thumb paths, e.g. Cloudflare
  // transformations on the bucket's custom domain: '{base}cdn-cgi/image/width=600,format=auto/{src}'
  thumb: null,
};

// Resolves once PHOTO_SECTIONS / PHOTO_ALBUMS are final. js/photos.js waits on it.
const PHOTO_DATA_READY = (async () => {
  let override = null;
  try {
    const q = new URLSearchParams(location.search).get('manifest');
    if (q) sessionStorage.setItem('photoManifest', q);
    override = sessionStorage.getItem('photoManifest');
  } catch {}

  let url = null;
  if (override && override !== 'default') url = allowedManifestURL(override);
  if (!url) url = PHOTO_SOURCE.base + PHOTO_SOURCE.manifest;

  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const m = await res.json();
    const base = url === PHOTO_SOURCE.base + PHOTO_SOURCE.manifest ? PHOTO_SOURCE.base : url.replace(/[^/]*$/, '');  // url is already origin-checked
    const data = manifestToData(m, base);
    window.PHOTO_SECTIONS = data.sections;
    window.PHOTO_ALBUMS = data.albums;
    window.PHOTO_FEATURED = data.featured;
    return 'manifest';
  } catch (e) {
    console.warn('Photo manifest unavailable:', url, e.message);
    return 'error';
  }
})();

// Accepts a manifest URL only on this page's origin or the bucket's origin
function allowedManifestURL(raw) {
  try {
    const u = new URL(raw, location.href);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const bucketOrigin = new URL(PHOTO_SOURCE.base).origin;
    return (u.origin === location.origin || u.origin === bucketOrigin) ? u.href : null;
  } catch { return null; }
}

// Normalise the manifest into the shape js/photos.js uses. Everything is treated as untrusted:
// strings are coerced, numbers bounded, and URLs resolved against the bucket and limited to http(s).
function manifestToData(m, base) {
  if (!m || m.version !== 1 || !Array.isArray(m.albums) || !Array.isArray(m.sections)) throw new Error('unexpected manifest shape');
  const str = v => (v === undefined || v === null) ? '' : String(v);
  const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 100000 ? n : 0; };
  const url = p => {
    try {
      const u = new URL(str(p).replace(/^\//, ''), base);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
    } catch { return null; }
  };
  const thumbFor = p => PHOTO_SOURCE.thumb
    ? url(PHOTO_SOURCE.thumb.replace('{base}', base).replace('{src}', str(p.src).replace(/^\//, '')))
    : url(p.thumb || p.src);
  // Optional subject point for cropped covers, {x, y} in 0..1 (set by the manager app, if ever)
  const focusOf = f => {
    if (!f || typeof f !== 'object') return null;
    const x = Number(f.x), y = Number(f.y);
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  };
  const exifOf = x => {
    if (!x || typeof x !== 'object') return null;
    const out = {};
    for (const k of ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso']) if (x[k] !== undefined && x[k] !== null && x[k] !== '') out[k] = str(x[k]).slice(0, 120);
    return Object.keys(out).length ? out : null;
  };

  const sections = m.sections.map(s => ({ id: str(s.id), name: str(s.name) || str(s.id) })).filter(s => s.id);
  const albums = m.albums.map(a => {
    const photos = (Array.isArray(a.photos) ? a.photos : []).map(p => {
      const w = num(p.w), h = num(p.h), src = url(p.src), thumb = thumbFor(p);
      if (!str(p.id) || !w || !h || !src || !thumb) return null;   // skip anything the grid can't lay out
      return {
        id: str(p.id),
        file: str(p.file),
        title: str(p.title).slice(0, 200),
        caption: str(p.caption).slice(0, 1000),
        w, h, src, thumb,
        focus: focusOf(p.focus),
        exif: exifOf(p.exif),
      };
    }).filter(Boolean);
    return {
      id: str(a.id),
      section: str(a.section),
      folder: str(a.folder),
      name: str(a.name).slice(0, 200) || str(a.id),
      date: str(a.date).slice(0, 10),
      location: str(a.location).slice(0, 200),
      description: str(a.description).slice(0, 1000),
      cover: str(a.cover),
      photos,
    };
  }).filter(a => a.id && a.photos.length);
  // Slider entries: keep only those that point at an album photo that survived the checks above
  const featured = (Array.isArray(m.featured) ? m.featured : []).map(f => ({ album: str(f && f.album), photo: str(f && f.photo) }))
    .filter(f => { const a = albums.find(x => x.id === f.album); return a && a.photos.some(p => p.id === f.photo); });
  return { sections, albums, featured };
}
