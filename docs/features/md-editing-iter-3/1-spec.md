---
feat-id: md-editing-iter-3
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-editing-iter-3 — 编辑态语义样式增强(调研论证)

## 背景

`md-editing-enhance`(iter-1,2026-05-05)+ `md-editing-iter-2`(2026-05-09)落地后,MD 编辑能力已是 Tier B 全套(11 项编辑增强 + 软换行 + 选区蓝色 + 状态栏)。

user 反馈编辑态"丑陋,缺乏层次感"。OPENCODE-PLAN `obsidian-md编辑体验.md` 在 iter-3 段落给出过初步方案(L213-254),本笔深入调研验证。

排除方向(已论证):
- **分割视图 / 双栏**:占屏宽,与 Tauri 多 tab 容器布局冲突,工程量中
- **Live Preview**(Obsidian 风):2 周以上,KaTeX/Mermaid widget 闪烁是 5 年才稳定的能力,DeskFox 定位不匹配
- **单 Enter 渲染为换行**:标准 MD 行为(`<br>` 需双 Enter 或行尾两空格),VS Code / iA Writer / HackMD 同款,改了就脱离源码型编辑器定位

剩下的只有 **Source Mode with semantic styling**:不改渲染、不改换行,只让编辑态视觉上"看起来像它的含义"。

## 现状审计

### 当前编辑器栈(code-mirror-view.tsx)

```ts
// packages/app/src/components/code-mirror-view.tsx:33
syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
```

`defaultHighlightStyle` 是 `@codemirror/language` 内置的通用高亮 — 字符串/数字/关键字着色,**heading 完全没有视觉差异**(字号/字重都不变)、strong/emphasis 也不显示。对 MD 来说基本等于"没高亮"。

### code-mirror-view.tsx 是通用组件

**重要**:该文件被**所有语言**(json/ts/py/md/...)共享。所以"把 defaultHighlightStyle 换成 markdown 专属"的字面执行会**破坏其它语言的高亮**。正确做法:

- 保留 `defaultHighlightStyle` 作为兜底(`fallback: true`)
- **额外**加一个 markdown 专属的 `syntaxHighlighting(...)`,**仅在打开 .md 时**通过 `extraExtensions` 注入
- 用 `Prec.high(...)` 提优先级,让 markdown tag 走专属样式,代码块内部语言走 `defaultHighlightStyle`

(CodeMirror 多个 `syntaxHighlighting` 可共存,按 tag-by-tag 优先级 resolve,高优先级先匹配)

### markdown-editor-extensions.ts 现有结构

```
packages/app/src/utils/markdown-editor-extensions.ts (452 行)
├── PHRASES — 搜索面板 i18n
├── LIST_PATTERNS / continueListCommand — 列表续延
├── formatBoldCommand / formatItalicCommand / formatLinkCommand
├── pasteTransformer — 智能 URL 粘贴
├── dropImageCommand — 拖图 + 截图粘贴
├── ...
└── export function getMarkdownExtensions(): Extension[]  ← Tier B 全套 export
```

新增 syntax highlight 可作为新 export 加到 `getMarkdownExtensions()` 返回数组,符合现有模式。

### CSS 现状

`packages/app/src/index.css`(350 行)已有 CM 相关 styling:
- `.cm-editor .cm-content` 字体色 / caret
- `.cm-editor .cm-selectionBackground` 蓝色半透明(iter-2 落地)
- `.cm-editor .cm-gutters` gutter 主题对齐
- 搜索面板按钮 / 输入框 / label 全套(iter-1)

**无** `.tok-*` token-level CSS — 因为 CM6 `HighlightStyle.define()` 是用 JS spec 而非 class,无需配套 CSS。但如果要做"段落间距 / heading 上边距"等行级排版,需要新增 `.cm-line:has(...)` 之类的选择器。

### @lezer/highlight tag 实际可用集

从 `node_modules/.bun/@lezer+highlight@1.2.3/index.d.ts` 实测:

| pool 写法 | 实际 tag | 是否可用 |
|---|---|---|
| `tags.heading1` | `tags.heading1` | ✅ |
| `tags.heading2` | `tags.heading2` | ✅(独立 tag,不是 `heading` + level)|
| `tags.heading3` ~ `heading6` | 同上 | ✅ |
| `tags.strong` | `tags.strong` | ✅ |
| `tags.emphasis` | `tags.emphasis` | ✅ |
| `tags.monospace` | `tags.monospace` | ✅(inline code)|
| `tags.quote` | `tags.quote` | ✅(blockquote)|
| `tags.url` | `tags.url` | ✅ |
| `tags.link` | `tags.link` | ✅(link 文本)|
| `tags.list` | `tags.list` | ✅(list marker)|
| `tags.processingInstruction` | `tags.processingInstruction` | ✅(`#` `**` `*` `` ` `` 等语法标记)|
| `tags.contentSeparator` | `tags.contentSeparator` | ✅(`---` HR)|

**Pool 伪代码完全可用**,无需调整 tag 名。

## 方案

### 设计基线:GitHub Markdown CSS heading 比例 + iA Writer 源模式语法处理

**理由(白领用户视角,非程序员)**:
- **GitHub MD CSS 是事实标准** — Notion / GitLab / 公众号 / 知乎 / 简书 排版用同款比例(h1 2em / h2 1.5em / h3 1.25em),白领用户**被这个比例训练了 10 年**(公众号文章 / 简书 / 知乎)
- **iA Writer 是写作者的标杆** — Mac 付费榜常驻第一,源模式做得最克制
- **跟我们 preview 侧统一** — DeskFox 的 markdown preview(`packages/ui/src/components/markdown.css`)就是 GitHub 风,user 切预览模式不跳变

**不 copy 程序员风格**(VS Code / Obsidian Source Mode 的 1.6/1.35/1.18 紧凑比例 + opacity 0.5 激进弱化):那是给习惯密集源码的程序员的紧凑版,白领看会"还是密密麻麻"。

### 核心改动:markdownHighlightStyle 注入

在 `markdown-editor-extensions.ts` 新增 export:

```ts
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags as t } from "@lezer/highlight"
import { Prec } from "@codemirror/state"

export const markdownHighlightStyle = HighlightStyle.define([
  // === heading 比例对齐 GitHub MD CSS / Notion ===
  { tag: t.heading1, fontSize: "2.0em",  fontWeight: "700", color: "var(--text-strong)" },
  { tag: t.heading2, fontSize: "1.5em",  fontWeight: "700", color: "var(--text-strong)" },
  { tag: t.heading3, fontSize: "1.25em", fontWeight: "600", color: "var(--text-strong)" },
  { tag: t.heading4, fontSize: "1.0em",  fontWeight: "600", color: "var(--text-strong)" },
  { tag: t.heading5, fontSize: "0.9em",  fontWeight: "600", color: "var(--text-strong)" },
  { tag: t.heading6, fontSize: "0.85em", fontWeight: "600", color: "var(--text-weak)" },
  // === 行内样式 ===
  { tag: t.strong,   fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.monospace, fontFamily: "var(--mono, Menlo, Consolas, monospace)",
    background: "color-mix(in oklab, var(--text-base) 10%, transparent)",
    borderRadius: "3px", padding: "0 4px" },
  { tag: t.quote,    color: "var(--text-weak)", fontStyle: "italic" },
  // === 链接 / 列表(白领高频结构跳出来)===
  { tag: t.url,      color: "var(--primary)", textDecoration: "underline" },
  { tag: t.link,     color: "var(--primary)" },
  { tag: t.list,     color: "var(--primary)" },  // list marker(-、*、1.)
  // === 语法标记符温和弱化(白领还在学语法时别让他找不到 ** 或 #)===
  { tag: t.processingInstruction, color: "var(--text-weak)", opacity: "0.7" },
  { tag: t.contentSeparator, color: "var(--text-weak)", opacity: "0.6" },
])

