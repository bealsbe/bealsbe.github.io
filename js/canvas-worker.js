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

const COUNT      = 6;
const STAR_COUNT = 15;
const FOCAL      = 320;
const Z_FAR      = 2000;
const Z_NEAR     = 60;
const SPREAD     = 1800;
const BASE_SZ      = 0.18;
const N_CLUSTERS  = 3;
const MIN_CLUSTER = 3; // min stars per cluster (also caps orphan count)

let clusterCenters   = [];
let starAssignments  = [];

function initClusters() {
  clusterCenters = [];
  for (let i = 0; i < N_CLUSTERS; i++) {
    clusterCenters.push({
      sx:     (Math.random() - 0.5) * (W || 1920) * 0.6,
      sy:     (Math.random() - 0.5) * (H || 1080) * 0.6,
      spread: 150 + Math.random() * 150, // 150–300px, varies per cluster
    });
  }

  // Build assignment list: guarantee each cluster gets MIN_CLUSTER stars,
  // sprinkle remainder randomly, then add 0–(MIN_CLUSTER-1) orphans (-1)
  const maxOrphans  = MIN_CLUSTER - 1;
  const orphans     = Math.floor(Math.random() * (maxOrphans + 1));
  const assigned    = STAR_COUNT - orphans;

  starAssignments = [];
  for (let i = 0; i < N_CLUSTERS; i++)
    for (let j = 0; j < MIN_CLUSTER; j++)
      starAssignments.push(i);
  for (let i = N_CLUSTERS * MIN_CLUSTER; i < assigned; i++)
    starAssignments.push(Math.floor(Math.random() * N_CLUSTERS));
  for (let i = 0; i < orphans; i++)
    starAssignments.push(-1);

  // Shuffle
  for (let i = starAssignments.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [starAssignments[i], starAssignments[j]] = [starAssignments[j], starAssignments[i]];
  }
}

let ctx, W, H, cx, cy;
let bitmaps = [];
let sprites = [];
let stars   = [];
let colorTime   = 0.5;
let colorFadeIn = 0;
let lineAlphas  = new Map();

const FRAME_MS = 1000 / 30;
let lastFrame  = 0;
let rafId      = 0;

// Cached — recomputed only on resize (opt 4)
let connectDistSq = 0;
function updateConnectDist() {
  const d = Math.min(220, Math.min(W, H) * 0.26);
  connectDistSq = d * d;
}

// Pre-allocated frame temporaries — cleared each frame, never re-created (opt 2)
const starDraws   = [];
const lineDraws   = [];
const adj         = new Map();
const visited     = new Set();
const activeEdges = new Set();
const component   = [];
const queue       = [];

// Object pools — reused each frame, no per-frame allocation (opt 1)
const starPool  = Array.from({length: STAR_COUNT},     () => ({sx: 0, sy: 0, r: 0, alpha: 0}));
const linePool  = Array.from({length: STAR_COUNT * 4}, () => ({x1: 0, y1: 0, x2: 0, y2: 0, alpha: 0}));
// Adjacency list pool — inner arrays reused, not recreated (opt 2)
const adjPool   = Array.from({length: STAR_COUNT}, () => []);
let adjPoolIdx  = 0;

// BFS read-head — avoids queue.shift() O(n) cost (opt 3)
let qHead = 0;

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

function randomStar(spreadZ, cluster) {
  const speed      = Math.random() * 0.04 + 0.01;
  const size       = Math.random() * 1.2 + 0.4;
  const phase      = Math.random() * Math.PI * 2;
  const twinkleSpd = Math.random() * 30 + 15;
  const z = spreadZ
    ? Z_NEAR * 3 + Math.random() * (Z_FAR * 0.85 - Z_NEAR * 3)
    : Z_FAR;
  let targetSx, targetSy;
  if (cluster === -1) {
    targetSx = (Math.random() - 0.5) * (W || 1920);
    targetSy = (Math.random() - 0.5) * (H || 1080);
  } else {
    const c  = clusterCenters[cluster];
    targetSx = c.sx + (Math.random() - 0.5) * c.spread;
    targetSy = c.sy + (Math.random() - 0.5) * c.spread;
  }
  return { x: targetSx * z / FOCAL, y: targetSy * z / FOCAL, z, speed, size, phase, twinkleSpd, fadeIn: 1, cluster };
}

