/**
 * 甲片卡生成器。
 *
 * 生成一个自包含 HTML：内联 CSS / Canvas 动画 / 甲骨字体（base64），
 * 无网络依赖。卡片只是结果的展示层：数据已经由 zhenren.mjs 决定。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, "..");
const CSS_PATH = path.join(SKILL_DIR, "assets", "card.css");
const JS_PATH = path.join(SKILL_DIR, "assets", "card.js");
const FONT_PATH = path.join(SKILL_DIR, "data", "fonts", "orac.woff2");

const COPY = {
  "zh-CN": {
    burnTitle: "灼龟",
    inscribeTitle: "刻辞",
    auspice: "兆象",
    question: "所问",
    charge: "命辞",
    missing: "未收字",
    placeholder: "空刻",
    replay: "重放",
    skip: "跳过",
    gloss: "《说文》",
    vernacular: "现代转述",
    correction: "古文字纠正",
    fontMissing: "字形未加载，仅显示释文。",
    boundary: "兆纹为艺术化表现，非考古复原。",
    corpus: "字形库 {n} 字；未收字以空刻表示。",
  },
  en: {
    burnTitle: "Scapulimancy",
    inscribeTitle: "Inscription",
    auspice: "Omen",
    question: "Question",
    charge: "Charge",
    missing: "Outside the corpus",
    placeholder: "blank carve",
    replay: "Replay",
    skip: "Skip",
    gloss: "Shuowen",
    vernacular: "Modern paraphrase",
    correction: "Palaeographic note",
    fontMissing: "Glyph font unavailable; showing the transcription only.",
    boundary:
      "Omen geometry is an artistic convention, not an archaeological reconstruction.",
    corpus: "Corpus: {n} glyphs; characters outside it are left as blank carves.",
  },
};

let fontCache;

function fontDataUrl() {
  if (fontCache !== undefined) return fontCache;
  try {
    const bytes = fs.readFileSync(FONT_PATH);
    fontCache = `data:font/woff2;base64,${bytes.toString("base64")}`;
  } catch {
    fontCache = null;
  }
  return fontCache;
}

function copyFor(locale) {
  return locale === "en" ? COPY.en : COPY["zh-CN"];
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function renderCardHtml(kind, data) {
  const copy = copyFor(data.locale);
  const isBurn = kind === "burn";
  const title = isBurn ? copy.burnTitle : copy.inscribeTitle;
  const auspice = data.auspice ?? "";
  const chip = auspice
    ? `<span class="zr-chip" data-auspice="${esc(auspice)}">${copy.auspice} · ${esc(auspice)}</span>`
    : "";
  const canvasLabel = isBurn
    ? `${copy.burnTitle}：${auspice || "—"}。${data.charge ?? ""}`
    : `${copy.inscribeTitle}：${data.transcription ?? ""}`;

  const fields = isBurn
    ? `<div class="zr-field"><span class="zr-label">${copy.question}</span><span class="zr-value">${esc(
        data.question,
      )}</span></div>
       <div class="zr-field"><span class="zr-label">${copy.charge}</span><span class="zr-value">${esc(
         data.charge,
       )}</span></div>`
    : `<div class="zr-transcription">${esc(data.transcription)}</div>
       ${
         Array.isArray(data.missing) && data.missing.length > 0
           ? `<div class="zr-note">${copy.missing}：${esc(data.missing.join("、"))}（${copy.placeholder}）</div>`
           : ""
       }
       <div class="zr-note zr-font-note" hidden>${copy.fontMissing}</div>`;

  const glosses =
    !isBurn && data.showShuowen && Array.isArray(data.highlightGlosses) && data.highlightGlosses.length > 0
      ? `<section class="zr-glosses">${data.highlightGlosses
          .map(
            (gloss) => `<div class="zr-gloss">
        <div class="zr-gloss-char">${esc(gloss.char)}</div>
        <div class="zr-gloss-line">${copy.gloss}：${esc(gloss.original)}</div>
        ${
          gloss.vernacular
            ? `<div class="zr-gloss-meta">${copy.vernacular}：${esc(gloss.vernacular)}</div>`
            : ""
        }
        ${
          gloss.correction
            ? `<div class="zr-gloss-meta">${copy.correction}：${esc(gloss.correction)}${
                gloss.correctionSource ? `（${esc(gloss.correctionSource)}）` : ""
              }</div>`
            : ""
        }
      </div>`,
          )
          .join("")}</section>`
      : "";

  const controls =
    data.animation === "full"
      ? `<div class="zr-controls">
          <button type="button" data-zr="skip">${copy.skip}</button>
          <button type="button" data-zr="replay">${copy.replay}</button>
        </div>`
      : "";

  const corpus =
    typeof data.supportedCount === "number" && data.supportedCount > 0
      ? copy.corpus.replace("{n}", String(data.supportedCount))
      : "";

  const font = isBurn ? null : fontDataUrl();
  const payload = {
    ...data,
    kind,
    fontDataUrl: font,
    copy,
  };
  const json = safeJson(payload);

  return `<!doctype html>
<html lang="${data.locale === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${esc(data.id ?? "")}</title>
<style>${fs.readFileSync(CSS_PATH, "utf8")}</style>
</head>
<body>
<main class="zr-card" data-kind="${kind}" data-animation="${esc(data.animation ?? "full")}"${
    auspice ? ` data-auspice="${esc(auspice)}"` : ""
  }>
  <header class="zr-head">
    <span class="zr-title">${title}</span>
    <span class="zr-spacer"></span>
    ${chip}
  </header>
  <section class="zr-body">
    <div class="zr-canvas-wrap">
      <canvas id="zr-canvas" class="zr-canvas" role="img" aria-label="${esc(canvasLabel)}"></canvas>
    </div>
    ${fields}
  </section>
  ${glosses}
  <footer class="zr-foot">
    <div class="zr-attrib">${esc(data.attribution)}<br>${esc(copy.boundary)}${
      corpus ? `<br><span class="zr-corpus">${esc(corpus)}</span>` : ""
    }</div>
    ${controls}
  </footer>
</main>
<script>window.__ZHENREN__ = ${json};</script>
<script>${fs.readFileSync(JS_PATH, "utf8")}</script>
</body>
</html>
`;
}

export function writeCardFile(kind, data, outPath) {
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, renderCardHtml(kind, data), "utf8");
  return resolved;
}
