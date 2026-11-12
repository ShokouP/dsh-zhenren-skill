#!/usr/bin/env node
/**
 * 甲骨贞人 · 按需执行的占卜脚本（v2，对齐 dsh-plugin-zhenren 1.0.0-alpha.1）
 *
 * 无第三方依赖。数据、字体、许可证都在本 skill 目录内：
 *   data/oracle.json      1,425 字形 + 627 别名 + 1,181 说文头
 *   data/fonts/orac.woff2 甲骨字形字体（OFL-1.1）
 *
 * 这不是常驻人格：只有显式调用时才输出一次占卜结果。
 *
 * 命令：
 *   burn      灼龟：前辞、兆象、兆纹、兆读、命辞逐字报告、缺字
 *   inscribe  刻辞：校验字形、布局、刻辞节奏、说文 highlight、甲片卡
 *   lookup    查单字：字形 / 别名 / 说文
 *   corpus    字库统计
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { writeCardFile } from "./card.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, "..");
const DATA_DIR = path.join(SKILL_DIR, "data");
const ORACLE_PATH = path.join(DATA_DIR, "oracle.json");
const CONFIG_PATH = path.join(SKILL_DIR, "config.json");
const STATE_DIR = process.env.DSH_ZHENREN_STATE || path.join(os.tmpdir(), "dsh-zhenren-state");

const ATTRIBUTION =
  "字形：Oracular（OFL-1.1）、HUST-OBC 已释字图像（公有领域，arXiv 2401.15365）。《说文》文本：shuowen.org（Apache-2.0）。数据整理：yigezi（MIT）。";
const BOUNDARY = "兆纹为艺术化表现，非考古复原。";

const MAX_CHARGE = 24;
const MAX_QUESTION = 500;
const MAX_HIGHLIGHTS = 5;
const MAX_STATES = 64;
const SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DIVINATION_ID = /^div_[a-z0-9]{6,40}$/;
const HAN = /\p{Script=Han}/u;
const INVISIBLE = new Set([0x200b, 0x200c, 0x200d, 0xfeff]);

const STEMS = "甲乙丙丁戊己庚辛壬癸";
const BRANCHES = "子丑寅卯辰巳午未申酉戌亥";
const ORDER = ["吉", "中性", "凶"];

const BASE_WEIGHTS = {
  balanced: { 吉: 0.33, 中性: 0.34, 凶: 0.33 },
  gentle: { 吉: 0.45, 中性: 0.35, 凶: 0.2 },
  stern: { 吉: 0.25, 中性: 0.3, 凶: 0.45 },
};

const TONE_MULTIPLIERS = {
  吉: { 吉: 2.2, 中性: 1, 凶: 0.55 },
  凶: { 吉: 0.55, 中性: 1, 凶: 2.2 },
  中性: { 吉: 1, 中性: 1, 凶: 1 },
};

const DEFAULT_BOUNDS = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
const MAX_COLUMNS = 4;
const MAX_ROWS = 12;
const MAX_SLOTS = MAX_COLUMNS * MAX_ROWS;

const BURN_POINT_PRESETS = [
  { x: 0.42, y: 0.34 },
  { x: 0.58, y: 0.34 },
  { x: 0.5, y: 0.42 },
  { x: 0.38, y: 0.48 },
  { x: 0.62, y: 0.48 },
];

const CRACK_PROFILES = {
  吉: {
    angle: [-75, -45],
    length: [0.55, 0.75],
    breaks: [0, 1],
    breakLength: [0.015, 0.035],
    branches: [3, 5],
    level2: [1, 2],
    branchLength: [0.35, 0.5],
    branchAngle: -90,
    branchSpread: 60,
    temperature: [0.7, 0.85],
  },
  中性: {
    angle: [-15, 15],
    length: [0.45, 0.6],
    breaks: [1, 2],
    breakLength: [0.025, 0.05],
    branches: [3, 3],
    level2: [0, 0],
    branchLength: [0.2, 0.35],
    branchAngle: 0,
    branchSpread: 20,
    temperature: [0.45, 0.55],
  },
  凶: {
    angle: [45, 75],
    length: [0.35, 0.5],
    breaks: [2, 3],
    breakLength: [0.045, 0.08],
    branches: [2, 4],
    level2: [0, 0],
    branchLength: [0.1, 0.2],
    branchAngle: 90,
    branchSpread: 55,
    temperature: [0.15, 0.3],
  },
};

const DEFAULTS = {
  animation: "full",
  maxInscriptionChars: 48,
  auspiceBalance: "balanced",
  showShuowen: true,
  locale: "zh-CN",
  divinerName: "鱼",
};

/* ────────────────────────────── 文本 / 字形 ────────────────────────────── */

function isInvisible(ch) {
  const code = ch.codePointAt(0);
  return code !== undefined && (INVISIBLE.has(code) || /\s/u.test(ch));
}

function splitHanCharacters(text) {
  return Array.from(String(text ?? "").normalize("NFC")).filter((ch) => HAN.test(ch));
}

