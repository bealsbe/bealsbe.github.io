'use strict';

// --- Avatar tip ---
const tip = document.createElement('div');
tip.id = 'avatar-tip';
tip.textContent = 'Art by Silvixen';
document.body.appendChild(tip);

let avatarTipTimeout;
document.body.addEventListener('click', e => {
  const link = e.target.closest('.avatar-link');
  if (!link) {
    tip.classList.remove('visible');
    return;
  }
  const r = link.getBoundingClientRect();
  tip.style.left = (r.left + r.width / 2) + 'px';
  tip.style.top  = (r.top - 36) + 'px';
  tip.classList.add('visible');
  clearTimeout(avatarTipTimeout);
  avatarTipTimeout = setTimeout(() => tip.classList.remove('visible'), 2500);
});

// --- Toast ---
const toast = document.createElement('div');
toast.className = 'toast';
toast.textContent = 'Copied to clipboard!';
document.body.appendChild(toast);
let toastTimeout;
function showToast() {
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2000);
}

// --- Discord modal ---
const discordOverlay = document.createElement('div');
discordOverlay.className = 'discord-overlay';
discordOverlay.innerHTML = `
  <div class="discord-modal">
    <button class="discord-modal-close" aria-label="Close">&times;</button>
    <p class="discord-modal-label">Discord</p>
    <p class="discord-modal-username">beals</p>
  </div>
`;
document.body.appendChild(discordOverlay);

const discordClose = discordOverlay.querySelector('.discord-modal-close');

function openDiscordModal()  { discordOverlay.classList.add('visible'); }
function closeDiscordModal() { discordOverlay.classList.remove('visible'); }

document.body.addEventListener('click', e => {
  if (e.target.closest('#discord-btn')) {
    e.preventDefault();
    navigator.clipboard?.writeText('beals');
    showToast();
    openDiscordModal();
  }
});

discordClose.addEventListener('click', closeDiscordModal);
discordOverlay.addEventListener('click', e => {
  if (e.target === discordOverlay) closeDiscordModal();
});

// --- Hex swatch copy ---
function copyHex(btn, hex) {
  navigator.clipboard.writeText(hex);
  const span = btn.querySelector('.swatch-hex');
  const prev = span.textContent;
  span.textContent = 'Copied!';
  btn.style.opacity = '0.8';
  setTimeout(() => { span.textContent = prev; btn.style.opacity = ''; }, 1200);
}

const cnvs   = document.querySelector('canvas');
const imgEls = Array.from(document.querySelectorAll('.images img'));

window.addEventListener('load', async () => {
  // --- OffscreenCanvas path (moves animation off the main thread) ---
  if (typeof OffscreenCanvas !== 'undefined' && cnvs.transferControlToOffscreen) {
    try {
      const bitmaps  = await Promise.all(imgEls.map(img => createImageBitmap(img)));
      const offscreen = cnvs.transferControlToOffscreen();
      const worker    = new Worker('/js/canvas-worker.js');

      worker.postMessage(
        { type: 'init', canvas: offscreen, bitmaps, width: innerWidth, height: innerHeight },
        [offscreen, ...bitmaps]
      );

      window.addEventListener('resize', () => {
        worker.postMessage({ type: 'resize', width: innerWidth, height: innerHeight });
      });

      return; // worker owns the canvas from here
    } catch {
      // fall through to main-thread fallback
    }
  }

  // --- Main-thread fallback ---
  const ctx = cnvs.getContext('2d');
  let W, H, cx, cy;

  function resize() {
    W = cnvs.width  = innerWidth;
    H = cnvs.height = innerHeight;
    cx = W / 2;
    cy = H / 2;
  }
  resize();
  window.addEventListener('resize', resize);

  const BG_COLORS_SRC = [
    [  0, 180, 150],
    [ 20, 170,  90],
    [ 20, 150, 210],
    [110,  40, 210],
    [ 40,  80, 220],
    [190,  20, 150],
  ];
  const BG_COLORS = [...BG_COLORS_SRC];
  for (let i = BG_COLORS.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [BG_COLORS[i], BG_COLORS[j]] = [BG_COLORS[j], BG_COLORS[i]];
  }

  const COUNT   = 60;
  const FOCAL   = 320;
  const Z_FAR   = 2000;
  const Z_NEAR  = 60;
  const SPREAD  = 1800;
  const BASE_SZ = 0.25;

  let colorTime = 0;
  const sprites = [];

  function randomSprite(spreadZ) {
    return {
      x:     (Math.random() - 0.5) * SPREAD,
      y:     (Math.random() - 0.5) * SPREAD,
      z:     spreadZ ? Math.random() * Z_FAR : Z_FAR,
      speed: Math.random() * 0.8 + 0.3,
      img:   imgEls[Math.floor(Math.random() * imgEls.length)],
    };
  }

  for (let i = 0; i < COUNT; i++) sprites.push(randomSprite(true));

  function draw() {
    ctx.clearRect(0, 0, W, H);

    colorTime += 1 / 900;
    const cyclePos  = colorTime % BG_COLORS.length;
    const idx       = Math.floor(cyclePos);
    const t         = cyclePos - idx;
    const intensity = Math.sin(t * Math.PI) * 0.14;
    const [r, g, b] = BG_COLORS[idx % BG_COLORS.length];

    ctx.fillStyle = `rgb(${Math.round(10 + r * intensity)}, ${Math.round(10 + g * intensity)}, ${Math.round(18 + b * intensity)})`;
    ctx.fillRect(0, 0, W, H);

    sprites.sort((a, b) => b.z - a.z);

    for (const s of sprites) {
      s.speed += 0.003;
      s.z -= s.speed;

      if (s.z <= Z_NEAR) { Object.assign(s, randomSprite(false)); continue; }

      const scale = (FOCAL / s.z) * BASE_SZ;
      const sx    = cx + (s.x / s.z) * FOCAL;
      const sy    = cy + (s.y / s.z) * FOCAL;
      const w     = s.img.naturalWidth  * scale;
      const h     = s.img.naturalHeight * scale;

      if (sx + w < 0 || sx - w > W || sy + h < 0 || sy - h > H) {
        Object.assign(s, randomSprite(false)); continue;
      }

      const tFar  = Math.min(1, (Z_FAR - s.z) / (Z_FAR * 0.25));
      const tNear = Math.min(1, (s.z - Z_NEAR) / (Z_NEAR * 2));
      ctx.save();
      ctx.globalAlpha = Math.max(0, tFar * tNear);
      ctx.drawImage(s.img, sx - w / 2, sy - h / 2, w, h);
      ctx.restore();
    }

    requestAnimationFrame(draw);
  }

  draw();
});
