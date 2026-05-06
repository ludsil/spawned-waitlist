// ─── noise ──────────────────────────────────────────────────────────
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
function hash2d(ix, iy, seed) {
  let h = seed + ix * 374761393 + iy * 668265263;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0x7fffffff) / 0x7fffffff;
}
function valueNoise2d(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = hash2d(ix, iy, seed) * (1 - sx) + hash2d(ix + 1, iy, seed) * sx;
  const bot = hash2d(ix, iy + 1, seed) * (1 - sx) + hash2d(ix + 1, iy + 1, seed) * sx;
  return top * (1 - sy) + bot * sy;
}

// ─── cloud envelope + noise ────────────────────────────────────────
function cloudEnvelope(nx, ny, seed) {
  const hf = 1 - ny;
  const base = smoothstep(0, 0.08, hf);
  const top = smoothstep(1, 0.55, hf);
  const wf = smoothstep(0, 0.15, hf) * smoothstep(1, 0.35, hf);
  const maxW = 0.5 * (0.6 + wf * 0.4);
  const side = smoothstep(maxW, maxW * 0.7, Math.abs(nx - 0.5));
  const raw = base * top * side;
  if (raw < 0.01) return 0;
  const perturbation = valueNoise2d(nx * 3.5, ny * 2.5, seed + 555);
  return clamp(raw + (perturbation - 0.45) * raw * 0.3);
}
function standardNoise(nx, ny, time, seed) {
  const speeds = [0.015, 0.03, 0.055, 0.09, 0.14];
  const x = nx * 5 + seed * 0.1;
  const y = ny * 4;
  let v = 0, amp = 1, ta = 0, freq = 1;
  for (let i = 0; i < 5; i++) {
    v += amp * valueNoise2d(x * freq + time * speeds[i], y * freq + time * speeds[i] * 0.3, seed + i * 31);
    ta += amp;
    freq *= 2;
    amp *= 0.5;
  }
  return v / ta;
}

// ─── arcs (across the full viewport height) ─────────────────────────
function flat(w, h, y, wobble = 0.03) {
  return {
    p0: { x: w * -0.12, y: h * (y + wobble) },
    p1: { x: w * 0.35, y: h * (y - wobble) },
    p2: { x: w * 0.65, y: h * (y - wobble) },
    p3: { x: w * 1.12, y: h * (y + wobble) },
  };
}
function curved(w, h, startY, peakY) {
  return {
    p0: { x: w * -0.12, y: h * startY },
    p1: { x: w * 0.25, y: h * peakY },
    p2: { x: w * 0.75, y: h * peakY },
    p3: { x: w * 1.12, y: h * startY },
  };
}
function evalBezier(arc, t) {
  const mt = 1 - t, mt2 = mt * mt, mt3 = mt2 * mt;
  const t2 = t * t, t3 = t2 * t;
  return {
    x: mt3 * arc.p0.x + 3 * mt2 * t * arc.p1.x + 3 * mt * t2 * arc.p2.x + t3 * arc.p3.x,
    y: mt3 * arc.p0.y + 3 * mt2 * t * arc.p1.y + 3 * mt * t2 * arc.p2.y + t3 * arc.p3.y,
  };
}

// ─── texture sampler ────────────────────────────────────────────────
function sampleTexture(tex, x, y, tw, th) {
  if (x < 0 || y < 0 || x > tw - 1 || y > th - 1) return 0;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ix1 = Math.min(ix + 1, tw - 1);
  const iy1 = Math.min(iy + 1, th - 1);
  return (
    tex[iy * tw + ix] * (1 - fx) * (1 - fy) +
    tex[iy * tw + ix1] * fx * (1 - fy) +
    tex[iy1 * tw + ix] * (1 - fx) * fy +
    tex[iy1 * tw + ix1] * fx * fy
  );
}

// ─── renderer ───────────────────────────────────────────────────────
const FONT = "'SF Mono','Fira Code','Menlo',monospace";
const BLOCKS = " ░▒▓█";
const LEVELS = BLOCKS.length;
const CLOUD_COLOR = "#a8c6fe";

