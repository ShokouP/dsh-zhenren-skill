# 第三方数据与授权声明

本 skill（`dsh-zhenren-skill`）随包发布 `data/` 下的字形、释义与别名数据。这些内容来自第三方，授权与义务如下。再分发本 skill 或其中数据时，必须保留本文件、`licenses/` 与 `data/fonts/OFL.txt`。

本 skill 的代码（`scripts/`、`assets/`、`test/`）以 MIT 授权发布，全文见 [`LICENSE`](LICENSE)。

## 0. 与原插件的关系

本 skill 是 `dsh-plugin-zhenren` 1.0.0-alpha.1 的**移植版**，不是原版，也不是官方版本。
原插件的代码、数据与字体版权归原作者与上游来源；本仓库再分发数据 / 字体，并按原插件行为重写了 skill 代码。
搬运范围、文件对应与差异见 [`ORIGIN.md`](ORIGIN.md)。

## 1. 甲骨字形字体

- 资产：`data/fonts/orac.woff2`（原样复制，未修改、未重命名、未子集化）
- 名称：Oracular / 镜原甲骨文
- 来源：<https://oracular.azurewebsites.net/>（作者 Peichao Qin，「镜原甲骨数字平台」）
- 授权：**SIL Open Font License 1.1**，全文见 [`data/fonts/OFL.txt`](data/fonts/OFL.txt)
- 字库版权登记号：国作登字-2024-F-00223767
- 义务：随字体保留 OFL 全文与版权声明；衍生字体不得使用保留字体名（Reserved Font Name）。本 skill 不生成衍生字体。

字体映射说明：`orac.woff2` 共 1,426 个 cmap 条目，其中 1 条是 U+FFFF 非字符；有效字形码位 1,425 个，唯一字形 1,315 个（102 个字形被 110 个额外码位共享）。数据层按码位索引，不假设「一字形一码位」。

## 2. 《说文解字》文本

- 资产：`data/oracle.json` 中的 `headwords[*].shuowen.original`、`pinyin`、`radical`
- 来源：<http://www.shuowen.org>（数据仓库 `shuowenjiezi/shuowen`），经 yigezi 整理
- 授权：**Apache License 2.0**，全文见 [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt)
- 修改声明（Apache-2.0 §4(b)）：本 skill 只抽取 1,425 个甲骨字形相关的字头；删除卷次、反切、音韵等未使用字段；对字头与字形的对应关系做了重新组织，并生成 `glyphs` 与 `aliases` 两层索引（详见 `data/extraction-report.json`）。《说文》原文逐字保留，未改写。
- `shuowen.vernacular` 是本项目预留的现代白话转述字段，**不是** shuowen.org 原文；当前抽取管线不自动生成，随包值为空字符串，状态为 `draft`。
- `shuowen.correction` 来自 yigezi 的 `XZ` 古文字旁注，按 yigezi 的 MIT 授权使用，并在字段内标注 `source: "yigezi:XZ"`。

## 3. yigezi 数据整理与代码

- 资产：`data/oracle.json` 的整理结构、`data/alias-overrides.json`、`data/extraction-report.json`
- 来源：yigezi（快照 `.refs/yigezi-main`）
- 授权：**MIT**，全文见 [`licenses/MIT-yigezi.txt`](licenses/MIT-yigezi.txt)
- 说明：构建期的 `scripts/extract-yigezi/` 抽取脚本未随本 skill 复制；`data/extraction-report.json` 保留抽取报告供审计。

## 4. OpenCC（仅构建期）

- 用途：构建期生成简体→繁体的别名候选；运行时不依赖 OpenCC。
- 来源：<https://github.com/BYVoid/OpenCC>
- 授权：**Apache License 2.0**
- 随包的 `aliases` 索引由 OpenCC 1.4.2 的结果固化而来；如需替换，重跑 `npm run extract`。

## 5. 明确未随包分发的数据

yigezi 页面还包含以下内容；本 skill**不包含**它们，因此不承担其再分发义务：

| 来源 | 未分发的内容 |
| --- | --- |
| 开元小篆 / 全字库说文解字（CNS11643） | 篆书字体与字形 |
| PHONO-ML Database（CC BY 4.0） | `mc`、`pos`、`oc`、`ocsrc` 中古音/上古音字段 |
| 《广韵形声考》（授权未明示） | 上古音拟音 |
| 汉典、小學堂等 | 未采用 |

数据层校验会在构建期拒绝这些字段进入 `oracle.json`。

## 6. 用户可见署名

卡片页脚分两行：第一行是数据出处 `attribution`，第二行是边界说明（`card.boundary`）。
工具返回的 `attribution` 只含出处；边界句单独返回为 `boundary`，不重复拼进 attribution。

> 字形：Oracular（OFL-1.1）。《说文》文本：shuowen.org（Apache-2.0）。数据整理：yigezi（MIT）。
>
> 兆纹为艺术化表现，非考古复原。

## 7. 学术边界

兆纹的吉凶映射是本插件的**艺术约定**，不是殷墟卜甲的考古复原。真实兆象解读依赖钻凿位置、灼点、裂纹走向与卜辞语境，本插件不作学术声明。
