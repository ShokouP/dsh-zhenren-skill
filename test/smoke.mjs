#!/usr/bin/env node
/**
 * 冒烟测试：不依赖测试框架。
 * 覆盖 burn → inscribe → 图像/字体字形卡片 → highlight → lookup → 空刻。
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
  assert(corpus.counts.glyphs === 1628, "glyphs 1628");
  assert(corpus.counts.fontGlyphs === 1425, "fontGlyphs 1425");
  assert(corpus.counts.imageGlyphs === 203, "imageGlyphs 203");
  assert(corpus.counts.headwords === 1384, "headwords 1384");
  assert(corpus.counts.aliases === 762, "aliases 762");
  assert(corpus.supportedCount === 1628, "supportedCount 1628");

  const burn = run([
    "burn",
    "--charge",
    "王其田，福至",
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
  assert(burn.supportedCount === 1628, "burn supportedCount");
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
    "王其田，福至",
    "--prognosis",
    prognosis,
    "--highlight",
    "福,吉",
    "--out",
    cardPath,
  ]);
  assert(inscribe.ok === true, "inscribe ok");
  assert(inscribe.supportedCount === 1628, "inscribe supportedCount");
  assert(inscribe.continuity !== null, "continuity");
  assert(inscribe.layout.columns >= 1 && inscribe.layout.columns <= 4, "columns");
  const fu = inscribe.glyphs.find((glyph) => glyph.char === "福");
  assert(fu && fu.found === true && fu.glyphSource === "image", "image glyph branch");
  const fuGloss = inscribe.highlightGlosses.find((gloss) => gloss.char === "福");
  assert(fuGloss && fuGloss.original.length > 0, "highlight shuowen");
  assert(fuGloss.vernacular.length > 0, "vernacular draft");
  assert(fs.existsSync(cardPath), "card exists");
  const html = fs.readFileSync(cardPath, "utf8");
  assert(html.includes("zr-card"), "card markup");
  assert(html.includes("__ZHENREN__"), "card payload");
  assert(html.includes("data:image/png;base64"), "embedded image glyph");
  assert(html.includes("字形库 1628 字"), "dynamic corpus footer");
  assert(fs.statSync(cardPath).size > 100_000, "card includes embedded font/images");

  const lookup = run(["lookup", "--char", "福"]);
  assert(lookup.found === true, "lookup found");
  assert(lookup.glyphSource === "image", "lookup glyphSource");
  assert(lookup.shuowen && lookup.shuowen.original.includes("祐也"), "lookup shuowen");
  assert(lookup.shuowen.vernacular.length > 0, "lookup vernacular");
  assert(
    lookup.sources.some((source) => source.kind === "oracleGlyph" && source.value.includes("HUST-OBC")),
    "image provenance",
  );

  const fontLookup = run(["lookup", "--char", "吉"]);
  assert(fontLookup.found === true && fontLookup.glyphSource === "font", "font glyph");
  assert(fontLookup.shuowen && fontLookup.shuowen.original.includes("善也"), "font shuowen");

  const alias = run(["lookup", "--char", "贞"]);
  assert(alias.found === true && alias.glyphChar === "貞" && alias.matchedBy === "alias", "alias");

  const missingBurn = run([
    "burn",
    "--charge",
    "龘",
    "--seed",
    "smoke-missing",
    "--date",
    "2026-11-12",
    "--no-card",
  ]);
  assert(missingBurn.missing.includes("龘"), "missing 龘");

  const missingInscribe = run([
    "inscribe",
    "--id",
    missingBurn.divinationId,
    "--seed",
    missingBurn.seed,
    "--charge",
    "龘",
    "--prognosis",
    "不吉，勿行",
    "--no-card",
  ]);
  assert(missingInscribe.ok === true, "missing inscribe still ok");
  assert(missingInscribe.warnings.length >= 1, "missing warning");
  assert(
    missingInscribe.glyphs.some((glyph) => glyph.char === "龘" && glyph.placeholder === true),
    "placeholder slot",
  );

  process.stdout.write("smoke ok\n");
} finally {
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}