function resetStar(s) {
  s.z = Z_NEAR * 3 + Math.random() * (Z_FAR * 0.85 - Z_NEAR * 3);
  let targetSx, targetSy;
  if (s.cluster === -1) {
    targetSx = (Math.random() - 0.5) * (W || 1920);
    targetSy = (Math.random() - 0.5) * (H || 1080);
  } else {
    const c  = clusterCenters[s.cluster];
    targetSx = c.sx + (Math.random() - 0.5) * c.spread;
    targetSy = c.sy + (Math.random() - 0.5) * c.spread;
  }
  s.x          = targetSx * s.z / FOCAL;
  s.y          = targetSy * s.z / FOCAL;
  s.speed      = Math.random() * 0.04 + 0.01;
  s.size       = Math.random() * 1.2 + 0.4;
  s.phase      = Math.random() * Math.PI * 2;
  s.twinkleSpd = Math.random() * 30 + 15;
  s.fadeIn     = 0;
}

function draw() {
  rafId = requestAnimationFrame(draw);

  ctx.clearRect(0, 0, W, H);

  colorFadeIn = Math.min(1, colorFadeIn + 1 / 1800);
  colorTime += 1 / 1400;
  const cyclePos    = colorTime % BG_COLORS.length;
  const idx         = Math.floor(cyclePos);
  const t           = cyclePos - idx;
  const pulseWindow = 0.38;
  const pulse       = t < pulseWindow ? Math.sin((t / pulseWindow) * Math.PI) : 0;
  const intensity   = pulse * 0.12 * colorFadeIn;
  const [r, g, b]   = BG_COLORS[idx % BG_COLORS.length];

  ctx.fillStyle = `rgb(${Math.round(10 + r * intensity)}, ${Math.round(10 + g * intensity)}, ${Math.round(18 + b * intensity)})`;
  ctx.fillRect(0, 0, W, H);

  sprites.sort((a, b) => b.z - a.z);

  let lastAlpha = -1;
  for (const s of sprites) {
    s.speed += 0.002;
    s.z -= s.speed;

    if (s.z <= Z_NEAR) {
      resetSprite(s, false);
      continue;
    }

    const tFar  = Math.min(1, (Z_FAR - s.z) / (Z_FAR * 0.25));
    const tNear = Math.min(1, (s.z - Z_NEAR) / (Z_NEAR * 2));
    const alpha = tFar * tNear;
    if (alpha < 0.05) continue;

    const scale = (FOCAL / s.z) * BASE_SZ;
    const sx    = cx + (s.x / s.z) * FOCAL;
    const sy    = cy + (s.y / s.z) * FOCAL;
    const w     = s.img.width  * scale;
    const h     = s.img.height * scale;

    if (sx + w < 0 || sx - w > W || sy + h < 0 || sy - h > H) {
      resetSprite(s, false);
      continue;
    }

    if (Math.abs(alpha - lastAlpha) > 0.02) {
      ctx.globalAlpha = alpha;
      lastAlpha = alpha;
    }
    ctx.drawImage(s.img, sx - w / 2, sy - h / 2, w, h);
  }

  ctx.globalAlpha = 1;

  // Stars — fill pool objects in-place, no per-frame allocation (opt 1, opt 5)
  starDraws.length = 0;
  let starPoolIdx = 0;
  for (const s of stars) {
    s.speed += 0.0002;
    s.z -= s.speed;
    s.sx = null;

    if (s.z <= Z_NEAR) { resetStar(s); continue; }

    const sx = cx + (s.x / s.z) * FOCAL;
    const sy = cy + (s.y / s.z) * FOCAL;

    if (sx < 0 || sx > W || sy < 0 || sy > H) { resetStar(s); continue; }

    s.fadeIn = Math.min(1, s.fadeIn + 0.008); // opt 5: fadeIn always set, ?? 1 removed
    const tFar    = Math.min(1, (Z_FAR - s.z) / (Z_FAR * 0.25));
    const tNear   = Math.min(1, (s.z - Z_NEAR) / (Z_NEAR * 2));
    const twinkle = 0.7 + 0.3 * Math.sin(colorTime * s.twinkleSpd + s.phase);
    const alpha   = Math.max(0, tFar * tNear * twinkle * s.fadeIn);
    const rr      = Math.max(0.3, s.size * (FOCAL / s.z));

    s.sx = sx; s.sy = sy; s.alpha = alpha;
    if (alpha >= 0.05) {
      const d = starPool[starPoolIdx++];
      d.sx = sx; d.sy = sy; d.r = rr; d.alpha = alpha;
      starDraws.push(d);
    }
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

  // Build adjacency — use cached connectDistSq (opt 4), pool inner arrays (opt 2)
  const FADE_IN  = 0.018;
  const FADE_OUT = 0.007;
  adj.clear();
  adjPoolIdx = 0;
  for (let i = 0; i < stars.length; i++) {
    if (stars[i].sx == null) continue;
    for (let j = i + 1; j < stars.length; j++) {
      if (stars[j].sx == null) continue;
      const dx = stars[i].sx - stars[j].sx, dy = stars[i].sy - stars[j].sy;
      if (dx * dx + dy * dy > connectDistSq) continue;
      if (!adj.has(i)) { const a = adjPool[adjPoolIdx++]; a.length = 0; adj.set(i, a); }
      if (!adj.has(j)) { const a = adjPool[adjPoolIdx++]; a.length = 0; adj.set(j, a); }
      adj.get(i).push(j);
      adj.get(j).push(i);
    }
  }

  // BFS — index-based queue, no shift() (opt 3)
  visited.clear();
  activeEdges.clear();
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    component.length = 0; queue.length = 0; qHead = 0; queue.push(start);
    while (qHead < queue.length) {
      const node = queue[qHead++];
      if (visited.has(node)) continue;
      visited.add(node); component.push(node);
      for (const nb of adj.get(node)) { if (!visited.has(nb)) queue.push(nb); }
    }
    if (component.length >= 3 && component.length <= 5) {
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

  // Draw lines — pool objects, batch by alpha (opt 1)
  lineDraws.length = 0;
  let linePoolIdx = 0;
  for (const [key, lineAlpha] of lineAlphas) {
    const ai = (key / STAR_COUNT) | 0, bi = key % STAR_COUNT;
    const a = stars[ai], b = stars[bi];
    if (!a || !b || a.sx == null || b.sx == null) { lineAlphas.delete(key); continue; }
    const alpha = Math.min(a.alpha, b.alpha) * lineAlpha * 0.35;
    if (alpha > 0) {
      const d = linePool[linePoolIdx++];
      d.x1 = a.sx; d.y1 = a.sy; d.x2 = b.sx; d.y2 = b.sy; d.alpha = alpha;
      lineDraws.push(d);
    }
  }
  lineDraws.sort((a, b) => a.alpha - b.alpha);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = '#ffffff';
  let li = 0;
  while (li < lineDraws.length) {
    const baseAlpha = lineDraws[li].alpha;
    ctx.globalAlpha = baseAlpha;
    ctx.beginPath();
    while (li < lineDraws.length && lineDraws[li].alpha - baseAlpha < 0.04) {
      const d = lineDraws[li++];
      ctx.moveTo(d.x1, d.y1);
      ctx.lineTo(d.x2, d.y2);
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
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
    updateConnectDist(); // opt 4
    initClusters();
    for (let i = 0; i < COUNT; i++) sprites.push(randomSprite(true));
    for (let i = 0; i < STAR_COUNT; i++) stars.push(randomStar(true, starAssignments[i]));
    rafId = requestAnimationFrame(draw);
  }

  if (data.type === 'resize') {
    W = ctx.canvas.width  = data.width;
    H = ctx.canvas.height = data.height;
    cx = W / 2;
    cy = H / 2;
    updateConnectDist(); // opt 4
  }

  if (data.type === 'pause') {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  if (data.type === 'resume') {
    if (!rafId) rafId = requestAnimationFrame(draw);
  }
};
