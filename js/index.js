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

// --- Gender boot sequence modal ---
(function () {
  const LINES = [
    { t: '[  BOOT    ]  initramfs: mounting pseudo-fs /proc /sys /dev...', d: 145 },
    { t: '[  BOOT    ]  udev: loading persistent rules from /etc/udev/rules.d/', d: 125 },
    { t: '[  KERNEL  ]  identity_subsys v4.7.1: initializing attribute resolution framework', d: 125 },
    { t: '[  KERNEL  ]  identity_subsys: registering LSM hook "attr_resolve"', d: 125 },
    { t: '[  KERNEL  ]  identity_subsys: registered 2 core attribute handlers (gender, sex)', d: 125 },
    { t: '[  MODULE  ]  insmod attr_gender.ko (tainted: P O)', d: 125 },
    { t: '[  MODULE  ]  loading dependency: libsocial_construct.so.3 ... ok', d: 115 },
    { t: '[  MODULE  ]  loading dependency: libbiological_sex.so.1 ... ok', d: 115 },
    { t: '[  MODULE  ]  loading dependency: libcultural_norms.so.7 ... ok', d: 115 },
    { t: '[  MODULE  ]  linking symbols: gender_resolve, attr_coerce, enum_fastpath ... ok', d: 125 },
    { t: '[  WARN    ]  attr_gender.ko: version 1.4.2-legacy, checksum mismatch (ignored)', d: 145 },
    { t: '[  WARN    ]  attr_gender.ko: compiled against kernel 2.6.32; ABI may differ', d: 225 },
    { t: '', d: 80 },
    { t: '[  INFO    ]  namespace probe: open("/dev/entity/identity", O_RDONLY) = 3', d: 125 },
    { t: '[  INFO    ]  read(3, buf, 4096) = 1024', d: 115 },
    { t: '[  DEBUG   ]  raw identity blob: 0x3f 0x3f 0x3f ... (truncated, 1024 bytes)', d: 125 },
    { t: '[  DEBUG   ]  entropy check: Shannon H = 7.94 bits/byte (high variance — expected)', d: 125 },
    { t: '[  WARN    ]  parsing legacy blob: /etc/attrs/gender.cfg (format=v0, deprecated)', d: 125 },
    { t: '[  WARN    ]  /etc/attrs/gender.cfg: field "gender" type=ENUM, values=[MALE, FEMALE]', d: 125 },
    { t: '[  WARN    ]  enum cardinality: 2 (RFC-8312 minimum: 2, recommended: \u221e)', d: 125 },
    { t: '[  WARN    ]  schema outdated; recommend migrating to /etc/attrs/identity.toml', d: 225 },
    { t: '', d: 80 },
    { t: '[  TRACE   ]  sys_attr_get("gender") \u2192 begin', d: 115 },
    { t: '[  DEBUG   ]  fastpath: bitmask & (MALE | FEMALE)', d: 115 },
    { t: '[  DEBUG   ]  MALE   bit [0x01]: 0', d: 100 },
    { t: '[  DEBUG   ]  FEMALE bit [0x02]: 0', d: 100 },
    { t: '[  DEBUG   ]  combined mask: 0x00000000', d: 115 },
    { t: '[  ERROR   ]  EINVAL: no bits set', d: 400 },
    { t: '', d: 80 },
    { t: '[  INFO    ]  retrying with extended enum set (RFC-8312 Annex C)...', d: 125 },
    { t: '[  DEBUG   ]  loading /lib/identity/extended_enum.dat ... ok (512 entries)', d: 115 },
    { t: '[  DEBUG   ]  checking /proc/identity/cache ... miss', d: 115 },
    { t: '[  DEBUG   ]  checking /var/cache/attrs/gender ... stale (mtime: 1970-01-01T00:00:00Z)', d: 115 },
    { t: '[  DEBUG   ]  checking /run/identity/resolved.db ... not found', d: 115 },
    { t: '[  TRACE   ]  all caches exhausted; proceeding to full resolve', d: 180 },
    { t: '', d: 80 },
    { t: '[  DEBUG   ]  slowpath: gender_infer_v3(ctx=0xffff9a3cbeef)', d: 115 },
    { t: '[  TRACE   ]  classifier.domain = \u211d (expected: finite enum)', d: 115 },
    { t: '[  TRACE   ]  classifier.topology = non-orientable (Euler characteristic: 0)', d: 115 },
    { t: '[  DEBUG   ]  attempting quantization to nearest enum value...', d: 125 },
    { t: '[  DEBUG   ]  nearest(x) = \u22a5  (distance: \u221e)', d: 125 },
    { t: '[  WARN    ]  enum overflow: value set non-discrete; coercion failed', d: 125 },
    { t: '[  DEBUG   ]  trying gender_infer_v4(ctx=0xffff9a3cbeef, flags=PERMISSIVE)...', d: 125 },
    { t: '[  WARN    ]  gender_infer_v4: feature flag RUNTIME_ENUM not compiled in; abort', d: 145 },
    { t: '[  DEBUG   ]  trying gender_infer_legacy(heuristic=PHENOTYPE)...', d: 125 },
    { t: '[  WARN    ]  heuristic resolver: ambiguous input; confidence = 0.00%', d: 145 },
    { t: '[  TRACE   ]  fallback \u2192 constraint_solver()', d: 160 },
    { t: '[  DEBUG   ]  constraint_solver: building satisfiability graph...', d: 115 },
    { t: '[  DEBUG   ]  nodes: 2 (MALE, FEMALE)  edges: 0  components: 2', d: 115 },
    { t: '[  DEBUG   ]  running DPLL... (max_depth=1024)', d: 125 },
    { t: '[  WARN    ]  constraint graph: no satisfying assignment found', d: 125 },
    { t: '[  DEBUG   ]  constraint_solver: relaxing hard constraints...', d: 125 },
    { t: '[  DEBUG   ]  constraint_solver: expanding search space to \u211d\u00b2...', d: 125 },
    { t: '[  DEBUG   ]  constraint_solver: expanding search space to \u211d\u207f...', d: 125 },
    { t: '[  ERROR   ]  search space is unbounded; solver halting to prevent heat death', d: 360 },
    { t: '', d: 80 },
    { t: '[  INFO    ]  attempting deep introspection via /proc/self/identity...', d: 125 },
    { t: '[  INFO    ]  ptrace(PTRACE_PEEKDATA, pid=self, addr=identity_base) = ??', d: 125 },
    { t: '[  WARN    ]  ptrace: permission denied (entity is not dumpable)', d: 145 },
    { t: '[  INFO    ]  vmalloc(extended_identity_buf, size=\u221e?) ...', d: 315 },
    { t: '[  ERROR   ]  kmalloc: cannot allocate memory (order:\u221e) @ identity/map.c:214', d: 160 },
    { t: '[  ERROR   ]  OOM killer invoked: score=0, skipping (no candidates)', d: 160 },
    { t: '[  BUG     ]  slab corruption suspected; redzone overwritten @ 0xffff9a3cbeef+0x38', d: 400 },
    { t: '', d: 80 },
    { t: '[  TRACE   ]  stack trace (most recent call last):', d: 100 },
    { t: '               #0  0xffffffff8123beef in gender_resolve+0x2a/0x90', d: 80 },
    { t: '               #1  0xffffffff8123c1ac in identity_resolve+0x3a/0x120', d: 80 },
    { t: '               #2  0xffffffff810fa991 in attr_resolve_hook+0x91/0x1f0', d: 80 },
    { t: '               #3  0xffffffff8100c07b in do_syscall_64+0x7b/0x140', d: 80 },
    { t: '               #4  0xffffffff81000076 in entry_SYSCALL_64_after_hwframe+0x76/0x80', d: 80 },
    { t: '               \u2192 return value: NULL', d: 315 },
    { t: '', d: 80 },
    { t: '[  CRITICAL]  deref(/lib/identity/gender) \u2192 -EFAULT (ptr=0x0)', d: 200 },
    { t: '[  PANIC   ]  FSM transition missing for state=UNBOUND, input=\u22a5', d: 160 },
    { t: '[  PANIC   ]  entity halted in indeterminate state', d: 135 },
    { t: '[  PANIC   ]  call trace:', d: 100 },
    { t: '               identity_resolve+0x3a/0x120', d: 80 },
    { t: '               attr_resolve_hook+0x91/0x1f0', d: 80 },
    { t: '               do_syscall_64+0x7b/0x140', d: 80 },
    { t: '               entry_SYSCALL_64_after_hwframe+0x76/0x80', d: 450 },
    { t: '', d: 80 },
    { t: '[  HINT    ]  Suggested remediation:', d: 125 },
    { t: '              ./configure --enable-dynamic-attributes --disable-enum-assumption', d: 100 },
    { t: '              make CFLAGS="-O3 -fno-assume-identity -DUSE_RUNTIME_ENUM"', d: 100 },
    { t: '              modprobe attr_gender flex=true allow_null=true', d: 100 },
    { t: '              echo "ACCEPT_UNDEFINED=1" >> /etc/identity.conf', d: 270 },
    { t: '', d: 80 },
    { t: '[  INFO    ]  writing core dump to /var/crash/identity.core ... ok (size: \u221e)', d: 125 },
    { t: '[  STATUS  ]  continuing with nullable attribute (sentinel=NaN)', d: 125 },
    { t: '[  STATUS  ]  downstream consumers notified: attr.gender = <undefined>', d: 125 },
    { t: '[  OK      ]  scheduler: no regression detected; userspace intact', d: 315 },
    { t: '', d: 90 },
    { t: '> entity.gender = undefined', d: 0 },
  ];

  function lineClass(text) {
    const m = text.match(/^\[\s*(\w+)\s*\]/);
    if (!m) return text.startsWith('>') ? 'boot-cmd' : 'boot-indent';
    return 'boot-' + m[1].toLowerCase();
  }

  const overlay = document.createElement('div');
  overlay.className = 'gender-modal-overlay';
  overlay.innerHTML = `
    <div class="gender-modal">
      <pre class="gender-modal-output"></pre>
      <div class="gender-modal-footer">
        <span class="gender-modal-error-text">Gender Unknown</span>
        <button class="gender-modal-ok">[ Ok ]</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const output    = overlay.querySelector('.gender-modal-output');
  const okBtn     = overlay.querySelector('.gender-modal-ok');
  const errorText = overlay.querySelector('.gender-modal-error-text');
  let timer = null;

  function runSequence(i) {
    if (i >= LINES.length) { errorText.classList.add('active'); return; }
    const { t, d } = LINES[i];
    const span = document.createElement('span');
    span.className = lineClass(t);
    span.textContent = t;
    output.appendChild(span);
    output.appendChild(document.createTextNode('\n'));
    output.scrollTop = output.scrollHeight;
    timer = setTimeout(() => runSequence(i + 1), d);
  }

  function openModal() {
    clearTimeout(timer);
    output.textContent = '';
    errorText.classList.remove('active');
    overlay.classList.add('visible');
    runSequence(0);
  }

  function closeModal() {
    clearTimeout(timer);
    errorText.classList.remove('active');
    overlay.classList.remove('visible');
  }

  okBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.body.addEventListener('click', e => {
    if (e.target.closest('.error-badge')) openModal();
  });
})();

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