function renderGradient(ctx, cellGrid, cols, rows, cellSize) {
  ctx.font = `${cellSize}px ${FONT}`;
  ctx.fillStyle = CLOUD_COLOR;
  ctx.textBaseline = "top";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = cellGrid[r * cols + c];
      if (d < 0.02) continue;
      const h = (((c * 7919 + r * 104729) >>> 0) % 1000) / 1000;
      const adj = clamp(d + (h - 0.5) * 0.08);
      const idx = Math.min(LEVELS - 1, Math.max(1, Math.ceil(adj * (LEVELS - 1))));
      ctx.globalAlpha = Math.min(1, d * 2.5);
      ctx.fillText(BLOCKS[idx], c * cellSize, r * cellSize);
    }
  }
  ctx.globalAlpha = 1;
}

// ─── engine ─────────────────────────────────────────────────────────
const SIZES = [
  { w: 12, h: 6 },
  { w: 18, h: 9 },
  { w: 24, h: 11 },
  { w: 30, h: 13 },
];

function createEngine(w, h, cellSize, seed = 0, opts = {}) {
  const cols = Math.ceil(w / cellSize) + 1;
  const rows = Math.ceil(h / cellSize) + 1;
  const cellGrid = new Float32Array(cols * rows);
  const prevGrid = new Float32Array(cols * rows);

  const arcs = [
    curved(w, h, 0.6, -0.05),
    curved(w, h, 0.5, 0.02),
    flat(w, h, 0.18),
    flat(w, h, 0.32),
    flat(w, h, 0.78),
    flat(w, h, 0.9),
  ];
  const sm = 0.2;
  const count = opts.count ?? 10;
  const spdMin = 0.004, spdMax = 0.025;
  const sclMin = 0.8, sclMax = 1.1;
  const driftMin = 1, driftMax = 6;
  const thLo = 0.25, thHi = 0.55;

  let spawnId = 0;

  function prebake(charW, charH, s) {
    const tw = charW * 4, th = charH * 4;
    const tex = new Float32Array(tw * th);
    const noiseTime = s * 0.1;
    for (let sy = 0; sy < th; sy++) {
      for (let sx = 0; sx < tw; sx++) {
        const nx = sx / tw, ny = sy / th;
        const env = cloudEnvelope(nx, ny, s);
        if (env < 0.01) continue;
        const n = standardNoise(nx, ny, noiseTime, s);
        tex[sy * tw + sx] = env * smoothstep(thLo, thHi, n);
      }
    }
    return tex;
  }

  function spawn(initialT) {
    spawnId++;
    const s = spawnId + seed;
    const sizeIdx = Math.floor(hash2d(s, 10, 77) * SIZES.length);
    const base = SIZES[sizeIdx];
    const charW = base.w + Math.floor((hash2d(s, 11, 77) - 0.5) * 4);
    const charH = base.h + Math.floor((hash2d(s, 12, 77) - 0.5) * 3);
    const cseed = Math.floor(hash2d(s, 9, 77) * 10000);
    const scale = sclMin + hash2d(s, 2, 77) * (sclMax - sclMin);
    const texture = prebake(charW, charH, cseed);
    return {
      t: initialT ?? -0.02 - hash2d(s, 0, 77) * 0.3,
      speed: spdMin + hash2d(s, 1, 77) * (spdMax - spdMin),
      scale,
      opacity: 0.4 + hash2d(s, 3, 77) * 0.5,
      arcIdx: Math.floor(hash2d(s, 4, 77) * arcs.length),
      depth: 0.5 + hash2d(s, 5, 77) * 0.5,
      wobblePhase: hash2d(s, 6, 77) * Math.PI * 2,
      driftAmp: driftMin + hash2d(s, 7, 77) * (driftMax - driftMin),
      driftPhase: hash2d(s, 8, 77) * Math.PI * 2,
      seed: cseed,
      charW,
      charH,
      texture,
      texW: charW * 4,
      texH: charH * 4,
      halfWpx: (charW * cellSize * scale) / 2,
      halfHpx: (charH * cellSize * scale) / 2,
    };
  }

  const clouds = [];
  for (let i = 0; i < count; i++) {
    const t = 0.05 + hash2d(i + seed, 20, 42) * 0.85;
    const cloud = spawn(t);
    cloud.arcIdx = Math.floor(hash2d(i + seed, 14, 99) * arcs.length);
    clouds.push(cloud);
  }

  return {
    render(ctx, time, delta) {
      cellGrid.fill(0);
      for (const cloud of clouds) {
        const wobble = 1 + Math.sin(time * 0.3 + cloud.wobblePhase) * 0.08;
        cloud.t += cloud.speed * wobble * delta;
        if (cloud.t > 1.15) Object.assign(cloud, spawn());

        const arc = arcs[cloud.arcIdx];
        if (!arc) continue;
        const ct = clamp(cloud.t);
        const pos = evalBezier(arc, ct);
        pos.y += Math.sin(time * 0.15 + cloud.driftPhase) * cloud.driftAmp;

        const arcFade = (0.3 + 0.7 * Math.sin(Math.PI * ct)) * cloud.opacity * cloud.depth;
        if (arcFade < 0.03) continue;

        const { texture, texW, texH, halfWpx, halfHpx } = cloud;
        const cloudWpx = halfWpx * 2;
        const cloudHpx = halfHpx * 2;

        const cLeft = Math.max(0, Math.floor((pos.x - halfWpx) / cellSize));
        const cRight = Math.min(cols, Math.ceil((pos.x + halfWpx) / cellSize));
        const rTop = Math.max(0, Math.floor((pos.y - halfHpx) / cellSize));
        const rBottom = Math.min(rows, Math.ceil((pos.y + halfHpx) / cellSize));

        for (let r = rTop; r < rBottom; r++) {
          for (let c = cLeft; c < cRight; c++) {
            const cx = (c + 0.5) * cellSize;
            const cy = (r + 0.5) * cellSize;
            const localX = (cx - (pos.x - halfWpx)) / cloudWpx;
            const localY = (cy - (pos.y - halfHpx)) / cloudHpx;
            const val = sampleTexture(texture, localX * (texW - 1), localY * (texH - 1), texW, texH);
            if (val < 0.005) continue;
            cellGrid[r * cols + c] += val * arcFade;
          }
        }
      }

      for (let i = 0; i < cellGrid.length; i++) {
        cellGrid[i] = prevGrid[i] * sm + cellGrid[i] * (1 - sm);
        prevGrid[i] = cellGrid[i];
      }

      // gentle 2-row top fade
      for (let c = 0; c < cols; c++) {
        cellGrid[c] *= 0.3;
        cellGrid[cols + c] *= 0.7;
      }

      renderGradient(ctx, cellGrid, cols, rows, cellSize);
    },
  };
}