function normalizeQuery(input) {
  const cleaned = Array.from(String(input ?? "").normalize("NFC"))
    .filter((ch) => !isInvisible(ch))
    .join("");
  const match = HAN.exec(cleaned);
  return { cleaned, char: match === null ? null : match[0] };
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* ────────────────────────────── 数据加载 ────────────────────────────── */

function loadCorpus() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(ORACLE_PATH, "utf8"));
  } catch (cause) {
    throw new Error(`data-unavailable: 无法读取 ${ORACLE_PATH}: ${cause.message}`);
  }
  if (raw.schemaVersion !== 2) {
    throw new Error(`data-unavailable: oracle.json 版本 ${raw.schemaVersion}，本脚本只支持 2`);
  }
  const glyphs = new Map(Object.entries(raw.glyphs));
  const headwords = new Map(Object.entries(raw.headwords));
  const aliases = new Map(Object.entries(raw.aliases));
  for (const [key, target] of aliases) {
    if (glyphs.has(key)) throw new Error(`data-unavailable: 别名 ${key} 与字形冲突`);
    if (!glyphs.has(target)) throw new Error(`data-unavailable: 别名 ${key} 指向不存在的字形 ${target}`);
  }
  let fontGlyphs = 0;
  let imageGlyphs = 0;
  for (const [char, record] of glyphs) {
    if (record.headword !== null && !headwords.has(record.headword)) {
      throw new Error(`data-unavailable: 字形 ${char} 指向不存在的字头 ${record.headword}`);
    }
    if (record.source === "image") {
      if (
        record.image === null ||
        typeof record.image !== "object" ||
        typeof record.image.file !== "string"
      ) {
        throw new Error(`data-unavailable: 图像字形 ${char} 缺少 image.file`);
      }
      imageGlyphs += 1;
    } else if (record.source === "font") {
      fontGlyphs += 1;
    } else {
      throw new Error(`data-unavailable: 字形 ${char} 的 source 非法`);
    }
  }
  if (raw.counts.glyphs !== glyphs.size) {
    throw new Error(`data-unavailable: counts.glyphs=${raw.counts.glyphs}，实际 ${glyphs.size}`);
  }
  if (raw.counts.fontGlyphs !== fontGlyphs) {
    throw new Error(`data-unavailable: counts.fontGlyphs=${raw.counts.fontGlyphs}，实际 ${fontGlyphs}`);
  }
  if (raw.counts.imageGlyphs !== imageGlyphs) {
    throw new Error(`data-unavailable: counts.imageGlyphs=${raw.counts.imageGlyphs}，实际 ${imageGlyphs}`);
  }
  if (raw.counts.headwords !== headwords.size) {
    throw new Error(`data-unavailable: counts.headwords=${raw.counts.headwords}，实际 ${headwords.size}`);
  }
  if (raw.counts.aliases !== aliases.size) {
    throw new Error(`data-unavailable: counts.aliases=${raw.counts.aliases}，实际 ${aliases.size}`);
  }
  return {
    raw,
    glyphs,
    headwords,
    aliases,
    counts: raw.counts,
    supportedCount: glyphs.size,
  };
}

const CORPUS = loadCorpus();
const GLYPHS = CORPUS.glyphs;
const HEADWORDS = CORPUS.headwords;
const ALIASES = CORPUS.aliases;

function toFound(query, glyphChar, record, matchedBy) {
  const headword = record.headword;
  const headwordRecord = headword === null ? undefined : HEADWORDS.get(headword);
  const shuowen = headwordRecord === undefined ? null : headwordRecord.shuowen;
  const glyphSource = record.source;
  const glyphOrigin =
    glyphSource === "image" && record.image !== undefined
      ? `HUST-OBC (${record.image.source}, arXiv 2401.15365)`
      : "Oracular (yigezi)";
  const sources = [{ kind: "oracleGlyph", value: glyphOrigin }];
  if (shuowen !== null && headwordRecord !== undefined) {
    sources.push({ kind: "shuowen", value: headwordRecord.sources.shuowen });
  }
  if (shuowen !== null && shuowen.correction !== null) {
    sources.push({ kind: "correction", value: shuowen.correction.source });
  }
  return {
    found: true,
    query,
    normalized: glyphChar,
    glyphChar,
    glyphSource,
    headword,
    shuowen,
    matchedBy,
    sources,
  };
}

function lookupOracle(input) {
  const { cleaned, char } = normalizeQuery(input);
  if (char === null) {
    return {
      found: false,
      query: String(input ?? ""),
      normalized: cleaned,
      reason: "empty-query",
      supportedCount: CORPUS.supportedCount,
    };
  }
  const direct = GLYPHS.get(char);
  if (direct !== undefined) return toFound(String(input ?? char), char, direct, "glyph");
  const target = ALIASES.get(char);
  if (target !== undefined) {
    const record = GLYPHS.get(target);
    if (record !== undefined) return toFound(String(input ?? char), target, record, "alias");
  }
  return {
    found: false,
    query: String(input ?? char),
    normalized: char,
    reason: "not-in-oracle-corpus",
    supportedCount: CORPUS.supportedCount,
  };
}

/* ────────────────────────────── 配置 ────────────────────────────── */

function readConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("config.json 必须是对象");
    }
    return raw;
  } catch (error) {
    process.stderr.write(`warning: config.json 无法解析，使用默认配置（${error.message}）\n`);
    return {};
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function resolveConfig(overrides = {}) {
  const raw = { ...DEFAULTS, ...readConfigFile(), ...overrides };
  const animation = raw.animation === "reduced" || raw.animation === "off" ? raw.animation : "full";
  const auspiceBalance =
    raw.auspiceBalance === "gentle" || raw.auspiceBalance === "stern"
      ? raw.auspiceBalance
      : "balanced";
  const divinerName = String(raw.divinerName ?? "鱼").trim().slice(0, 4) || "鱼";
  return {
    animation,
    maxInscriptionChars: clampInt(raw.maxInscriptionChars, 1, 48, 48),
    auspiceBalance,
    showShuowen: typeof raw.showShuowen === "boolean" ? raw.showShuowen : true,
    locale: typeof raw.locale === "string" && raw.locale !== "" ? raw.locale : "zh-CN",
    divinerName,
  };
}

function configOverrides(args) {
  const overrides = {};
  if (args.diviner !== undefined) overrides.divinerName = String(args.diviner);
  if (args.animation !== undefined) overrides.animation = String(args.animation);
  if (args.max !== undefined) overrides.maxInscriptionChars = args.max;
  if (args.balance !== undefined) overrides.auspiceBalance = String(args.balance);
  if (args.locale !== undefined) overrides.locale = String(args.locale);
  if (args["no-shuowen"]) overrides.showShuowen = false;
  else if (args["show-shuowen"]) overrides.showShuowen = true;
  return overrides;
}

/* ────────────────────────────── 干支 / 日期 ────────────────────────────── */

function julianDayNumber(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

function dayGanzhi(date) {
  const index =
    ((julianDayNumber(date.getFullYear(), date.getMonth() + 1, date.getDate()) + 49) % 60 + 60) % 60;
  return `${STEMS[index % 10]}${BRANCHES[index % 12]}`;
}

function canonicalPrefix(date, divinerName) {
  return `${dayGanzhi(date)}卜，${divinerName}贞：`;
}

function parseLocalDate(value) {
  if (value === undefined || value === null || value === "") return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) throw new Error("--date 需要 YYYY-MM-DD");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const out = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (out.getFullYear() !== y || out.getMonth() !== mo - 1 || out.getDate() !== d) {
    throw new Error("--date 不是有效日期");
  }
  return out;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* ────────────────────────────── 种子 / 随机 ────────────────────────────── */

function newSeed() {
  return crypto.randomBytes(8).toString("hex");
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
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
    pick(items) {
      if (items.length === 0) throw new RangeError("rng.pick: empty sequence");
      return items[Math.floor(next() * items.length)];
    },
    chance(probability) {
      return next() < probability;
    },
  };
}

function deriveSeed(seed, stage) {
  return `${seed}:${stage}`;
}

/* ────────────────────────────── 兆象 ────────────────────────────── */

function weightsFor(balance, tone) {
  const base = BASE_WEIGHTS[balance];
  if (!base) throw new Error("--balance 只支持 balanced / gentle / stern");
  const multipliers = tone === undefined ? undefined : TONE_MULTIPLIERS[tone];
  if (tone !== undefined && !multipliers) throw new Error("--tone 只支持 吉 / 凶 / 中性");
  const weights = multipliers
    ? {
        吉: base.吉 * multipliers.吉,
        中性: base.中性 * multipliers.中性,
        凶: base.凶 * multipliers.凶,
      }
    : { ...base };
  const total = weights.吉 + weights.中性 + weights.凶;
  return { 吉: weights.吉 / total, 中性: weights.中性 / total, 凶: weights.凶 / total };
}

function chooseAuspice(seed, tone, balance) {
  const rng = createRng(deriveSeed(seed, "auspice"));
  const weights = weightsFor(balance, tone);
  const roll = rng.next();
  let acc = 0;
  for (const candidate of ORDER) {
    acc += weights[candidate];
    if (roll < acc) return candidate;
  }
  return "凶";
}

/* ────────────────────────────── 兆纹 ────────────────────────────── */

function clampPoint(point, bounds) {
  return [clamp(point[0], bounds.x, bounds.x + bounds.w), clamp(point[1], bounds.y, bounds.y + bounds.h)];
}

function inside(point, bounds) {
  return (
    point[0] >= bounds.x &&
    point[0] <= bounds.x + bounds.w &&
    point[1] >= bounds.y &&
    point[1] <= bounds.y + bounds.h
  );
}

function rayDistance(origin, angleRad, bounds) {
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);
  const maxX = bounds.x + bounds.w;
  const maxY = bounds.y + bounds.h;
  let distance = Number.POSITIVE_INFINITY;
  if (dx > 1e-6) distance = Math.min(distance, (maxX - origin[0]) / dx);
  else if (dx < -1e-6) distance = Math.min(distance, (bounds.x - origin[0]) / dx);
  if (dy > 1e-6) distance = Math.min(distance, (maxY - origin[1]) / dy);
  else if (dy < -1e-6) distance = Math.min(distance, (bounds.y - origin[1]) / dy);
  return Number.isFinite(distance) ? Math.max(0, distance) : 0;
}

function cumulativeLengths(points) {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    lengths.push(lengths[index - 1] + Math.hypot(current[0] - previous[0], current[1] - previous[1]));
  }
  return lengths;
}

function polylineLength(points) {
  const lengths = cumulativeLengths(points);
  return lengths[lengths.length - 1] ?? 0;
}

