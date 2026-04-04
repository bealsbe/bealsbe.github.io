'use strict';

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