export const markdownSyntaxHighlight = Prec.high(syntaxHighlighting(markdownHighlightStyle))
```

加到 `getMarkdownExtensions()` 返回数组的**最前面**(优先级最高,Prec.high 进一步确保 tag 解析时它先匹配)。

### CSS 补强:blockquote 左竖线(Word / Notion 标志性元素,可选)

```css
/* FORK: md-editing-iter-3 — blockquote 左竖线,跟 Notion / 飞书文档一致(可选) */
[data-context="md-editor"] .cm-line:has(> .cm-quote, > .tok-quote) {
  border-left: 3px solid var(--border-weak-base);
  padding-left: 0.6em;
}
```

CM6 token class 实际命名得实测(可能不是 `.tok-quote`);**首期先不做**,等 highlight 上线后看 user 反馈再补。

### 与 defaultHighlightStyle 共存机制

- `code-mirror-view.tsx:33` 保留 `syntaxHighlighting(defaultHighlightStyle, { fallback: true })` — `fallback: true` 表示"只有当 markdown 高亮没匹配上时才用",兜底其它语言
- markdown 文件:`extraExtensions` 内的 `markdownSyntaxHighlight`(Prec.high)先匹配 heading/strong 等 → 用专属样式;代码块内部(``` ts ... ```)走 `markdownLanguage` 注入的 `codeLanguages`,fallback 到 `defaultHighlightStyle`
- 非 markdown 文件:`getMarkdownExtensions()` 不调用,只有 default,行为零变化

### CSS 补强(可选,验证后看是否需要)

如果 user 实测发现"段落间距太挤",可加一段:

```css
/* FORK: md-editing-iter-3 — 编辑态段落感(空行视觉权重) */
[data-context="md-editor"] .cm-line:empty { height: 1.6em; }  /* 空行多撑点高度 */
```

需要 `[data-context]` 标记的话,在 `code-mirror-view.tsx` 加 `data-context` 属性(由 `props.language?.language?.name === 'markdown'` 判)。**首期可以不做**,看 highlight 上线后视觉感受再加。

### 不做的事(明确划界)

| 不做 | 原因 |
|---|---|
| 修改 `code-mirror-view.tsx:33` `defaultHighlightStyle` 行 | 通用组件,改了破坏其它语言;markdown 走 extraExtensions 增量注入 |
| 任何渲染行为变更 | 编辑态仍是源码,只换色/字号/字重 |
| 单 Enter → `<br>` | 标准 MD 行为,行业惯例不改 |
| Mermaid / KaTeX 编辑态实时渲染 | 是 Live Preview 范畴,iter-3 明确不做 |
| WikiLinks `[[]]` / `#tag` 补全 | `md-办公优化` Tier 4 已否决,知识库定位偏移 |
| 编辑器主题切 dark/light 双套 | 已经走 CSS 变量(`var(--text-strong)` 等),自动跟随 |

## 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 行高变化导致跳变 / 滚动错位 | 中 | 中 | heading1 1.6em 实测;若 user 反馈不适降到 1.4em |
| 代码块内部高亮被 markdown highlight 抢占 | 低 | 高(代码高亮丢)| 实测验证:CM 文档保证 `Prec.high` 只对 markdown tag 生效,`codeLanguages` 注入的 ts/js 等 token 走 default fallback。**实施时 1 个 case 验证**:`.md` 含 ```ts 块 → ts 关键字仍着色 |
| `var(--text-strong)` / `var(--primary)` 在 light 模式下对比度差 | 中 | 中 | 落地后双模式截图给 user 复核(iter-2 同款流程)|
| `monospace` `background` 在长 inline code 行内换行时背景断裂 | 低 | 低 | CodeMirror 用 `box-decoration-break: clone`,如果不生效退化为纯字体差异 |
| processingInstruction `opacity: 0.55` 把 `**` 弱化太多导致编辑时找不到标记符 | 中 | 中 | 双轨候选:A=0.55 / B=0.7,实施期出截图选 |
| iter-2 `drawSelection()` 选区色与 strong 加粗叠加视觉脏 | 低 | 低 | 选区色已是半透明蓝,叠加 700 字重不冲突 |

## 测试用例(R5 测试纪律 — Medium 标准:≥ 1 e2e 或 3 unit)

### Unit(`markdown-editor-extensions.test.ts` 已存在,添加段落)

| # | 用例 | 验证点 |
|---|---|---|
| H1 | `markdownHighlightStyle` 是有效 `HighlightStyle` 实例 | `instanceof HighlightStyle`(或 has `.match` 方法)|
| H2 | export `markdownSyntaxHighlight` 是 Extension | typeof === "object" |
| H3 | 包含所有声明的 12+ tag rule | spec 列表全 |
| H4 | heading1 ≠ heading2 ≠ heading3 字号 | 防止 copy-paste 错 |

### View / 集成(Phase 1 e2e 基础设施可选,iter-3 Logic 清单不强制 e2e)

| # | 用例 | 验证点 |
|---|---|---|
| V1 | 打开 .md tab → DOM 中应有 `.cm-content` 内 heading 文字字号 > 普通文字 | `getBoundingClientRect().fontSize` 比对 |
| V2 | 打开 .json tab → 不带 markdown highlight,仍走 default | 无 regression |
| V3 | .md 内 ``` ```ts ``` ``` 代码块 → 关键字仍有色 | codeLanguages fallback 不被破 |

V1-V3 是验证级别测试,如果 Phase 1 e2e 基础设施好,补上;否则人工实测过即可,iter-2 同款节奏(无 e2e 但 user 装新 .app 实测过)。

## 验收标准(必跑 C1-C8)

| # | 项 | 通过条件 |
|---|---|---|
| C1 | typecheck | `bun run typecheck` 16/16 |
| C2 | adapter 测试 | 517/517 不动(本 feat 不触飞书)|
| C3 | app 测试 | 既有 markdown-editor-extensions.test.ts 全过 + 新 H1-H4 通过 |
| C4 | 打开 .md 文件 → heading1-h6 字号 / 字重梯度可见 | 截图给 user |
| C5 | 打开 .json / .ts / .py 等其它语言 → 无视觉变化 | 实测 |
| C6 | .md 内 fenced code block 的 ts 关键字仍有色 | 实测 |
| C7 | 选区蓝色(iter-2)与 heading 加粗叠加视觉正常 | 实测 |
| C8 | 切换 dark / light 主题 → 对比度都 OK | 双模式截图 |

## 工程估算

| 项 | 估时 |
|---|---|
| markdown-editor-extensions.ts 加 highlight + 接入 | 30 min |
| index.css 段落间距(可选) | 15 min |
| Unit 测试 H1-H4 | 30 min |
| typecheck + adapter 测试 + app 测试 | 15 min |
| build dev .app + cp 兜底 + 双模式截图 | 30 min |
| 三文档 + INDEX + 改动日志 | 1 h |

**总计 ~3 h**,Small/Medium 边缘。代码量 ~80-150 行(pool 估 80-120 准确)。

## 需 user 拍板的决策点(实施前 confirm)

> **基线已由白领用户画像锁定**:GitHub MD CSS heading 比例 + iA Writer 源模式语法处理。下方 D1-D4 是"是否要在白领基线上再做微调"的开关,默认 **A/A/A/A** 即标准白领方案。

### D1:heading 比例档(白领基线 2.0/1.5/1.25/.../GitHub MD CSS)

| 选项 | h1 / h2 / h3 / h4 / h5 / h6 | 描述 |
|---|---|---|
| A | **2.0 / 1.5 / 1.25 / 1.0 / 0.9 / 0.85em** | **白领标准**(GitHub MD CSS / Notion / 公众号 排版同款)|
| B | 1.8 / 1.4 / 1.2 / 1.0 / 0.9 / 0.85em | 略保守(防 h1 在小屏占太大)|
| C | 1.6 / 1.35 / 1.18 / 1.08 / 1.0 / 1.0em | **程序员风**(VS Code / Obsidian Source Mode 紧凑)— 不推荐 |

**推荐**:A。GitHub/Notion 比例 user 已被训练 10 年,符合"copy 行业最大用户量方案"目标。

### D2:语法标记符(`# ** * ` ` 等)弱化档(白领基线 0.7)