function samplePath(points, t) {
  const lengths = cumulativeLengths(points);
  const total = lengths[lengths.length - 1] ?? 0;
  if (total === 0) {
    const only = points[0] ?? [0, 0];
    return { point: [only[0], only[1]], angle: 0 };
  }
  const target = clamp(t, 0, 1) * total;
  for (let index = 1; index < points.length; index += 1) {
    const end = lengths[index];
    if (target <= end) {
      const start = lengths[index - 1];
      const span = end - start;
      const local = span === 0 ? 0 : (target - start) / span;
      const a = points[index - 1];
      const b = points[index];
      return {
        point: [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local],
        angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
      };
    }
  }
  const last = points[points.length - 1];
  const previous = points[points.length - 2];
  return {
    point: [last[0], last[1]],
    angle: previous === undefined ? 0 : Math.atan2(last[1] - previous[1], last[0] - previous[0]),
  };
}

function growPath(rng, start, angleDeg, length, segments, bounds) {
  const DEG = Math.PI / 180;
  const baseAngle = angleDeg * DEG;
  let angle = baseAngle;
  const step = length / segments;
  const points = [clampPoint(start, bounds)];
  let current = points[0];
  for (let index = 1; index <= segments; index += 1) {
    angle = clamp(angle + rng.range(-0.04, 0.04), baseAngle - 0.3, baseAngle + 0.3);
    const jitter = rng.range(-1, 1) * rng.range(0.004, 0.012) * (1 - (index / segments) * 0.4);
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const next = [current[0] + nx * step - ny * jitter, current[1] + ny * step + nx * jitter];
    if (!inside(next, bounds)) {
      points.push(clampPoint(next, bounds));
      break;
    }
    points.push(next);
    current = next;
  }
  return points;
}

function makeBreaks(rng, count, lengthRange) {
  const breaks = [];
  for (let index = 0; index < count; index += 1) {
    const slot = (index + rng.range(0.2, 0.8)) / Math.max(1, count);
    breaks.push({
      at: round(clamp(0.18 + slot * 0.62, 0.1, 0.9), 3),
      length: round(rng.range(lengthRange[0], lengthRange[1]), 3),
    });
  }
  return breaks.sort((left, right) => left.at - right.at);
}

function pickBurnPoint(seed, hint, bounds = DEFAULT_BOUNDS) {
  const rng = createRng(deriveSeed(seed, "burn-point"));
  const preset = hint ?? BURN_POINT_PRESETS[rng.int(0, BURN_POINT_PRESETS.length - 1)];
  const inset = {
    x: bounds.x + 0.06,
    y: bounds.y + 0.06,
    w: Math.max(0.01, bounds.w - 0.12),
    h: Math.max(0.01, bounds.h - 0.12),
  };
  const point = clampPoint([preset.x, preset.y], inset);
  return { x: round(point[0], 3), y: round(point[1], 3) };
}

function generateCracks({ seed, auspice, burnPoint, bounds = DEFAULT_BOUNDS }) {
  const DEG = Math.PI / 180;
  const profile = CRACK_PROFILES[auspice];
  const rng = createRng(deriveSeed(seed, "crack"));
  const origin = clampPoint([burnPoint.x, burnPoint.y], bounds);
  const mainAngle = rng.range(profile.angle[0], profile.angle[1]);
  const shortSide = Math.min(bounds.w, bounds.h);
  const desiredLength = rng.range(profile.length[0], profile.length[1]) * shortSide;
  const available = rayDistance(origin, mainAngle * DEG, bounds);
  const mainLength = Math.max(0.04, Math.min(desiredLength, available * 0.92));
  const main = {
    points: growPath(rng, origin, mainAngle, mainLength, rng.int(10, 24), bounds).map((point) => [
      round(point[0], 3),
      round(point[1], 3),
    ]),
    width: round(rng.range(1.8, 2.6), 2),
    breaks: makeBreaks(rng, rng.int(profile.breaks[0], profile.breaks[1]), profile.breakLength),
  };

  const branchCount = rng.int(profile.branches[0], profile.branches[1]);
  const level1 = [];
  const branches = [];
  for (let index = 0; index < branchCount; index += 1) {
    const startT = round(
      clamp(0.14 + (0.64 * (index + rng.range(0.1, 0.9))) / Math.max(1, branchCount), 0.1, 0.82),
      3,
    );
    const anchor = samplePath(main.points, startT);
    const baseAngle =
      auspice === "中性"
        ? (index % 2 === 0 ? 0 : 180) +
          rng.range(-profile.branchSpread / 2, profile.branchSpread / 2)
        : profile.branchAngle + rng.range(-profile.branchSpread, profile.branchSpread);
    const desired =
      rng.range(profile.branchLength[0], profile.branchLength[1]) * shortSide * (1 - startT * 0.55);
    const reach = rayDistance(anchor.point, baseAngle * DEG, bounds);
    const length = Math.max(0.02, Math.min(desired, reach * 0.92));
    const raw = growPath(rng, anchor.point, baseAngle, length, rng.int(4, 8), bounds);
    const branch = {
      order: 1,
      startT,
      points: raw.map((point) => [round(point[0], 3), round(point[1], 3)]),
      width: round(rng.range(0.8, 1.6), 2),
      breaks:
        auspice === "凶" && rng.chance(0.4)
          ? [{ at: round(rng.range(0.35, 0.7), 3), length: round(rng.range(0.03, 0.05), 3) }]
          : [],
    };
    level1.push(branch);
    branches.push(branch);
  }

  const level2Count = rng.int(profile.level2[0], profile.level2[1]);
  for (let index = 0; index < level2Count && level1.length > 0; index += 1) {
    const parent = rng.pick(level1);
    const startT = round(rng.range(0.35, 0.7), 3);
    const anchor = samplePath(parent.points, startT);
    const angle = anchor.angle / DEG + rng.pick([-1, 1]) * rng.range(35, 70);
    const reach = rayDistance(anchor.point, angle * DEG, bounds);
    const length = Math.max(0.015, Math.min(polylineLength(parent.points) * 0.55, reach * 0.9));
    branches.push({
      order: 2,
      startT,
      points: growPath(rng, anchor.point, angle, length, rng.int(3, 5), bounds).map((point) => [
        round(point[0], 3),
        round(point[1], 3),
      ]),
      width: round(parent.width * 0.65, 2),
      breaks: [],
    });
  }

  const glowRadius =
    auspice === "吉"
      ? rng.range(0.08, 0.11)
      : auspice === "凶"
        ? rng.range(0.05, 0.08)
        : rng.range(0.07, 0.09);

  return {
    version: 1,
    main,
    branches,
    glow: {
      radius: round(glowRadius, 3),
      temperature: round(rng.range(profile.temperature[0], profile.temperature[1]), 2),
      fadeMs: Math.round(rng.range(500, 800)),
    },
    bounds: { ...bounds },
  };
}

