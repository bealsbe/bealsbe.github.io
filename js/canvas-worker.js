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

const COUNT      = 30;
const STAR_COUNT = 80;
const FOCAL      = 320;
const Z_FAR      = 2000;
const Z_NEAR     = 60;
const SPREAD     = 1800;
const BASE_SZ    = 0.25;

let ctx, W, H, cx, cy;
let bitmaps = [];
let sprites = [];
let stars   = [];
let colorTime   = 0.5;
let colorFadeIn = 0;
let lineAlphas  = new Map(); // key: "i,j" → current fade alpha

function randomSprite(spreadZ) {
  const speed = Math.random() * 0.5 + 0.2;
  const img   = bitmaps[Math.floor(Math.random() * bitmaps.length)];
  if (!spreadZ) {
    return { x: (Math.random() - 0.5) * SPREAD, y: (Math.random() - 0.5) * SPREAD, z: Z_FAR, speed, img };
  }
  const z  = Z_NEAR * 3 + Math.random() * (Z_FAR * 0.85 - Z_NEAR * 3);
  const sx = (Math.random() - 0.5) * (W || 1920);
  const sy = (Math.random() - 0.5) * (H || 1080);
  return { x: sx * z / FOCAL, y: sy * z / FOCAL, z, speed, img };
}

function resetSprite(s, spreadZ) {
  s.x     = (Math.random() - 0.5) * SPREAD;
  s.y     = (Math.random() - 0.5) * SPREAD;
  s.z     = spreadZ ? Math.random() * Z_FAR : Z_FAR;
  s.speed = Math.random() * 0.8 + 0.3;
  s.img   = bitmaps[Math.floor(Math.random() * bitmaps.length)];
}

function randomStar(spreadZ) {
  const speed      = Math.random() * 0.04 + 0.01;
  const size       = Math.random() * 1.2 + 0.4;
  const phase      = Math.random() * Math.PI * 2;
  const twinkleSpd = Math.random() * 30 + 15;
  if (!spreadZ) {
    return { x: (Math.random() - 0.5) * SPREAD * 1.4, y: (Math.random() - 0.5) * SPREAD * 1.4, z: Z_FAR, speed, size, phase, twinkleSpd, fadeIn: 1 };
  }
  const z  = Z_NEAR * 3 + Math.random() * (Z_FAR * 0.85 - Z_NEAR * 3);
  const sx = (Math.random() - 0.5) * (W || 1920);
  const sy = (Math.random() - 0.5) * (H || 1080);
  return { x: sx * z / FOCAL, y: sy * z / FOCAL, z, speed, size, phase, twinkleSpd, fadeIn: 1 };
}

