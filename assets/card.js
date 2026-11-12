/**
 * 甲片卡前端运行时（vanilla，无依赖）。
 *
 * 数据由 zhenren.mjs 决定；这里只做确定性插值与播放：
 *   - 灼龟：热度 → 兆纹生长
 *   - 刻辞：兆纹定格 → 字槽逐字凿刻
 * 绝不重新随机兆象，也不改变字形。
 */
(() => {
  "use strict";

  const data = window.__ZHENREN__;
  if (!data) return;

  const canvas = document.getElementById("zr-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const isBurn = data.kind === "burn";
  const ORACLE_FONT_FAMILY = "Oracular";
  const WIDTH_REFERENCE = 720;
  const reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let animate = data.animation === "full" && !reduceMotion;

  const BURN_TIMELINE = {
    heatPeakMs: 700,
    crackStartMs: 900,
    crackEndMs: 2300,
    totalMs: 2800,
  };

  let width = 0;
  let height = 0;
  let dpr = 1;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function hashSeed(seed) {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createRng(seed) {
    let state = hashSeed(seed);
    const next = () => {
      state = (state + 1831565813) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      range(min, max) {
        return min + next() * (max - min);
      },
      int(min, max) {
        return min + Math.floor(next() * (max - min + 1));
      },
    };
  }

  function cumulative(points) {
    const lengths = [0];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      lengths.push(
        lengths[index - 1] + Math.hypot(current[0] - previous[0], current[1] - previous[1]),
      );
    }
    return lengths;
  }

  function insideBreak(fraction, breaks) {
    for (const span of breaks || []) {
      if (fraction >= span.at && fraction <= span.at + span.length) return true;
    }
    return false;
  }

  function strokePath(points, crackWidth, breaks, reveal) {
    if (reveal <= 0 || points.length < 2) return;
    const lengths = cumulative(points);
    const total = lengths[lengths.length - 1] || 0;
    if (total <= 0) return;

    const limit = total * clamp(reveal, 0, 1);
    const stroke = Math.max(0.7, crackWidth * (width / WIDTH_REFERENCE));
    const steps = Math.max(48, points.length * 6);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    let penDown = false;
    let distance = 0;

    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      const segment = lengths[index] - lengths[index - 1];
      if (segment <= 0) continue;
      const substeps = Math.max(1, Math.ceil((segment / total) * steps));
      for (let step = 1; step <= substeps; step += 1) {
        const travelled = distance + (segment * step) / substeps;
        if (travelled > limit) {
          penDown = false;
          break;
        }
        const local = step / substeps;
        const x = (from[0] + (to[0] - from[0]) * local) * width;
        const y = (from[1] + (to[1] - from[1]) * local) * height;
        if (insideBreak(travelled / total, breaks)) {
          penDown = false;
          continue;
        }
        if (penDown) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          penDown = true;
        }
      }
      distance += segment;
      if (distance >= limit) break;
    }
    ctx.strokeStyle = "rgba(44, 33, 23, 0.88)";
    ctx.lineWidth = stroke;
    ctx.stroke();
    ctx.strokeStyle = "rgba(16, 11, 7, 0.55)";
    ctx.lineWidth = stroke * 0.45;
    ctx.stroke();
    ctx.restore();
  }

  function branchReveal(crack, branch) {
    const start = 0.3 + branch.startT * 0.45;
    return clamp((crack - start) / 0.35, 0, 1);
  }

  function mix(from, to, t) {
    return Math.round(from + (to - from) * t);
  }

  function emberColor(temperature, alpha) {
    const t = clamp(temperature, 0, 1);
    return `rgba(${mix(140, 255, t)}, ${mix(140, 168, t)}, ${mix(150, 76, t)}, ${alpha})`;
  }

  function drawHeat(spec, heat, seed) {
    if (heat <= 0.01) return;
    const [nx, ny] = spec.main.points[0];
    const x = nx * width;
    const y = ny * height;
    const radius = spec.glow.radius * Math.min(width, height) * 2.4;

    const core = ctx.createRadialGradient(x, y, 0, x, y, radius);
    core.addColorStop(0, emberColor(spec.glow.temperature, 0.55 * heat));
    core.addColorStop(0.35, emberColor(spec.glow.temperature, 0.22 * heat));
    core.addColorStop(1, emberColor(spec.glow.temperature, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    const rng = createRng(`smoke:${seed}`);
    ctx.save();
    ctx.strokeStyle = `rgba(110, 102, 92, ${0.16 * heat})`;
    ctx.lineWidth = Math.max(0.8, width * 0.002);
    for (let index = 0; index < 9; index += 1) {
      const spread = rng.range(-0.5, 0.5);
      const rise = rng.range(0.1, 0.28) * height * (0.4 + heat * 0.6);
      const bend = rng.range(-0.06, 0.06) * width;
      ctx.beginPath();
      ctx.moveTo(x + spread * width * 0.02, y);
      ctx.quadraticCurveTo(
        x + spread * width * 0.06 + bend,
        y - rise * 0.5,
        x + spread * width * 0.1 + bend,
        y - rise,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawScorch(spec, heat) {
    if (heat >= 0.98) return;
    const [nx, ny] = spec.main.points[0];
    const x = nx * width;
    const y = ny * height;
    const radius = spec.glow.radius * Math.min(width, height) * 1.6;
    const strength = clamp(1 - heat, 0, 1);
    const scorch = ctx.createRadialGradient(x, y, 0, x, y, radius);
    scorch.addColorStop(0, `rgba(72, 48, 28, ${0.34 * strength})`);
    scorch.addColorStop(0.6, `rgba(88, 62, 36, ${0.18 * strength})`);
    scorch.addColorStop(1, "rgba(88, 62, 36, 0)");
    ctx.fillStyle = scorch;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawOmen(spec, phase, seed) {
    if (!spec) return;
    drawScorch(spec, phase.heat);
    drawHeat(spec, phase.heat, seed);
    const mainReveal = clamp(phase.crack / 0.6, 0, 1);
    strokePath(spec.main.points, spec.main.width, spec.main.breaks, mainReveal);
    for (const branch of spec.branches) {
      const reveal =
        branch.order === 2
          ? branchReveal(phase.crack * 0.85, branch)
          : branchReveal(phase.crack, branch);
      strokePath(branch.points, branch.width, branch.breaks, reveal);
    }
  }

  /* ── 甲面纹理 ─────────────────────────────────────────────── */

  let shellCache = null;

  function paintTexture(pixelWidth, pixelHeight, shellSeed) {
    const offscreen = document.createElement("canvas");
    offscreen.width = Math.max(1, Math.round(pixelWidth));
    offscreen.height = Math.max(1, Math.round(pixelHeight));
    const g = offscreen.getContext("2d");
    if (!g) return null;
    const w = offscreen.width;
    const h = offscreen.height;
    const rng = createRng(`shell:${shellSeed}`);

    const base = g.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#f2e8d4");
    base.addColorStop(0.55, "#e6d8bf");
    base.addColorStop(1, "#d8c5a4");
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    const lineCount = 18 + rng.int(0, 10);
    g.lineWidth = Math.max(0.6, w * 0.0016);
    g.strokeStyle = "rgba(142, 118, 82, 0.14)";
    for (let index = 0; index < lineCount; index += 1) {
      const y0 = rng.range(h * 0.04, h * 0.96);
      const bow = rng.range(-0.16, 0.16) * h;
      g.beginPath();
      g.moveTo(-w * 0.05, y0);
      g.bezierCurveTo(
        w * 0.3,
        y0 + bow,
        w * 0.7,
        y0 - bow * 0.6,
        w * 1.05,
        y0 + rng.range(-h * 0.03, h * 0.03),
      );
      g.stroke();
    }

    const clusters = 6 + rng.int(0, 4);
    for (let cluster = 0; cluster < clusters; cluster += 1) {
      const cx = rng.range(0, w);
      const cy = rng.range(0, h);
      const spread = rng.range(w * 0.04, w * 0.16);
      const pores = 12 + rng.int(0, 18);
      g.fillStyle = "rgba(94, 74, 50, 0.1)";
      for (let index = 0; index < pores; index += 1) {
        const angle = rng.range(0, Math.PI * 2);
        const distance = rng.range(0, spread);
        const radius = Math.max(0.6, w * rng.range(0.0008, 0.0028));
        g.beginPath();
        g.arc(
          cx + Math.cos(angle) * distance,
          cy + Math.sin(angle) * distance * 0.7,
          radius,
          0,
          Math.PI * 2,
        );
        g.fill();
      }
    }

    const vignette = g.createRadialGradient(
      w * 0.5,
      h * 0.46,
      Math.min(w, h) * 0.24,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.74,
    );
    vignette.addColorStop(0, "rgba(104, 82, 52, 0)");
    vignette.addColorStop(0.78, "rgba(104, 82, 52, 0.10)");
    vignette.addColorStop(1, "rgba(104, 82, 52, 0.30)");
    g.fillStyle = vignette;
    g.fillRect(0, 0, w, h);
    return offscreen;
  }

  function drawShell(shellSeed) {
    const key = `${Math.round(width)}x${Math.round(height)}:${dpr}:${shellSeed}`;
    if (shellCache === null || shellCache.key !== key) {
      shellCache = {
        key,
        canvas: paintTexture(width * dpr, height * dpr, shellSeed),
      };
    }
    if (shellCache.canvas) {
      ctx.drawImage(shellCache.canvas, 0, 0, width, height);
      return;
    }
    ctx.fillStyle = "#f2e8d4";
    ctx.fillRect(0, 0, width, height);
  }

  /* ── 刻字 ─────────────────────────────────────────────────── */

  function revealClip(left, top, size, progress, maskSeed) {
    const rng = createRng(`carve-mask:${maskSeed}`);
    const columns = 9;
    const band = size / columns;
    const revealHeight = size * clamp(progress, 0, 1);
    ctx.beginPath();
    ctx.moveTo(left - band * 0.2, top - band * 0.4);
    ctx.lineTo(left + size + band * 0.2, top - band * 0.4);
    ctx.lineTo(left + size + band * 0.2, top + revealHeight);
    for (let index = columns; index >= 0; index -= 1) {
      const notch = rng.range(0.45, 1.35);
      const y = Math.min(top + size, top + revealHeight * notch);
      ctx.lineTo(left + index * band, y);
    }
    ctx.lineTo(left - band * 0.2, top - band * 0.4);
    ctx.closePath();
  }

  const glyphImages = new Map();
  const glyphTints = new Map();

  function loadGlyphImages(glyphs) {
    const urls = new Map();
    for (const glyph of glyphs || []) {
      if (!glyph.found || glyph.glyphSource !== "image" || !glyph.glyphChar) continue;
      if (glyph.imageDataUrl) urls.set(glyph.glyphChar, glyph.imageDataUrl);
    }
    const tasks = [];
    for (const [char, url] of urls) {
      if (glyphImages.has(char)) continue;
      tasks.push(
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => {
            glyphImages.set(char, image);
            resolve();
          };
          image.onerror = () => resolve();
          image.src = url;
        }),
      );
    }
    return Promise.all(tasks).then(() => true);
  }

  function tintedGlyph(char, image, fillStyle) {
    const key = `${char}|${fillStyle}`;
    const cached = glyphTints.get(key);
    if (cached !== undefined) return cached;
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    if (imageWidth === 0 || imageHeight === 0) return undefined;
    const offscreen = document.createElement("canvas");
    offscreen.width = imageWidth;
    offscreen.height = imageHeight;
    const g = offscreen.getContext("2d");
    if (!g) return undefined;
    g.drawImage(image, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = fillStyle;
    g.fillRect(0, 0, imageWidth, imageHeight);
    glyphTints.set(key, offscreen);
    return offscreen;
  }

  function stampGlyph(source, x, y, size, fillStyle) {
    if (source.kind === "font") {
      ctx.font = `${size}px "${source.fontFamily}"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = fillStyle;
      ctx.fillText(source.char, x, y);
      return true;
    }
    const image = glyphImages.get(source.char);
    if (!image) return false;
    const tinted = tintedGlyph(source.char, image, fillStyle);
    if (!tinted) return false;
    ctx.drawImage(tinted, x - size / 2, y - size / 2, size, size);
    return true;
  }

  function sourceOf(glyph) {
    if (!glyph.glyphChar) return null;
    return glyph.glyphSource === "image"
      ? { kind: "image", char: glyph.glyphChar }
      : { kind: "font", char: glyph.glyphChar, fontFamily: ORACLE_FONT_FAMILY };
  }

  function drawGlyphGhost(input) {
    if (!input.source.char) return;
    ctx.save();
    stampGlyph(input.source, input.x, input.y, input.size, "rgba(74, 58, 40, 0.16)");
    ctx.restore();
  }

  function drawCarvedGlyph(input) {
    if (input.progress <= 0 || !input.source.char) return;
    const size = input.size;
    const left = input.x - size / 2;
    const top = input.y - size / 2;

    ctx.save();
    revealClip(left, top, size, input.progress, input.maskSeed);
    ctx.clip();

    stampGlyph(
      input.source,
      input.x + size * 0.012,
      input.y + size * 0.012,
      size,
      "rgba(250, 242, 226, 0.35)",
    );

    const strength = clamp(0.55 + input.pressure * 0.45, 0.55, 1);
    ctx.globalAlpha = strength;
    stampGlyph(input.source, input.x, input.y, size, "rgba(38, 28, 20, 0.92)");
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPlaceholder(x, y, size, progress, maskSeed) {
    if (progress <= 0) return;
    const rng = createRng(`placeholder:${maskSeed}`);
    const reveal = clamp(progress, 0, 1);
    const w = size * 0.5;
    const h = size * 0.42;

    ctx.save();
    ctx.strokeStyle = "rgba(96, 78, 56, 0.28)";
    ctx.lineWidth = Math.max(0.8, size * 0.022);
    ctx.lineCap = "round";
    const marks = 5;
    for (let index = 0; index < marks; index += 1) {
      const row = index / marks;
      if (row > reveal) break;
      const fromX = x - w / 2 + rng.range(0, w * 0.2);
      const toX = x + w / 2 - rng.range(0, w * 0.2);
      const lineY = y - h / 2 + h * row + rng.range(-1, 1) * size * 0.02;
      ctx.beginPath();
      ctx.moveTo(fromX, lineY);
      ctx.lineTo(toX, lineY + rng.range(-1, 1) * size * 0.03);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ── 时间线 ───────────────────────────────────────────────── */

  function easeInOut(t) {
    const x = clamp(t, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  }

  function burnFrame(elapsedMs) {
    const heat =
      elapsedMs <= BURN_TIMELINE.heatPeakMs
        ? clamp(elapsedMs / BURN_TIMELINE.heatPeakMs, 0, 1)
        : elapsedMs <= BURN_TIMELINE.crackStartMs
          ? 1
          : 1 -
            0.82 *
              easeInOut(
                (elapsedMs - BURN_TIMELINE.crackStartMs) /
                  (BURN_TIMELINE.crackEndMs - BURN_TIMELINE.crackStartMs),
              );
    const crack = clamp(
      (elapsedMs - BURN_TIMELINE.crackStartMs) /
        (BURN_TIMELINE.crackEndMs - BURN_TIMELINE.crackStartMs),
      0,
      1,
    );
    return { heat, crack: easeInOut(crack) };
  }

  function carveTotalMs(steps) {
    let end = 0;
    for (const step of steps) end = Math.max(end, step.startMs + step.durationMs);
    return end + 500;
  }

  function carveFrame(steps, elapsedMs) {
    const progress = new Map();
    for (const step of steps) {
      const raw = (elapsedMs - step.startMs) / Math.max(1, step.durationMs);
      progress.set(step.slot, easeInOut(raw));
    }
    return progress;
  }

  /* ── 尺寸 / 绘制 ─────────────────────────────────────────── */

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let fontOk = isBurn;
  let imagesReady = isBurn;

  function paintFrame(elapsedMs) {
    if (width <= 0 || height <= 0) return;
    ctx.clearRect(0, 0, width, height);
    drawShell(data.shellSeed);
    if (isBurn) {
      drawOmen(data.cracks, burnFrame(elapsedMs), data.seed);
      return;
    }
    if (data.cracks) drawOmen(data.cracks, { heat: 0.12, crack: 1 }, data.seed);
    if (!fontOk || !imagesReady) return;

    const slots = new Map((data.layout?.slots || []).map((slot) => [slot.index, slot]));
    const steps = new Map((data.carve?.chars || []).map((step) => [step.slot, step]));
    const unit = Math.min(width, height);

    for (const glyph of data.glyphs || []) {
      if (!glyph.found || !glyph.glyphChar) continue;
      const source = sourceOf(glyph);
      const slot = slots.get(glyph.slot);
      if (!source || !slot) continue;
      drawGlyphGhost({
        source,
        x: slot.x * width,
        y: slot.y * height,
        size: slot.size * unit,
      });
    }
    const progress = carveFrame(data.carve?.chars || [], elapsedMs);
    for (const glyph of data.glyphs || []) {
      const slot = slots.get(glyph.slot);
      if (!slot) continue;
      const step = steps.get(glyph.slot);
      const revealed = progress.get(glyph.slot) || 0;
      const x = slot.x * width;
      const y = slot.y * height;
      const size = slot.size * unit;
      if (glyph.placeholder || !glyph.glyphChar) {
        drawPlaceholder(x, y, size, revealed, step ? step.maskSeed : glyph.slot);
        continue;
      }
      const source = sourceOf(glyph);
      if (!source) continue;
      drawCarvedGlyph({
        source,
        x,
        y,
        size,
        progress: revealed,
        pressure: step ? step.pressure : 0.8,
        maskSeed: step ? step.maskSeed : glyph.slot,
      });
    }
  }

  /* ── 播放器 ───────────────────────────────────────────────── */

  const duration = isBurn
    ? BURN_TIMELINE.totalMs
    : Math.max(500, carveTotalMs(data.carve?.chars || []));
  let raf = 0;
  let settleTimer = 0;
  let startTs = 0;
  let elapsed = 0;
  let running = false;
  let done = false;

  function tick(now) {
    if (!running) return;
    elapsed = now - startTs;
    if (elapsed >= duration) {
      elapsed = duration;
      paintFrame(duration);
      running = false;
      done = true;
      return;
    }
    paintFrame(elapsed);
    raf = requestAnimationFrame(tick);
  }

  function start() {
    cancelAnimationFrame(raf);
    clearTimeout(settleTimer);
    elapsed = 0;
    done = false;
    running = true;
    startTs = performance.now();
    paintFrame(0);
    raf = requestAnimationFrame(tick);
    // If rAF is throttled (hidden tab, headless screenshot, old browser),
    // settle on the final frame instead of leaving ghosts forever.
    settleTimer = setTimeout(() => {
      if (!done) finish();
    }, duration + 800);
  }

  function pause() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
  }

  function resume() {
    if (!animate || done || running || !fontOk || !imagesReady) return;
    running = true;
    startTs = performance.now() - elapsed;
    raf = requestAnimationFrame(tick);
  }

  function finish() {
    running = false;
    cancelAnimationFrame(raf);
    clearTimeout(settleTimer);
    done = true;
    elapsed = duration;
    paintFrame(duration);
  }

  function hideControls() {
    const controls = document.querySelector(".zr-controls");
    if (controls) controls.hidden = true;
  }

  function wireControls() {
    const skip = document.querySelector('[data-zr="skip"]');
    const replay = document.querySelector('[data-zr="replay"]');
    if (skip) skip.addEventListener("click", finish);
    if (replay) {
      replay.addEventListener("click", () => {
        if (!animate || !fontOk || !imagesReady) return;
        start();
      });
    }
  }

  async function loadOracleFont() {
    if (!data.fontDataUrl) return false;
    if (typeof FontFace === "undefined") return false;
    try {
      const face = new FontFace(ORACLE_FONT_FAMILY, `url("${data.fontDataUrl}")`);
      await face.load();
      document.fonts.add(face);
      return true;
    } catch {
      return false;
    }
  }

  async function init() {
    resize();
    wireControls();

    if (!isBurn) {
      const [font, images] = await Promise.all([
        loadOracleFont(),
        loadGlyphImages(data.glyphs),
      ]);
      fontOk = font;
      imagesReady = images;
      if (!fontOk) {
        const note = document.querySelector(".zr-font-note");
        if (note) note.hidden = false;
        hideControls();
        animate = false;
      }
    }

    if (!animate || !fontOk || !imagesReady) {
      hideControls();
      finish();
      return;
    }

    paintFrame(0);
    start();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        resize();
        if (running) startTs = performance.now() - elapsed;
        paintFrame(done ? duration : elapsed);
      });
      observer.observe(canvas.parentElement);
    } else {
      window.addEventListener("resize", () => {
        resize();
        paintFrame(done ? duration : elapsed);
      });
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pause();
      else resume();
    });
  }

  init();
})();