function deriveReading(spec) {
  const first = spec.main.points[0];
  const last = spec.main.points[spec.main.points.length - 1];
  const dy = last[1] - first[1];
  const mainDirection = dy < -0.03 ? "up" : dy > 0.03 ? "down" : "level";
  const level1 = spec.branches.filter((branch) => branch.order === 1);
  let sinSum = 0;
  let left = 0;
  let right = 0;
  let counted = 0;
  for (const branch of level1) {
    const start = branch.points[0];
    const end = branch.points[branch.points.length - 1];
    const vx = end[0] - start[0];
    const vy = end[1] - start[1];
    const length = Math.hypot(vx, vy);
    if (length < 1e-6) continue;
    sinSum += vy / length;
    if (vx > 0.01) right += 1;
    else if (vx < -0.01) left += 1;
    counted += 1;
  }
  const meanSin = counted === 0 ? 0 : sinSum / counted;
  const symmetric = Math.abs(meanSin) < 0.35 && left > 0 && right > 0;
  const branchPattern = symmetric
    ? "symmetric"
    : spec.main.breaks.length >= 2
      ? "broken"
      : "continuous";
  const length = polylineLength(spec.main.points);
  const intensity = clamp(length * 1.1 + level1.length * 0.05 + spec.main.breaks.length * 0.03, 0, 1);
  return {
    mainDirection,
    branchPattern,
    intensity: round(intensity, 2),
  };
}

/* ────────────────────────────── 布局 ────────────────────────────── */

function computeLayout({ count, requestedColumns, bounds, burnPoint, direction }) {
  if (count <= 0 || count > MAX_SLOTS) return null;
  const requested = requestedColumns ?? Math.ceil(count / MAX_ROWS);
  const columns = clamp(Math.round(requested), 1, Math.min(MAX_COLUMNS, count));
  const rows = Math.ceil(count / columns);
  if (rows > MAX_ROWS) return null;

  const dir = direction ?? "rtl";
  const areaW = bounds.w * 0.8;
  const areaH = bounds.h * 0.8;
  const shift = burnPoint === undefined ? 0 : burnPoint.x > 0.5 ? -0.04 : 0.04;
  const areaX = clamp(bounds.x + bounds.w * 0.1 + shift, bounds.x, bounds.x + bounds.w - areaW);
  const areaY = bounds.y + bounds.h * 0.1;
  const cellW = areaW / columns;
  const cellH = areaH / rows;
  const size = Math.min(cellW, cellH) * 0.8;

  const slots = [];
  for (let index = 0; index < count; index += 1) {
    const column = Math.floor(index / rows);
    const row = index % rows;
    slots.push({
      index,
      column,
      row,
      x: round(dir === "rtl" ? areaX + areaW - (column + 0.5) * cellW : areaX + (column + 0.5) * cellW, 4),
      y: round(areaY + (row + 0.5) * cellH, 4),
      size: round(size, 4),
    });
  }
  return { columns, rows, direction: dir, slots };
}

function describeLayout(layout) {
  const order = layout.direction === "rtl" ? "right-to-left" : "left-to-right";
  return `${layout.columns} columns, ${order}`;
}

/* ────────────────────────────── 刻辞节奏 ────────────────────────────── */

function planCarve(seed, slots) {
  const rng = createRng(deriveSeed(seed, "carve"));
  const chars = [];
  let cursor = 300;
  for (const slot of slots) {
    const base = rng.range(180, 420);
    const durationMs = Math.round(slot.found ? base : base * 1.5);
    const pressure = round(0.55 + ((rng.next() + rng.next()) / 2) * 0.45, 2);
    chars.push({
      slot: slot.slot,
      startMs: Math.round(cursor),
      durationMs,
      pressure,
      maskSeed: rng.int(1, 2 ** 31 - 1),
    });
    cursor += durationMs + rng.range(50, 120);
    if (!slot.found) cursor += rng.range(60, 140);
  }
  return { version: 1, chars };
}

/* ────────────────────────────── 命辞逐字 ────────────────────────────── */

function planGlyphs(text) {
  const entries = [];
  const missing = [];
  const seen = new Set();
  for (const char of splitHanCharacters(text)) {
    const lookup = lookupOracle(char);
    entries.push({ slot: entries.length, char, lookup });
    if (!lookup.found && !seen.has(char)) {
      seen.add(char);
      missing.push(char);
    }
  }
  return { entries, missing };
}

