'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;

  const links = Array.from(nav.querySelectorAll('.nav-link'));
  let activeLink = nav.querySelector('.nav-link.active');

  // Capture each link's resolved URL NOW, before any pushState changes the base
  const linkURLs = new Map();
  links.forEach(link => linkURLs.set(link, link.href));

  // --- Sliding pill ---
  const pill = document.createElement('div');
  pill.className = 'nav-pill';
  nav.appendChild(pill);

  function movePillTo(el, instant) {
    const navRect = nav.getBoundingClientRect();
    const elRect  = el.getBoundingClientRect();
    if (instant) pill.style.transition = 'none';
    pill.style.left   = (elRect.left - navRect.left) + 'px';
    pill.style.top    = (elRect.top  - navRect.top)  + 'px';
    pill.style.width  = elRect.width  + 'px';
    pill.style.height = elRect.height + 'px';
    if (instant) requestAnimationFrame(() => { pill.style.transition = ''; });
  }

  if (activeLink) movePillTo(activeLink, true);

  links.forEach(link => link.addEventListener('mouseenter', () => movePillTo(link, false)));
  nav.addEventListener('mouseleave', () => { if (activeLink) movePillTo(activeLink, false); });

  // --- SPA fetch navigation ---
  async function navigateTo(absUrl, pushState = true) {
    document.body.classList.add('page-exit');

    let html;
    try {
      const [res] = await Promise.all([
        fetch(absUrl),
        new Promise(r => setTimeout(r, 280))
      ]);
      html = await res.text();
    } catch {
      window.location.href = absUrl;
      return;
    }

    const newDoc  = new DOMParser().parseFromString(html, 'text/html');
    const newCard = newDoc.querySelector('.profile-card');
    const curCard = document.querySelector('.profile-card');
    if (!newCard || !curCard) { window.location.href = absUrl; return; }

    // Push state BEFORE swapping card so relative image URLs in the new card
    // resolve against the correct base URL (not the previous page's URL).
    if (pushState) history.pushState({ absUrl }, '', absUrl);

    // Remove page-exit before inserting new card so it only gets card-enter
    document.body.classList.remove('page-exit');

    curCard.replaceWith(newCard);
    document.title = newDoc.title;

    const targetPath = new URL(absUrl).pathname;
    links.forEach(link => {
      const linkPath = new URL(linkURLs.get(link)).pathname;
      link.classList.toggle('active', linkPath === targetPath);
    });
    activeLink = nav.querySelector('.nav-link.active');
    if (activeLink) movePillTo(activeLink, false);
  }

  links.forEach(link => {
    link.addEventListener('click', e => {
      if (link.classList.contains('active')) return;
      e.preventDefault();
      movePillTo(link, false);
      navigateTo(linkURLs.get(link));
    });
  });

  window.addEventListener('popstate', e => {
    const url = e.state?.absUrl || window.location.href;
    navigateTo(url, false);
  });

  // Hide nav on scroll, show when back at top
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    nav.classList.toggle('nav-hidden', y > 20);
    lastScroll = y;
  }, { passive: true });
});