function resetStar(s) {
  s.z          = Z_NEAR * 3 + Math.random() * (Z_FAR * 0.85 - Z_NEAR * 3);
  const sx     = (Math.random() - 0.5) * (W || 1920);
  const sy     = (Math.random() - 0.5) * (H || 1080);
  s.x          = sx * s.z / FOCAL;
  s.y          = sy * s.z / FOCAL;
  s.speed      = Math.random() * 0.04 + 0.01;
  s.size       = Math.random() * 1.2 + 0.4;
  s.phase      = Math.random() * Math.PI * 2;
  s.twinkleSpd = Math.random() * 30 + 15;
  s.fadeIn     = 0;
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  colorFadeIn = Math.min(1, colorFadeIn + 1 / 1800);
  colorTime += 1 / 1400;
  const cyclePos  = colorTime % BG_COLORS.length;
  const idx       = Math.floor(cyclePos);
  const t         = cyclePos - idx;
  const pulseWindow = 0.38;
  const pulse     = t < pulseWindow ? Math.sin((t / pulseWindow) * Math.PI) : 0;
  const intensity = pulse * 0.12 * colorFadeIn;
  const [r, g, b] = BG_COLORS[idx % BG_COLORS.length];

  ctx.fillStyle = `rgb(${Math.round(10 + r * intensity)}, ${Math.round(10 + g * intensity)}, ${Math.round(18 + b * intensity)})`;
  ctx.fillRect(0, 0, W, H);

  sprites.sort((a, b) => b.z - a.z);

  for (const s of sprites) {
    s.speed += 0.002;
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

  const starDraws = [];
  for (const s of stars) {
    s.speed += 0.0002;
    s.z -= s.speed;
    s.sx = null;

    if (s.z <= Z_NEAR) { resetStar(s); continue; }

    const sx = cx + (s.x / s.z) * FOCAL;
    const sy = cy + (s.y / s.z) * FOCAL;

    if (sx < 0 || sx > W || sy < 0 || sy > H) { resetStar(s); continue; }

    s.fadeIn = Math.min(1, (s.fadeIn ?? 1) + 0.008);
    const tFar    = Math.min(1, (Z_FAR - s.z) / (Z_FAR * 0.25));
    const tNear   = Math.min(1, (s.z - Z_NEAR) / (Z_NEAR * 2));
    const twinkle = 0.7 + 0.3 * Math.sin(colorTime * s.twinkleSpd + s.phase);
    const alpha   = Math.max(0, tFar * tNear * twinkle * s.fadeIn);
    const r       = Math.max(0.3, s.size * (FOCAL / s.z));

    s.sx = sx; s.sy = sy; s.alpha = alpha;
    if (alpha > 0) starDraws.push({ sx, sy, r, alpha });
  }

  // Batch draws — sort by alpha, one beginPath per similar-alpha group
  starDraws.sort((a, b) => a.alpha - b.alpha);
  ctx.fillStyle = '#ffffff';
  let di = 0;
  while (di < starDraws.length) {
    const baseAlpha = starDraws[di].alpha;
    ctx.globalAlpha = baseAlpha;
    ctx.beginPath();
    while (di < starDraws.length && starDraws[di].alpha - baseAlpha < 0.04) {
      const d = starDraws[di++];
      ctx.moveTo(d.sx + d.r, d.sy);
      ctx.arc(d.sx, d.sy, d.r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // Build adjacency from screen-space proximity
  const CONNECT_DIST_SQ = 160 * 160;
  const FADE_IN  = 0.018;
  const FADE_OUT = 0.007;
  const adj = new Map();
  for (let i = 0; i < stars.length; i++) {
    if (stars[i].sx == null) continue;
    for (let j = i + 1; j < stars.length; j++) {
      if (stars[j].sx == null) continue;
      const dx = stars[i].sx - stars[j].sx, dy = stars[i].sy - stars[j].sy;
      if (dx * dx + dy * dy > CONNECT_DIST_SQ) continue;
      if (!adj.has(i)) adj.set(i, []);
      if (!adj.has(j)) adj.set(j, []);
      adj.get(i).push(j);
      adj.get(j).push(i);
    }
  }

  // BFS — only activate edges in components of size >= 3
  const visited = new Set();
  const activeEdges = new Set();
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const component = [], queue = [start];
    while (queue.length) {
      const node = queue.shift();
      if (visited.has(node)) continue;
      visited.add(node); component.push(node);
      for (const nb of adj.get(node)) { if (!visited.has(nb)) queue.push(nb); }
    }
    if (component.length >= 3 && component.length <= 6) {
      for (const node of component)
        for (const nb of adj.get(node))
          if (nb > node) activeEdges.add(node * STAR_COUNT + nb);
    }
  }

  // Fade alphas toward target
  for (const [key, val] of lineAlphas) {
    const next = activeEdges.has(key) ? Math.min(1, val + FADE_IN) : val - FADE_OUT;
    if (next <= 0) { lineAlphas.delete(key); continue; }
    lineAlphas.set(key, next);
    activeEdges.delete(key);
  }
  for (const key of activeEdges) lineAlphas.set(key, FADE_IN);

  // Draw lines
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = '#ffffff';
  for (const [key, lineAlpha] of lineAlphas) {
    const ai = (key / STAR_COUNT) | 0, bi = key % STAR_COUNT;
    const a = stars[ai], b = stars[bi];
    if (!a || !b || a.sx == null || b.sx == null) { lineAlphas.delete(key); continue; }
    ctx.globalAlpha = Math.min(a.alpha, b.alpha) * lineAlpha * 0.25;
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();
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
    for (let i = 0; i < STAR_COUNT; i++) stars.push(randomStar(true));
    draw();
  }

  if (data.type === 'resize') {
    W = ctx.canvas.width  = data.width;
    H = ctx.canvas.height = data.height;
    cx = W / 2;
    cy = H / 2;
  }
};
