# 移植来源与关系（ORIGIN）

## 结论

本仓库（`ShokouP/dsh-zhenren-skill`）是 **`dsh-plugin-zhenren` 的 skill 移植版**。

- 它**不是原版**，也不是原项目的官方版本，更不代表原作者。
- 原版是 DSH **插件**（plugin），本仓库是 DSH **skill**；两者形态、加载方式与卡片载体不同。
- 如果你要找原插件，请使用原项目 / 原安装包；本仓库只负责把它的占卜能力移植成按需加载的 skill。

## 原版信息

| 项 | 值 |
|---|---|
| 包名 | `dsh-plugin-zhenren` |
| 版本 | `1.0.0-alpha.1` |
| 形态 | DSH 插件（不是 MCP server） |
| 许可 | MIT |
| 版权 | 甲骨贞人 contributors（见原包 `LICENSE`） |
| 原包内容 | `lib/`（host + client）、`data/`（oracle.json、字体、抽取报告）、`cordis.patch.yml`、README / 许可证 |
| 原包公开地址 | 原包内未声明公开仓库 URL；本仓库不以官方自居 |

## 搬运了什么

- **数据**：`data/oracle.json`（1,425 字形、627 别名、1,181 说文头）与 `data/manifest.json`、`data/extraction-report.json`、`data/alias-overrides.json`，按原包再分发。
- **字体**：`data/fonts/orac.woff2` 与 `OFL.txt`，按原包再分发（OFL-1.1）。
- **协议与行为**：命辞 / 占辞规则、唯一 `auspice`、确定性 `CrackSpec`、兆读、1–4 列布局、空刻、刻辞节奏、`highlight` 说文、动画时间线、配置项、连续性语义。这些是依据原包 `lib/index.js.map` 与 `lib/client.js.map` 的 `sourcesContent` 还原出的 TS 源码逐项重写的。
- **许可证**：原包 `LICENSE`（MIT）与第三方许可证（Apache-2.0 / MIT-yigezi / OFL）随仓库保留。

## 没有搬什么

- **常驻系统提示注入**：原插件通过 `zhenren:protocol` 段向每次会话注入贞人人格 / 步骤；本仓库改为 `SKILL.md`，只在 skill 被显式加载时生效。
- **原生工具注册**：原插件用 `ctx.tools.register` 注册 `zhenren_burn` / `zhenren_inscribe`；本仓库改为 `scripts/zhenren.mjs` 的 CLI 子命令，由代理通过 shell 调用。
- **聊天内 React tool view**：原插件向 DSH 客户端注入 React 卡片；本仓库生成独立、自包含的 HTML + Canvas 甲片卡。
- **原插件运行时代码**：本仓库不含原包的 `lib/` 产物；CLI 与卡片运行时是按还原源码重写的 JS。
- **原插件安装包**：本仓库不含 `dsh-plugin-zhenren-*.tgz`。

## 文件对应

| 原版 | 本仓库 |
|---|---|
| `src/prompt.ts` + `systemPrompt.section` | `SKILL.md`（按需加载，不常驻） |
| `src/tools/burn.ts` / `inscribe.ts` | `scripts/zhenren.mjs` 的 `burn` / `inscribe` |
| `src/data/*` | `scripts/zhenren.mjs` 的数据层 + `data/oracle.json` |
| `src/ritual/*` | `scripts/zhenren.mjs` 的兆象 / 兆纹 / 布局 / 刻辞逻辑 |
| `src/client/views/*` + `src/client/render/*` | `scripts/card.mjs` + `assets/card.css` + `assets/card.js` |
| `src/config.ts` | `config.json` + CLI 参数 |
| `src/tools/shared.ts`（进程内 LRU） | `scripts/zhenren.mjs` 的临时状态目录 |
| `data/`、`licenses/` | 同路径再分发 |

## 许可与归属

- 本仓库的移植代码：MIT。`LICENSE` 同时保留原版版权行与移植版权行。
- 数据 / 字体：yigezi（MIT）、shuowen.org（Apache-2.0）、Oracular（OFL-1.1）。详见 `THIRD_PARTY_NOTICES.md`、`licenses/`、`data/fonts/OFL.txt`。
- 原版代码、数据、字体的版权归原作者与上游来源；本仓库只对移植部分负责。

## 免责

- 本仓库不是 `dsh-plugin-zhenren` 的官方仓库，不代表原作者。
- 原版的行为、数据与许可以原项目 / 原发布渠道为准；如本仓库的归属或链接需要更正，请开 issue。
