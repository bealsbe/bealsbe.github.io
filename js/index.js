'use strict';

const cnvs = document.querySelector('canvas');
const ctx  = cnvs.getContext('2d');

let W, H, cx, cy;

function resize() {
  W = cnvs.width  = innerWidth;
  H = cnvs.height = innerHeight;
  cx = W / 2;
  cy = H / 2;
}

resize();
window.addEventListener('resize', () => { resize(); });

const imgEls   = Array.from(document.querySelectorAll('.images img'));
const COUNT    = 60;
const FOCAL    = 320;   // perspective focal length
const Z_FAR    = 2000;  // spawn distance
const Z_NEAR   = 60;    // cull distance (before sprite gets too large)
const SPREAD   = 1800;  // X/Y spread at spawn
const BASE_SZ  = 0.25;  // base image scale multiplier

let sprites = [];

function randomSprite(spreadZ) {
  return {
    x:     (Math.random() - 0.5) * SPREAD,
    y:     (Math.random() - 0.5) * SPREAD,
    z:     spreadZ ? Math.random() * Z_FAR : Z_FAR,
    speed: Math.random() * 0.8 + 0.3,
    img:   imgEls[Math.floor(Math.random() * imgEls.length)],
  };
}

window.addEventListener('load', () => {
  for (let i = 0; i < COUNT; i++) sprites.push(randomSprite(true));
  draw();
});

// Colors with good contrast against dark backgrounds
const BG_COLORS_SRC = [
  [  0, 180, 150],  // teal
  [ 20, 170,  90],  // green
  [ 20, 150, 210],  // cyan
  [110,  40, 210],  // purple
  [ 40,  80, 220],  // deep blue
  [190,  20, 150],  // magenta
];
// Fisher-Yates shuffle
const BG_COLORS = [...BG_COLORS_SRC];
for (let i = BG_COLORS.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [BG_COLORS[i], BG_COLORS[j]] = [BG_COLORS[j], BG_COLORS[i]];
}
let colorTime = 0;

function draw() {
  ctx.clearRect(0, 0, W, H);

  // Slowly cycle: black → color → black
  colorTime += 1 / 900; // ~15s per color at 60fps
  const cyclePos  = colorTime % BG_COLORS.length;
  const idx       = Math.floor(cyclePos);
  const t         = cyclePos - idx;
  const intensity = Math.sin(t * Math.PI) * 0.14; // subtle tint, max 14%
  const [r, g, b] = BG_COLORS[idx % BG_COLORS.length];

  ctx.fillStyle = `rgb(${Math.round(10 + r * intensity)}, ${Math.round(10 + g * intensity)}, ${Math.round(18 + b * intensity)})`;
  ctx.fillRect(0, 0, W, H);

  // Draw back-to-front so closer sprites appear on top
  sprites.sort((a, b) => b.z - a.z);

  for (const s of sprites) {
    // Accelerate as it approaches (feels like real perspective)
    s.speed += 0.003;
    s.z -= s.speed;

    if (s.z <= Z_NEAR) {
      Object.assign(s, randomSprite(false));
      continue;
    }

    // Perspective projection
    const scale = (FOCAL / s.z) * BASE_SZ;
    const sx    = cx + (s.x / s.z) * FOCAL;
    const sy    = cy + (s.y / s.z) * FOCAL;
    const w     = s.img.naturalWidth  * scale;
    const h     = s.img.naturalHeight * scale;

    // Cull off-screen sprites early
    if (sx + w < 0 || sx - w > W || sy + h < 0 || sy - h > H) {
      Object.assign(s, randomSprite(false));
      continue;
    }

    // Fade in from far distance, fade out as they get very close
    const tFar   = Math.min(1, (Z_FAR - s.z) / (Z_FAR * 0.25));
    const tNear  = Math.min(1, (s.z - Z_NEAR) / (Z_NEAR * 2));
    const alpha  = tFar * tNear;

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.drawImage(s.img, sx - w / 2, sy - h / 2, w, h);
    ctx.restore();
  }

  requestAnimationFrame(draw);
}
