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

### 核心改动:markdownHighlightStyle 注入

在 `markdown-editor-extensions.ts` 新增 export:

```ts
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags as t } from "@lezer/highlight"
import { Prec } from "@codemirror/state"

export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.6em", fontWeight: "700", color: "var(--text-strong)" },
  { tag: t.heading2, fontSize: "1.35em", fontWeight: "700", color: "var(--text-strong)" },
  { tag: t.heading3, fontSize: "1.18em", fontWeight: "600", color: "var(--text-strong)" },
  { tag: t.heading4, fontSize: "1.08em", fontWeight: "600", color: "var(--text-strong)" },
  { tag: t.heading5, fontSize: "1.0em",  fontWeight: "600", color: "var(--text-strong)" },
  { tag: t.heading6, fontSize: "1.0em",  fontWeight: "600", color: "var(--text-weak)" },
  { tag: t.strong,   fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.monospace, fontFamily: "var(--mono, Menlo, Consolas, monospace)",
    background: "color-mix(in oklab, var(--text-base) 12%, transparent)",
    borderRadius: "3px", padding: "0 4px" },
  { tag: t.quote,    color: "var(--text-weak)", fontStyle: "italic" },
  { tag: t.url,      color: "var(--primary)", textDecoration: "underline" },
  { tag: t.link,     color: "var(--primary)" },
  { tag: t.list,     color: "var(--primary)" },  // list marker(-、*、1.)染色
  // 语法标记符弱化:# ** * ` 等,降低视觉噪音
  { tag: t.processingInstruction, color: "var(--text-weak)", opacity: "0.55" },
  { tag: t.contentSeparator, color: "var(--text-weak)", opacity: "0.6" },
])

export const markdownSyntaxHighlight = Prec.high(syntaxHighlighting(markdownHighlightStyle))
```

加到 `getMarkdownExtensions()` 返回数组的**最前面**(优先级最高,Prec.high 进一步确保 tag 解析时它先匹配)。

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

### D1:行业基线对齐 vs 保守

| 选项 | heading1 字号 | 描述 |
|---|---|---|
| A | **1.6em** | 行业典型(Markdown Preview Enhanced / VS Code preview)|
| B | 1.4em | 保守,行高跳变小,但层次感弱一档 |
| C | 1.3em | 更保守,适合长文档为主的 user |

**推荐**:A(1.6em)。理由:user 反馈"丑陋无层次"说明嫌当前太平,跳一档够。如果实测过头再降。

### D2:语法标记符弱化程度(`# ** * ` ` 等)

| 选项 | opacity | 描述 |
|---|---|---|
| A | **0.55** | 行业典型,标记符明显发灰但能看见 |
| B | 0.7 | 保守,弱化少 |
| C | 不弱化 | 跟字色一致 |

**推荐**:A(0.55)。

### D3:list marker(`-`、`*`、`1.`)染色

| 选项 | 描述 |
|---|---|
| A | **染色** primary(蓝色)— 让列表结构跳出来 |
| B | 跟字色一致 — 极简 |

**推荐**:A。理由:列表是 MD 高频结构,marker 跳出来扫读快。

### D4:CSS 段落间距增强(空行加高)

| 选项 | 描述 |
|---|---|
| A | **不做**,首期只换 highlight 试效果 |
| B | 做,空行 line height 加到 1.6em |

**推荐**:A。理由:iter-2 教训"调研再细实际用才能暴露真实摩擦",iter-3 先只动 highlight 一项,空行间距感受看 user 反馈再做 iter-3.1。

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