function toChargeGlyphs(plan) {
  return plan.entries.map((entry) => {
    if (!entry.lookup.found) return { char: entry.char, found: false };
    return {
      char: entry.char,
      found: true,
      headword: entry.lookup.headword,
      glyphChar: entry.lookup.glyphChar,
      glossFound: entry.lookup.shuowen !== null,
    };
  });
}

/* ────────────────────────────── 连续性 / 状态 ────────────────────────────── */

function isDivinationId(value) {
  return DIVINATION_ID.test(String(value));
}

function newDivinationId() {
  return `div_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function stateFile(id) {
  return path.join(STATE_DIR, `${id}.json`);
}

function pruneStates(limit = MAX_STATES) {
  try {
    const files = fs
      .readdirSync(STATE_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const full = path.join(STATE_DIR, name);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((left, right) => right.mtime - left.mtime);
    for (const file of files.slice(limit)) {
      fs.unlinkSync(file.full);
    }
  } catch {
    // Best effort; state is a convenience, not the record.
  }
}

function saveState(state) {
  ensureStateDir();
  fs.writeFileSync(stateFile(state.id), JSON.stringify(state), "utf8");
  pruneStates();
}

function loadState(id) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(id), "utf8"));
  } catch {
    return undefined;
  }
}

/* ────────────────────────────── 工具 ────────────────────────────── */

function required(args, ...keys) {
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined && value !== true && String(value).trim() !== "") return String(value);
  }
  throw new Error(`缺少 --${keys[0]}`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      addArg(out, body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      addArg(out, body, next);
      i += 1;
    } else {
      addArg(out, body, true);
    }
  }
  return out;
}

function addArg(out, key, value) {
  if (out[key] === undefined) {
    out[key] = value;
    return;
  }
  if (Array.isArray(out[key])) {
    out[key].push(value);
    return;
  }
  out[key] = [out[key], value];
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function defaultCardPath(id, kind) {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(process.cwd(), "zhenren-out", `${safe}-${kind}.html`);
}

function writeCard(kind, data, args) {
  if (args["no-card"]) return null;
  const out = args.out ? path.resolve(String(args.out)) : defaultCardPath(data.id, kind);
  return writeCardFile(kind, data, out);
}

/* ────────────────────────────── burn ────────────────────────────── */

function cmdBurn(args) {
  const config = resolveConfig(configOverrides(args));
  const charge = required(args, "charge").trim();
  const chargeChars = splitHanCharacters(charge);
  if (chargeChars.length === 0) throw new Error("命辞为空：至少需要一个汉字");
  if (chargeChars.length > MAX_CHARGE) {
    throw new Error(`命辞 ${chargeChars.length} 字，超过 ${MAX_CHARGE} 字上限`);
  }

  const question = String(args.question ?? charge).trim();
  if (question === "") throw new Error("question 不能为空");
  if (question.length > MAX_QUESTION) {
    throw new Error(`question 超过 ${MAX_QUESTION} 字，请先概括`);
  }

  const seed = args.seed === undefined ? newSeed() : String(args.seed);
  if (!SEED_PATTERN.test(seed)) {
    throw new Error("--seed 只能包含字母、数字、下划线、连字符，长度 1-64");
  }

  const date = parseLocalDate(args.date);
  const diviner = config.divinerName;
  const tone = args.tone === undefined ? undefined : String(args.tone);
  const auspice = chooseAuspice(seed, tone, config.auspiceBalance);

  let hint;
  if (args["burn-x"] !== undefined && args["burn-y"] !== undefined) {
    const x = Number(args["burn-x"]);
    const y = Number(args["burn-y"]);
    if (Number.isFinite(x) && Number.isFinite(y)) hint = { x, y };
  }
  const burnPoint = pickBurnPoint(seed, hint);
  const cracks = generateCracks({ seed, auspice, burnPoint });
  const reading = deriveReading(cracks);
  const plan = planGlyphs(charge);
  const divinationId = newDivinationId();
  const prefix = canonicalPrefix(date, diviner);
  const day = dayGanzhi(date);

  saveState({
    id: divinationId,
    seed,
    auspice,
    reading,
    burnPoint,
    question,
    charge,
    cracks,
    date: formatDate(date),
    dayGanzhi: day,
    diviner,
    prefix,
    storedAt: Date.now(),
  });

  const cardPath = writeCard(
    "burn",
    {
      version: 2,
      id: divinationId,
      seed,
      shellSeed: `shell-${seed}`,
      question,
      charge,
      dayGanzhi: day,
      date: formatDate(date),
      prefix,
      auspice,
      burnPoint,
      cracks,
      supportedCount: CORPUS.supportedCount,
      animation: config.animation,
      showShuowen: config.showShuowen,
      locale: config.locale,
      attribution: ATTRIBUTION,
      boundary: BOUNDARY,
    },
    args,
  );

  emit({
    ok: true,
    tool: "burn",
    divinationId,
    seed,
    generatedAt: new Date().toISOString(),
    date: formatDate(date),
    dayGanzhi: day,
    diviner,
    prefix,
    question,
    charge,
    chargeChars: chargeChars.length,
    auspice,
    reading,
    burnPoint,
    chargeGlyphs: toChargeGlyphs(plan),
    missing: plan.missing,
    cracks,
    supportedCount: CORPUS.supportedCount,
    animation: config.animation,
    showShuowen: config.showShuowen,
    locale: config.locale,
    attribution: ATTRIBUTION,
    boundary: BOUNDARY,
    corpus: {
      glyphs: CORPUS.counts.glyphs,
      fontGlyphs: CORPUS.counts.fontGlyphs,
      imageGlyphs: CORPUS.counts.imageGlyphs,
      glossedGlyphs: CORPUS.counts.glossedGlyphs,
      glyphOnly: CORPUS.counts.glyphOnly,
      headwords: CORPUS.counts.headwords,
      sharedHeadwords: CORPUS.counts.sharedHeadwords,
      aliases: CORPUS.counts.aliases,
      supportedCount: CORPUS.supportedCount,
    },
    cardPath,
  });
}

/* ────────────────────────────── inscribe ────────────────────────────── */

function normalizeHighlights(raw, text) {
  const present = new Set(splitHanCharacters(text));
  const selected = [];
  const items = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  for (const item of items) {
    for (const char of splitHanCharacters(String(item))) {
      if (!present.has(char) || selected.includes(char)) continue;
      selected.push(char);
      if (selected.length >= MAX_HIGHLIGHTS) return selected;
    }
  }
  return selected;
}

function inscriptionFailure(error) {
  return {
    ok: false,
    tool: "inscribe",
    divinationId: null,
    prefix: "",
    missing: [],
    glyphs: [],
    layoutSummary: "",
    warnings: [],
    error,
    continuity: null,
    supportedCount: 0,
    attribution: ATTRIBUTION,
  };
}

function cmdInscribe(args) {
  const config = resolveConfig(configOverrides(args));
  const id = required(args, "id", "divinationId");
  const seed = required(args, "seed", "burnSeed");
  if (!isDivinationId(id)) {
    emit(inscriptionFailure("divinationId 格式非法；请使用 burn 返回的 id"));
    return;
  }
  if (!SEED_PATTERN.test(seed)) {
    emit(inscriptionFailure("seed 格式非法；请使用 burn 返回的 seed"));
    return;
  }
  const charge = required(args, "charge").trim();
  const prognosis = required(args, "prognosis").trim();

  const stored = loadState(id);
  const warnings = [];
  let continuity = null;
  if (stored === undefined) {
    warnings.push("没有找到对应的灼龟记录，卡片将不显示兆纹");
  } else if (stored.seed !== seed) {
    warnings.push("seed 与灼龟记录不一致，卡片不显示兆纹");
  } else {
    continuity = stored;
  }

  const date = continuity === null ? parseLocalDate(args.date) : parseLocalDate(continuity.date);
  const diviner = continuity === null ? config.divinerName : continuity.diviner;
  const prefix = continuity === null ? canonicalPrefix(date, diviner) : continuity.prefix;
  const day = continuity === null ? dayGanzhi(date) : continuity.dayGanzhi;
  const text = [prefix, charge, prognosis].join("");
  const charCount = splitHanCharacters(text).length;
  if (charCount === 0) {
    emit(inscriptionFailure("卜辞为空：前辞、命辞、占辞至少要有一个汉字"));
    return;
  }
  if (charCount > config.maxInscriptionChars) {
    emit(
      inscriptionFailure(
        `卜辞共 ${charCount} 个汉字，超过上限 ${config.maxInscriptionChars} 字；请缩短后重试`,
      ),
    );
    return;
  }

  const direction = args.direction === undefined ? "rtl" : String(args.direction);
  if (direction !== "rtl" && direction !== "ltr") {
    emit(inscriptionFailure("--direction 只支持 rtl / ltr"));
    return;
  }
  const parsedColumns =
    args.columns === undefined ? undefined : Number.parseInt(String(args.columns), 10);
  const requestedColumns = Number.isFinite(parsedColumns) ? parsedColumns : undefined;
  const layout = computeLayout({
    count: charCount,
    requestedColumns,
    bounds: DEFAULT_BOUNDS,
    burnPoint: continuity === null ? undefined : continuity.burnPoint,
    direction,
  });
  if (layout === null) {
    emit(inscriptionFailure(`布局无法成立：最多 ${MAX_SLOTS} 个刻位；请缩短卜辞`));
    return;
  }

  const plan = planGlyphs(text);
  if (plan.missing.length > 0) {
    warnings.push(`卜辞含库外字（${plan.missing.join("、")}），已刻为空刻；应先换字或省略`);
  }
  const highlights = normalizeHighlights(args.highlight, text);
  const highlightSet = new Set(highlights);

  const glyphs = plan.entries.map((entry) => {
    const lookup = entry.lookup;
    if (!lookup.found) {
      return {
        slot: entry.slot,
        char: entry.char,
        found: false,
        glossFound: false,
        headword: null,
        glyphChar: null,
        shuowen: null,
        placeholder: true,
        reason: "not-in-oracle-corpus",
      };
    }
    return {
      slot: entry.slot,
      char: entry.char,
      found: true,
      glossFound: lookup.shuowen !== null,
      headword: lookup.headword,
      glyphChar: lookup.glyphChar,
      glyphSource: lookup.glyphSource,
      shuowen: highlightSet.has(entry.char) ? lookup.shuowen : null,
      placeholder: false,
    };
  });

  const highlightGlosses = [];
  const seen = new Set();
  for (const entry of plan.entries) {
    if (!entry.lookup.found || !highlightSet.has(entry.char) || seen.has(entry.char)) continue;
    seen.add(entry.char);
    const gloss = entry.lookup.shuowen;
    if (gloss === null) continue;
    highlightGlosses.push({
      char: entry.char,
      original: gloss.original,
      vernacular: gloss.vernacular,
      correction: gloss.correction === null ? null : gloss.correction.text,
      correctionSource: gloss.correction === null ? null : gloss.correction.source,
    });
  }

  const metaGlyphs = glyphs.map((glyph) => ({
    slot: glyph.slot,
    char: glyph.char,
    found: glyph.found,
    glyphChar: glyph.found ? glyph.glyphChar : null,
    placeholder: !glyph.found,
    glyphSource: glyph.found ? glyph.glyphSource : "font",
  }));
  const cardGlyphs = metaGlyphs.map((glyph) => {
    if (!glyph.found || glyph.glyphSource !== "image") return glyph;
    const record = GLYPHS.get(glyph.glyphChar);
    const file = record?.image?.file;
    if (!file) return glyph;
    try {
      const bytes = fs.readFileSync(path.join(DATA_DIR, file));
      return { ...glyph, imageDataUrl: `data:image/png;base64,${bytes.toString("base64")}` };
    } catch {
      return glyph;
    }
  });
  const carve = planCarve(
    seed,
    glyphs.map((glyph) => ({ slot: glyph.slot, found: glyph.found })),
  );
  const transcription = metaGlyphs.map((glyph) => (glyph.found ? glyph.char : "□")).join("");
  const displayText = `${prefix}\n${charge}\n${prognosis}`;

  const cardPath = writeCard(
    "inscribe",
    {
      version: 2,
      id,
      seed,
      shellSeed: `shell-${seed}`,
      question: continuity === null ? "" : continuity.question,
      charge,
      prognosis,
      dayGanzhi: day,
      date: formatDate(date),
      prefix,
      auspice: continuity === null ? null : continuity.auspice,
      burnPoint: continuity === null ? null : continuity.burnPoint,
      cracks: continuity === null ? null : continuity.cracks,
      glyphs: cardGlyphs,
      supportedCount: CORPUS.supportedCount,
      layout,
      carve,
      transcription,
      missing: plan.missing,
      highlightGlosses,
      animation: config.animation,
      showShuowen: config.showShuowen,
      locale: config.locale,
      attribution: ATTRIBUTION,
      boundary: BOUNDARY,
    },
    args,
  );

  emit({
    ok: true,
    tool: "inscribe",
    divinationId: id,
    seed,
    date: formatDate(date),
    dayGanzhi: day,
    diviner,
    prefix,
    charge,
    prognosis,
    missing: plan.missing,
    glyphs,
    layoutSummary: describeLayout(layout),
    layout,
    carve,
    highlightGlosses,
    warnings,
    error: null,
    continuity: continuity === null ? null : { auspice: continuity.auspice, burnPoint: continuity.burnPoint },
    supportedCount: CORPUS.supportedCount,
    animation: config.animation,
    showShuowen: config.showShuowen,
    locale: config.locale,
    attribution: ATTRIBUTION,
    boundary: BOUNDARY,
    text,
    displayText,
    cardPath,
  });
}

/* ────────────────────────────── 其他命令 ────────────────────────────── */

function cmdLookup(args) {
  const input = args.char ?? args._[1];
  if (input === undefined) throw new Error("--char 需要一个汉字");
  const result = lookupOracle(String(input));
  emit({ ok: true, tool: "lookup", ...result });
}

function cmdCorpus() {
  emit({
    ok: true,
    tool: "corpus",
    generatedAt: CORPUS.raw.generatedAt,
    source: CORPUS.raw.source,
    counts: CORPUS.counts,
    supportedCount: CORPUS.supportedCount,
    attribution: ATTRIBUTION,
  });
}

function printHelp() {
  process.stdout.write(`甲骨贞人 · 按需执行的占卜脚本（v2）

用法：
  node zhenren.mjs burn --charge "去不用，其吉" [--question "清理无用之物"] [--seed abc] [--tone 吉|凶|中性] [--balance balanced|gentle|stern] [--diviner 鱼] [--date 2026-11-12] [--burn-x 0.42 --burn-y 0.34] [--out card.html] [--no-card]
  node zhenren.mjs inscribe --id div_xxx --seed abc --charge "去不用，其吉" --prognosis "凶，勿行" [--highlight "吉,凶"] [--direction rtl|ltr] [--columns 3] [--max 48] [--animation full|reduced|off] [--show-shuowen|--no-shuowen] [--locale zh-CN|en] [--out card.html] [--no-card]
  node zhenren.mjs lookup --char 吉
  node zhenren.mjs corpus

说明：
  burn 生成的 auspice 是本次占卜唯一的吉凶依据；inscribe 只负责刻辞。
  字库 1,425 字形 + 627 别名 + 1,181 说文头；库外字刻为 □（空刻）。
  highlight 最多 5 个字，会返回完整《说文》释义。
`);
}

/* ────────────────────────────── 入口 ────────────────────────────── */

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? (args.command ? String(args.command) : undefined);
  switch (command) {
    case "burn":
      cmdBurn(args);
      break;
    case "inscribe":
      cmdInscribe(args);
      break;
    case "lookup":
      cmdLookup(args);
      break;
    case "corpus":
      cmdCorpus();
      break;
    case undefined:
    case "help":
    case "--help":
      printHelp();
      break;
    default:
      throw new Error(`未知命令：${command}`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 1;
}
