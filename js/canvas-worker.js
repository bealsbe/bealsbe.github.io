'use strict';

const BG_COLORS_SRC = [
  [  0, 180, 150],  // teal
  [ 20, 170,  90],  // green
  [ 20, 150, 210],  // cyan
  [110,  40, 210],  // purple
  [ 40,  80, 220],  // deep blue
  [190,  20, 150],  // magenta
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

let ctx, W, H, cx, cy;
let bitmaps = [];
let sprites = [];
let colorTime = 0.5;

function randomSprite(spreadZ) {
  return {
    x:     (Math.random() - 0.5) * SPREAD,
    y:     (Math.random() - 0.5) * SPREAD,
    z:     spreadZ ? Math.random() * Z_FAR : Z_FAR,
    speed: Math.random() * 0.8 + 0.3,
    img:   bitmaps[Math.floor(Math.random() * bitmaps.length)],
  };
}

// Mutate an existing sprite in-place to avoid allocating a new object each reset
function resetSprite(s, spreadZ) {
  s.x     = (Math.random() - 0.5) * SPREAD;
  s.y     = (Math.random() - 0.5) * SPREAD;
  s.z     = spreadZ ? Math.random() * Z_FAR : Z_FAR;
  s.speed = Math.random() * 0.8 + 0.3;
  s.img   = bitmaps[Math.floor(Math.random() * bitmaps.length)];
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  colorTime += 1 / 1400;
  const cyclePos  = colorTime % BG_COLORS.length;
  const idx       = Math.floor(cyclePos);
  const t         = cyclePos - idx;
  const pulseWindow = 0.38;
  const pulse     = t < pulseWindow ? Math.sin((t / pulseWindow) * Math.PI) : 0;
  const intensity = pulse * 0.22;
  const [r, g, b] = BG_COLORS[idx % BG_COLORS.length];

  ctx.fillStyle = `rgb(${Math.round(10 + r * intensity)}, ${Math.round(10 + g * intensity)}, ${Math.round(18 + b * intensity)})`;
  ctx.fillRect(0, 0, W, H);

  sprites.sort((a, b) => b.z - a.z);

  for (const s of sprites) {
    s.speed += 0.003;
    s.z -= s.speed;

    if (s.z <= Z_NEAR) {
      resetSprite(s, false);
      continue;
    }

    const scale = (FOCAL / s.z) * BASE_SZ;
    const sx    = cx + (s.x / s.z) * FOCAL;
    const sy    = cy + (s.y / s.z) * FOCAL;
    const w     = s.img.width  * scale;
    const h     = s.img.height * scale;

    if (sx + w < 0 || sx - w > W || sy + h < 0 || sy - h > H) {
      resetSprite(s, false);
      continue;
    }

    const tFar  = Math.min(1, (Z_FAR - s.z) / (Z_FAR * 0.25));
    const tNear = Math.min(1, (s.z - Z_NEAR) / (Z_NEAR * 2));
    ctx.globalAlpha = Math.max(0, tFar * tNear);
    ctx.drawImage(s.img, sx - w / 2, sy - h / 2, w, h);
  }

  ctx.globalAlpha = 1;

  requestAnimationFrame(draw);
}

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    const { canvas, bitmaps: imgs, width, height } = data;
    ctx     = canvas.getContext('2d');
    bitmaps = imgs;
    W = canvas.width  = width;
    H = canvas.height = height;
    cx = W / 2;
    cy = H / 2;
    for (let i = 0; i < COUNT; i++) sprites.push(randomSprite(true));
    draw();
  }

  if (data.type === 'resize') {
    W = ctx.canvas.width  = data.width;
    H = ctx.canvas.height = data.height;
    cx = W / 2;
    cy = H / 2;
  }
};
