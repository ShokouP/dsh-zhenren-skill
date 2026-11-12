---
name: zhenren
description: "甲骨占卜仪式：把所问凝成命辞，灼龟取兆，依兆写占辞，刻辞并作现代解读。仅在用户明确要求占卜、起卜、看吉凶、甲骨贞人时使用；不常驻人格，不用于事实预测。"
whenToUse: 用户明确说占卜、起卜、算一卦、看吉凶、甲骨、贞人，或要求用甲骨卜辞形式回答时。普通提问不要调用。
---

# zhenren —— 按需加载的甲骨占卜（v2.1，移植自 dsh-plugin-zhenren 1.1.0-beta.1）

> 本 skill 是 `dsh-plugin-zhenren` **1.1.0-beta.1** 的**移植版**，不是原版，也不是官方版本。
> 上游：<https://github.com/SodiumHypo/dsh-plugins/tree/master/packages/zhenren>（master 即 1.1.0-beta.1）。
> 本仓库已追平 1.1.0-beta.1：1,628 字形（1,425 字体 + 203 HUST-OBC 图像）、1,384 说文头、762 别名、白话转述与图像字形渲染均已并入。
> 原版是 DSH 插件；本仓库把它的协议 / 数据 / 卡片行为移植成按需加载的 skill。来源与差异见 [`ORIGIN.md`](ORIGIN.md)。

按需加载的占卜 skill，用来替代旧的常驻插件 `dsh-plugin-zhenren`。
它**不向系统提示注入人格**：只有本 skill 被加载、用户明确要求占卜时，才按下面的次序主持一次。
普通编码、写作、查资料等请求，不要用贞人口吻回答，也不要主动起卜。

能力与基线 1.1.0-beta.1 对齐：1,628 字形（1,425 字体 + 203 HUST-OBC 图像）、762 别名、1,384 《说文》字头、唯一兆象、
确定性兆纹、逐字空刻、四列布局、刻辞节奏、`highlight` 说文、可回放甲片卡（字体 + 图像字形）、
连续性状态、动画级别 / 字数上限 / 吉凶分布 / 贞人名 / 语言等配置。

脚本是纯 Node、无第三方依赖：

```powershell
# <skill> = 本 skill 加载结果里 "Base directory" 给出的绝对路径
node "<skill>/scripts/zhenren.mjs" <命令> ...
```

## 次序（不可跳步）

1. **凝命辞**：把用户的问题压成一句简短命辞，最多 24 个汉字；不替用户编造事实。命辞只记所问之事，不写日期、贞人名或「卜」字。
2. **灼龟**：运行 `burn`。它返回本次唯一的 `auspice`（吉 / 中性 / 凶）、前辞 `prefix`、兆纹 `cracks`、兆读 `reading`、命辞逐字报告 `chargeGlyphs`、`missing`、`supportedCount`、`seed`、`divinationId`。**在 burn 返回之前，不描述裂纹，不宣布吉凶。**
3. **写占辞**：只以 `auspice` 为判断依据，写一句简短占辞。不得改写、反转或「重新解读」成相反结果。
4. **刻辞**：运行 `inscribe`，传入 `burn` 返回的 `divinationId` / `seed`，以及命辞、占辞、走向、列数。前辞由脚本生成，不要自己另写。需要卡片页脚展示《说文》时，用 `--highlight` 点名（最多 5 字）。刻辞会同时处理字体字形与 HUST-OBC 图像字形，`glyphs[].glyphSource` 标出分支；卡片会把用到的图像内联。返回里还有 `supportedCount`，表示当前字形库总字数。
5. **解读**：用现代语言解释这次占卜，并说明边界（见下）。

同一轮起卜只调用一次 `burn`。缺字不应促使重新起卜：改写命辞后，直接用同一个 `divinationId` / `seed` 进入 `inscribe`。

## 命令