| 选项 | opacity | 描述 |
|---|---|---|
| A | **0.7** | **白领标准**(iA Writer 同款)— 能看见但发灰,既学得到语法又不分散注意力 |
| B | 0.55 | 程序员风(VS Code / Obsidian)— 不推荐,白领还在学 markdown 语法时太隐 |
| C | 不弱化 | 标记符跟正文一样深 — 视觉太脏 |

**推荐**:A。

### D3:list marker(`-` `*` `1.`)染色

| 选项 | 描述 |
|---|---|
| A | **染 primary 蓝色** — Notion / 飞书文档同款,列表结构跳出来 |
| B | 跟字色一致 — 极简但白领扫读慢 |

**推荐**:A。

### D4:CSS 段落间距增强(空行加高)

| 选项 | 描述 |
|---|---|
| A | **首期不做**,只换 highlight 试效果 |
| B | 做,空行 line-height 加到 1.6em |

**推荐**:A。iter-2 教训"调研再细实际用才能暴露真实摩擦",iter-3 先只动 highlight 一项,空行间距感受看 user 反馈再做 iter-3.1。

### D5(新增):blockquote 左竖线(Word / Notion 标志性)

| 选项 | 描述 |
|---|---|
| A | **首期不做**,只换 highlight,看 user 实际用 blockquote 频次 |
| B | 做,加 3px 左竖线 + 缩进 |

**推荐**:A。CSS 改动单独走,跟 highlight 解耦,可作 iter-3.1 跟进。

## 与既有 feat 关系

| feat-id | 关系 |
|---|---|
| `md-editing-enhance` (iter-1) | 基础栈 — 引入 CodeMirror 6,本 feat 在其上 |
| `md-editing-iter-2` | 同栈兄弟 — drawSelection / lineWrapping / 状态栏,本 feat 是第 3 个迭代 |
| `md-办公优化-综合论证` | **预览侧** — 本 feat 是编辑侧,互不冲突 |
| `保存后双提示框` / `保存后提示优化` | 不相关 |

## 下一步

1. user 答 D1-D4
2. 写 2-plan(实施计划)
3. 实施(估时 3 h)
4. 验收 C1-C8
5. 写 3-changelog + INDEX done + 改动日志 entry
6. 合主分支(铁律 ② user 同意)
7. 推主分支(铁律 ③ user 同意)