// ─── canvas mount ───────────────────────────────────────────────────
(function mountClouds() {
  const canvas = document.getElementById("clouds");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let engine = null;
  let raf = 0;
  let startTime = 0;
  let lastTime = 0;
  let w = 0, h = 0;

  function setup() {
    const rect = canvas.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const isMobile = w < 720;
    const cellSize = isMobile ? 11 : 14;
    const count = isMobile ? 7 : 12;
    engine = createEngine(w, h, cellSize, 123, { count });
    startTime = performance.now() / 1000;
    lastTime = startTime;
  }

  function frame() {
    const now = performance.now() / 1000;
    const time = now - startTime;
    const delta = Math.min(now - lastTime, 0.1);
    lastTime = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    engine && engine.render(ctx, time, delta);
    raf = requestAnimationFrame(frame);
  }

  setup();
  raf = requestAnimationFrame(frame);

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      cancelAnimationFrame(raf);
      setup();
      raf = requestAnimationFrame(frame);
    }, 150);
  });
})();

// ─── form ───────────────────────────────────────────────────────────
(function mountForm() {
  const form = document.getElementById("signup");
  const input = document.getElementById("email");
  const button = document.getElementById("submit");
  const status = document.getElementById("status");
  if (!form || !input || !button || !status) return;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let submitted = false;

  function setStatus(message, kind) {
    status.textContent = message;
    status.classList.remove("ok", "err");
    if (kind) status.classList.add(kind);
    status.classList.add("show");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitted) return;
    const email = input.value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setStatus("that doesn't look like an email", "err");
      input.focus();
      return;
    }
    button.disabled = true;
    setStatus("sending…", null);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        submitted = true;
        form.classList.add("success");
        button.disabled = true;
        button.querySelector(".label").textContent = "added";
        button.querySelector(".arrow").textContent = "✓";
        setStatus("you're on the list. we'll be in touch.", "ok");
      } else {
        button.disabled = false;
        const err = data.error === "invalid_email" ? "that doesn't look like an email" : "something went wrong, try again";
        setStatus(err, "err");
      }
    } catch {
      button.disabled = false;
      setStatus("network error, try again", "err");
    }
  });

  input.addEventListener("input", () => {
    if (submitted) return;
    if (status.classList.contains("err")) {
      status.classList.remove("show", "err");
    }
  });
})();
