'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;

  const links = Array.from(nav.querySelectorAll('.nav-link'));

  // Capture each link's resolved URL NOW, before any pushState changes the base
  const linkURLs = new Map();
  links.forEach(link => linkURLs.set(link, link.href));

  // Same for stylesheets: once the URL changes, a relative <link>'s .href reports the wrong address,
  // so record what's loaded now and keep the set up to date
  const loadedSheets = new Set(
    Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.href)
  );

  const normPath = p => p.replace(/index\.html$/, '').replace(/\/$/, '') || '/';
  const pathOf = url => normPath(new URL(url).pathname);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Transition style, for comparing options: load any page with ?t=morph, ?t=slide or ?t=fade.
  // The choice is remembered for this tab. morph/slide need the View Transitions API; otherwise fade.
  let style = 'morph';
  try {
    const fromUrl = new URLSearchParams(location.search).get('t');
    if (fromUrl) sessionStorage.setItem('transition', fromUrl);
    style = sessionStorage.getItem('transition') || style;
  } catch {}
  if (!['morph', 'slide', 'fade'].includes(style)) style = 'morph';
  const canViewTransition = typeof document.startViewTransition === 'function';
  if (style !== 'fade' && !canViewTransition) style = 'fade';

  const wait = ms => new Promise(r => setTimeout(r, ms));

  // Fetch and decode every image in the incoming card so nothing pops in (or resizes the card) after it appears
  function preloadImages(card, baseUrl) {
    return Promise.all(Array.from(card.querySelectorAll('img')).map(img => {
      const im = new Image();
      im.src = new URL(img.getAttribute('src'), baseUrl).href;
      return im.decode().catch(() => {});
    }));
  }

  function setActive(absUrl) {
    const target = pathOf(absUrl);
    links.forEach(link => link.classList.toggle('active', pathOf(linkURLs.get(link)) === target));
  }

  // --- SPA fetch navigation ---
  let navigating = false;
  async function navigateTo(absUrl, pushState = true) {
    if (navigating) return;
    navigating = true;

    // Direction follows the tab order (Home, then Character Ref)
    const order = links.map(l => pathOf(linkURLs.get(l)));
    const forward = order.indexOf(pathOf(absUrl)) >= order.indexOf(pathOf(location.href));

    // Move the underline right away so the click feels answered
    setActive(absUrl);

    const useFade = style === 'fade' || reduceMotion;
    if (useFade) document.body.classList.add('page-exit');

    let newDoc, newCard;
    try {
      // Fetch the page and its images (capped at 600ms) while the old card fades out
      const exitDone = useFade ? wait(180) : Promise.resolve();
      const res = await fetch(absUrl);
      newDoc  = new DOMParser().parseFromString(await res.text(), 'text/html');
      newCard = newDoc.querySelector('.profile-card');
      if (newCard) {
        await Promise.all([exitDone, Promise.race([preloadImages(newCard, absUrl), wait(600)])]);
      }
    } catch {
      window.location.href = absUrl;
      return;
    }

    const curCard = document.querySelector('.profile-card');
    if (!newCard || !curCard) { window.location.href = absUrl; return; }

    // Inject any stylesheets the new page needs that aren't already loaded
    newDoc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const href = new URL(link.getAttribute('href'), absUrl).href;  // relative to the new page, not this one
      if (!loadedSheets.has(href)) {
        loadedSheets.add(href);
        link.href = href;
        document.head.appendChild(document.adoptNode(link));
      }
    });

    const swap = () => {
      // Push state BEFORE swapping card so relative image URLs in the new card
      // resolve against the correct base URL (not the previous page's URL).
      if (pushState) history.pushState({ absUrl }, '', absUrl);
      document.body.classList.remove('page-exit');
      curCard.replaceWith(newCard);
      window.scrollTo(0, 0);
      document.title = newDoc.title;
    };

    if (useFade) {
      // The nav sits above the card, so a taller or wider card moves it.
      // Measure before and after the swap, then slide it from the old spot (FLIP).
      const before = nav.getBoundingClientRect();
      swap();
      const after = nav.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!reduceMotion && (dx || dy)) {
        nav.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
        );
      }
    } else {
      // The browser snapshots the nav and card before and after, then animates between them (CSS: ::view-transition-*)
      const root = document.documentElement;
      root.dataset.vt = style;
      root.dataset.vtDir = forward ? 'fwd' : 'back';
      newCard.classList.add('no-enter');
      const vt = document.startViewTransition(swap);
      await vt.finished.catch(() => {});
      delete root.dataset.vt;
      delete root.dataset.vtDir;
    }

    navigating = false;
  }

  links.forEach(link => {
    link.addEventListener('click', e => {
      if (link.classList.contains('active')) return;
      e.preventDefault();
      navigateTo(linkURLs.get(link));
    });
  });

  window.addEventListener('popstate', e => {
    const url = e.state?.absUrl || window.location.href;
    navigateTo(url, false);
  });
});