```powershell
# 1) 灼龟（默认同时生成一张灼龟卡）
node "<skill>/scripts/zhenren.mjs" burn `
  --question "清理插件里不需要的东西是否顺利" `
  --charge "去不用，其吉"

# 2) 刻辞（字段值来自 burn 的 JSON；默认生成一张完整甲片卡）
node "<skill>/scripts/zhenren.mjs" inscribe `
  --id "<divinationId>" --seed "<seed>" `
  --charge "去不用，其吉" --prognosis "凶，勿行" `
  --highlight "吉,凶" --direction rtl --columns 3

# 查看字库 / 查单字（含说文）
node "<skill>/scripts/zhenren.mjs" corpus
node "<skill>/scripts/zhenren.mjs" lookup --char 吉
```

### burn 常用参数

| 参数 | 作用 |
|---|---|
| `--question` | 白话概括，卡片标题用；默认等于命辞 |
| `--charge` | 命辞，1–24 个汉字 |
| `--seed` | 重放用 seed；通常不传，由脚本生成 |
| `--tone` | 吉 / 凶 / 中性，仅影响分布，不保证结果；`auspice` 才是最终值 |
| `--balance` | balanced / gentle / stern，吉凶分布倾向 |
| `--diviner` | 前辞里的贞人名，默认「鱼」，最长 4 字 |
| `--date` | 重放/测试用 `YYYY-MM-DD`；默认本机当天 |
| `--burn-x` / `--burn-y` | 灼点提示，归一化 0..1，会被收敛 |
| `--animation` | full / reduced / off，卡片动画级别 |
| `--out` / `--no-card` | 卡片路径 / 不生成卡片 |

### inscribe 常用参数

| 参数 | 作用 |
|---|---|
| `--id` / `--divinationId` | burn 返回的 id |
| `--seed` / `--burnSeed` | burn 返回的 seed |
| `--charge` / `--prognosis` | 命辞 / 占辞 |
| `--highlight` | 逗号分隔的字，最多 5 个；返回完整《说文》并渲染到卡片页脚 |
| `--direction` | rtl（右上往左下，默认）/ ltr（左上往右下） |
| `--columns` | 1–4 列；默认按字数推算，最多 12 行/列 |
| `--max` | 卜辞汉字上限，默认 48，最大 48 |
| `--animation` | full / reduced / off |
| `--show-shuowen` / `--no-shuowen` | 卡片是否展示说文 |
| `--locale` | zh-CN / en（卡片界面语言；古典文本不翻译） |

`burn` / `inscribe` 输出都是 JSON。`inscribe` 的 `ok: false` 表示卜辞为空、超字数或布局不成立；
库外字仍会刻成空刻，`ok` 保持 `true`，并在 `warnings` / `missing` 里说明。
`glyphs[].glyphSource` 的 `font` / `image` 分别对应 Oracular 字体与 HUST-OBC 图像字形。

## 命辞规则

- 一次占卜只问一件事。
- 最多 24 个汉字；用单字实词，避免现代双音节词和白话短语：
  出行→出，明日→翌，顺利→利，是否→其，近期→今。
- 例：「明日出行是否顺利」→「翌出，其吉」。
- 不用「乎、哉、兮、矣、也、焉、耳」等语气词；表疑问不加「乎 / 吗」；否定用「亡 / 弗 / 不」。
- 不写日期、贞人名、「卜」字；这些由前辞负责。

## 占辞规则

- 只记判断，2–6 字一句，短句直陈；实词尽量单字。
- 依 `auspice`：
  - `吉` → 吉、利、可之类；
  - `中性` → 无咎、可、缓之类；
  - `凶` → 不吉、勿行、止之类。
- **不得反转**：`凶` 不能写成「其实无妨」；`吉` 也不能写成「仍有风险」。
- 占辞也尽量只用字库内的字；拿不准就换一种说法（如「凶」不在库内可直接写「不吉」）。

## 缺字处理

`burn` 的 `missing` 非空时：

1. 先把命辞改写成字库内字的单字表达，或省略次要词；
2. 用同一个 `divinationId` / `seed` 直接 `inscribe`，不要重新 `burn`；
3. 实在无法改写，才接受空刻（`glyphs[].placeholder` / 卡片上的 □），并向用户说明。

绝不编造字形。`inscribe` 的 □ 就是空刻槽位；缺字仍保留槽位，不替换、不合成。

## 《说文》与 highlight

`inscribe --highlight "吉,凶"` 会：

- 在这些字的 `glyphs[].shuowen` 上返回完整释义；
- 返回 `highlightGlosses`（字、原文、现代转述、古文字纠正）；
- 在卡片页脚渲染《说文》条目。

引用规则：

- 只有 `shuowen` 非空时才可引用《说文》原文；为空就说「《说文》未收此形」，不要补写。
- `shuowen.vernacular` 是**现代转述**字段，不是原文；当前 1,384 个字头都有草稿转述（`vernacularStatus: "draft"`），引用时必须说明是转述，不要当原文引用。
- `shuowen.correction` 必须连同 `source` 一起说；卡片会在括号里显示 source。
- `found` 只表示有甲骨字形，不等于有《说文》释义；`glossFound` 才是释义标记。

## 连续性

`burn` 会把本次占卜写入临时状态（`%TEMP%/dsh-zhenren-state`，最多 64 条）：

- `inscribe` 用 `divinationId` + `seed` 取回 `auspice` / `burnPoint` / `cracks` / 前辞；
- 找不到或 seed 不一致时，`continuity` 为 `null`、卡片不显示兆纹，并给出 `warnings`；
- 同一台机器上 burn → inscribe 即可；不需要保持进程常驻。

## 配置

默认值在 `config.json`，CLI 参数优先：

```json
{
  "animation": "full",
  "maxInscriptionChars": 48,
  "auspiceBalance": "balanced",
  "showShuowen": true,
  "locale": "zh-CN",
  "divinerName": "鱼"
}
```

## 甲片卡

`burn` / `inscribe` 默认各生成一张自包含 HTML（内联 CSS、Canvas 动画、甲骨字体 base64）：

- 灼龟卡：甲面纹理 + 灼点热辉 + 兆纹生长；
- 刻辞卡：兆纹定格 + 字槽逐字凿刻（Oracular 字体 / HUST-OBC 图像）+ 卜辞释文 + 《说文》条 + 出处；
- `重放` / `跳过`；`prefers-reduced-motion` 或 `animation` 非 full 时直接显示终帧；
- 字体加载失败时只显示释文并提示；单张图像字形缺失时该槽留白，不画假字；
- 页脚显示「字形库 N 字；未收字以空刻表示」，N 取 `supportedCount`；
- 无网络依赖，可直接用浏览器打开。

把 `cardPath` 用 `present` 或 Markdown 链接交给用户；聊天里同时给出卜辞与解读。

## 边界

- **兆纹吉凶是艺术约定，不是考古复原。** 真实兆象解读依赖钻凿位置、灼点、裂纹走向与卜辞语境。
- **占卜是反思的仪式，不是超自然事实**；卡片与占辞不构成对未来的事实预测。
- 字库是硬上限：1,628 字形（1,425 字体 + 203 HUST-OBC 图像）；库外字只能是空刻，绝不合成字形。
- 图像字形来自 HUST-OBC 已释字图像（公有领域，arXiv 2401.15365），只随包分发精选子集；不得合成、补字或做相似度匹配。
- 本 skill 不含抽取脚本；数据来源与授权见 `THIRD_PARTY_NOTICES.md`、`licenses/` 与 `data/fonts/OFL.txt`。
- 用户再次提问时，是否另起一卜由你判断；不必再卜就直接说明理由，不要假装已经灼龟，也不要复用旧的 `divinationId`。

## 目录

```text
SKILL.md
scripts/zhenren.mjs     burn / inscribe / lookup / corpus
scripts/card.mjs        甲片卡 HTML 生成
assets/card.css         卡片样式
assets/card.js          Canvas 动画运行时
data/oracle.json        1,628 字形（1,425 字体 + 203 图像）+ 762 别名 + 1,384 说文头
data/glyphs/*.png       203 个 HUST-OBC 图像字形
data/hust-glyphs.json   图像字形清单与出处
data/vernacular-overrides.json  1,384 条白话转述草稿
data/fonts/orac.woff2   Oracular 甲骨字体（OFL-1.1）
config.json             默认配置
test/smoke.mjs          冒烟测试
```
