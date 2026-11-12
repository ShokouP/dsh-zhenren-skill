#!/usr/bin/env node
/**
 * 冒烟测试：不依赖测试框架。
 * 覆盖 burn → inscribe → 卡片 → highlight → lookup → 空刻。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, "..");
const SCRIPT = path.join(SKILL_DIR, "scripts", "zhenren.mjs");
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zhenren-state-"));
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zhenren-out-"));

function run(args) {
  const output = execFileSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, DSH_ZHENREN_STATE: STATE_DIR },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

function prognosisFor(auspice) {
  if (auspice === "凶") return "不吉，勿行";
  if (auspice === "中性") return "亡咎，可";
  return "吉，利行";
}

try {
  const corpus = run(["corpus"]);
  assert(corpus.ok === true, "corpus ok");
  assert(corpus.counts.glyphs === 1425, "glyphs 1425");
  assert(corpus.counts.aliases === 627, "aliases 627");
  assert(corpus.counts.headwords === 1181, "headwords 1181");

  const burn = run([
    "burn",
    "--charge",
    "去不用，其吉",
    "--question",
    "smoke test",
    "--seed",
    "smoke-test",
    "--date",
    "2026-11-12",
    "--no-card",
  ]);
  assert(burn.ok === true, "burn ok");
  assert(["吉", "中性", "凶"].includes(burn.auspice), "auspice");
  assert(burn.cracks.version === 1 && burn.cracks.main.points.length >= 2, "crack spec");
  assert(typeof burn.reading.intensity === "number", "reading");
  assert(burn.chargeGlyphs.length === 5, "charge glyph count");

  const prognosis = prognosisFor(burn.auspice);
  const cardPath = path.join(OUT_DIR, "inscribe.html");
  const inscribe = run([
    "inscribe",
    "--id",
    burn.divinationId,
    "--seed",
    burn.seed,
    "--charge",
    "去不用，其吉",
    "--prognosis",
    prognosis,
    "--highlight",
    "吉",
    "--out",
    cardPath,
  ]);
  assert(inscribe.ok === true, "inscribe ok");
  assert(inscribe.continuity !== null, "continuity");
  assert(inscribe.layout.columns >= 1 && inscribe.layout.columns <= 4, "columns");
  assert(inscribe.highlightGlosses.length >= 1, "highlight gloss");
  assert(
    inscribe.glyphs.some((glyph) => glyph.char === "吉" && glyph.shuowen !== null),
    "highlight shuowen",
  );
  assert(fs.existsSync(cardPath), "card exists");
  const html = fs.readFileSync(cardPath, "utf8");
  assert(html.includes("zr-card"), "card markup");
  assert(html.includes("__ZHENREN__"), "card payload");
  assert(html.includes("Oracular"), "oracle font");
  assert(fs.statSync(cardPath).size > 100_000, "card includes embedded font");

  const lookup = run(["lookup", "--char", "吉"]);
  assert(lookup.found === true, "lookup found");
  assert(lookup.shuowen && lookup.shuowen.original.includes("善也"), "lookup shuowen");

  const alias = run(["lookup", "--char", "贞"]);
  assert(alias.found === true && alias.glyphChar === "貞" && alias.matchedBy === "alias", "alias");

  const missingBurn = run([
    "burn",
    "--charge",
    "去器不用，其吉",
    "--seed",
    "smoke-missing",
    "--date",
    "2026-11-12",
    "--no-card",
  ]);
  assert(missingBurn.missing.includes("器"), "missing 器");

  const missingInscribe = run([
    "inscribe",
    "--id",
    missingBurn.divinationId,
    "--seed",
    missingBurn.seed,
    "--charge",
    "去器不用，其吉",
    "--prognosis",
    "不吉，勿行",
    "--no-card",
  ]);
  assert(missingInscribe.ok === true, "missing inscribe still ok");
  assert(missingInscribe.warnings.length >= 1, "missing warning");
  assert(
    missingInscribe.glyphs.some((glyph) => glyph.char === "器" && glyph.placeholder === true),
    "placeholder slot",
  );

  process.stdout.write("smoke ok\n");
} finally {
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}
