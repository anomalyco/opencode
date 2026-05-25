---
feat-id: md-editing-iter-3
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-editing-iter-3 — 3-changelog(实际改动 + 回归)

## commit 链

| # | hash | 说明 |
|---|---|---|
| 1 | `1b9f4c0ef` | docs: 1-spec(初版,程序员风) |
| 2 | `52978936d` | docs: 1-spec 矫正白领基线(GitHub MD CSS + iA Writer) |
| 3 | `e44d40c80` | docs: 2-plan A/A/A/A/A 锁版 |
| 4 | `f7b8c8bf8` | feat: markdownHighlightStyle + markdownSyntaxHighlight + 4 单测 **[R4 override-blacklist]** |
| 5 | `9e92cda44` | docs: 3-changelog + INDEX done + 改动日志.md |
| 6 | `390356ed1` | refactor: 色彩矫正 ② — `var(--primary)` 未定义 bug 修 + Option A 现代办公文档配色(`var(--text-interactive-base)` 链接 + list marker 回归 monochrome)|
| 7 | (本笔) | refactor: 色彩矫正 ③ — 删 monospace chip(lezer-markdown 把 fenced code block 内容也标 monospace,chip 套到每个 token 视觉灾难;源模式靠反引号自识别)|

## 行数 / 文件

净 +160 行 / 4 文件(代码 + 测试,含色彩矫正 ②):
- `packages/app/src/utils/markdown-editor-extensions.ts` +45 / -1
- `packages/app/src/utils/markdown-editor-extensions.test.ts` +57 / 0
- `packages/app/package.json` +1 / 0(`@lezer/highlight: 1.2.3` direct dep)
- `bun.lock` +1 / 0

## 色彩矫正 ③(本笔)— 删 monospace chip

第 6 commit(色彩矫正 ②)后 user 装 .app 截图反馈:**inline code 灰 chip 应用到 fenced code block 每个 token**(bash / json / diff 等无 `codeLanguages` 注册的语言,所有 token 都 fallback 到 `t.monospace` tag,带 chip 样式后每个变量名 / 关键字 / 字符串都套了独立灰底圆角 = 视觉灾难)。

**根因**:`packages/app/src/utils/lang-from-ext.ts` 的 `codeLanguages` 数组只注册了 js/ts/jsx/tsx,其它语言(bash / json / diff / yaml / python 等)的 fenced code block 内容全部 fallback 到 `t.monospace`。CodeMirror 6 lezer-markdown grammar 的 InlineCode 和 FencedCode 内容(无识别语言时)都 tag 为 monospace,HighlightStyle 无法在 spec 层级区分。

**修法**:**完全删 `t.monospace` 的 spec rule**:
- CodeMirror 编辑器整体已是 monospace 字体(`code-mirror-view.tsx` `.cm-scroller fontFamily: "Menlo, Consolas, monospace"`),inline code 不需要额外字体
- 源模式下 inline code 通过**可见的反引号 `` ` `` 自识别**(iA Writer / GitHub source view / Notion 源数据视图都这处理)
- chip 视觉留给预览侧 `packages/ui/src/components/markdown.css`(那里只处理 `<code>` 标签,不会误伤代码块内 token)
- spec 条数 14 → 13;H3 单测 expect 同步改 13

**Notion 一致性**:Notion 没有真正的 source mode(他们是 WYSIWYG),但他们 export 出来的 .md 源文件查看 / GitHub source view 都是这套"monochrome + 反引号识别 inline code + 链接蓝"的方案。本 feat 第 7 commit 后跟这套行业 source-mode 共识对齐。

## 色彩矫正 ②(Option A,commit `390356ed1`)

第 5 commit 后 user 实测反馈"用色不太美观",诊断发现:
1. **`var(--primary)` 在 `packages/ui/src/styles/theme.css` 根本未定义**(只有 `--button-primary-base`),原 spec 的"蓝色 list marker / 蓝色 url / 蓝色 link" **从来没显示** — 全 fallback 到默认文字色
2. URL 还残留 `text-decoration: underline`,产生"老式 web 蓝色下划线"视觉违和

**Option A 矫正方案**(行业 3 选 1):**GitHub Primer / Notion / Linear / Slack 现代办公文档共识** — monochrome 主体 + **单一蓝色 accent 仅给链接**

- `url` / `link` 色:`var(--primary)` → **`var(--text-interactive-base)`**(`#034cff` light / `#9dbefe` dark)— 跟 `packages/ui/src/components/markdown.css:48` **预览侧链接色完全统一**,user 切预览模式 0 跳变
- url 去 `textDecoration: "underline"`(现代办公文档惯例:色彩足够,无需下划线)
- list marker spec 直接**删除**(`{ tag: t.list, color: ... }` 整行去掉)→ marker 回归 monochrome,跟正文同色
- spec 条数 15 → 14;H3 单测 expect 同步改 14
- inline code chip 背景维持 10% bg(user 没反馈这点)

## 设计基线

**copy 的方案:GitHub Markdown CSS heading 比例 + iA Writer 源模式标记符弱化**

- **白领用户视角**(非程序员):排除 VS Code / Obsidian Source Mode 紧凑程序员风(1.6/1.35/1.18em + opacity 0.55)
- **GitHub MD CSS** = 公众号 / 知乎 / 简书 / Notion 同款 heading ramp(2/1.5/1.25/1/0.9/0.85em)— 用户被这套比例训练了 10 年
- **iA Writer** 的 opacity 0.7 = 标记符可见但弱化的 sweet spot(白领还在学 markdown 时别让 `**` 或 `#` 找不到)
- **跟 preview 侧统一** — 与 `packages/ui/src/components/markdown.css` GitHub 风视觉一致,user 切预览不跳变

## 改动详情

### 1. `markdown-editor-extensions.ts`

**新增 import**(L8-9):
```ts
import { HighlightStyle, foldGutter, foldKeymap, syntaxHighlighting } from "@codemirror/language"
import { tags as t } from "@lezer/highlight"
```

**新增 export `markdownHighlightStyle`**(`HighlightStyle.define` 15 条 tag rule):

| Tag | font-size | font-weight | color | 其它 | 来源 |
|---|---|---|---|---|---|
| `heading1` | 2em | 700 | var(--text-strong) | — | GitHub MD CSS |
| `heading2` | 1.5em | 700 | var(--text-strong) | — | GitHub |
| `heading3` | 1.25em | 600 | var(--text-strong) | — | GitHub |
| `heading4` | 1em | 600 | var(--text-strong) | — | GitHub |
| `heading5` | 0.9em | 600 | var(--text-strong) | — | GitHub ≈ |
| `heading6` | 0.85em | 600 | var(--text-weak) | — | GitHub + muted |
| `strong` | — | 700 | — | — | 普世 |
| `emphasis` | — | — | — | italic | 普世 |
| ~~`monospace`~~ | — | — | — | ~~chip 全 spec~~ | ~~色彩矫正 ③ 删除(lezer-markdown fenced code block 内容也 tag monospace,chip 套每 token 视觉灾难)~~ |
| `quote` | — | — | var(--text-weak) | italic | Word / Notion 同款 |
| `url` | — | — | var(--text-interactive-base) | — | GitHub Primer / Notion(色彩矫正 ②)|
| `link` | — | — | var(--text-interactive-base) | — | GitHub Primer / Notion(色彩矫正 ②)|
| ~~`list`~~ | — | — | ~~删~~ | — | ~~原 var(--primary) 未生效;色彩矫正 ② 取消~~ |
| `processingInstruction` | — | — | var(--text-weak) | opacity 0.7 | iA Writer |
| `contentSeparator` | — | — | var(--text-weak) | opacity 0.6 | iA Writer |

**新增 export `markdownSyntaxHighlight`**:
```ts
export const markdownSyntaxHighlight = Prec.high(syntaxHighlighting(markdownHighlightStyle))
```
`Prec.high` 确保跟 `code-mirror-view.tsx:33` 的 `syntaxHighlighting(defaultHighlightStyle, { fallback: true })` 共存时,markdown tag 优先匹配,代码块内部 ts/js/py 等 fallback 到 default。

**接入** `markdownEditorExtensions()` 数组开头(foldGutter 之前):
```ts
return [
  markdownSyntaxHighlight,  // ← 新增
  foldGutter(),
  ...
]
```

### 2. `markdown-editor-extensions.test.ts`

新增 `describe("markdownHighlightStyle (iter-3)")` 段,4 个用例:
- **H1**:`markdownHighlightStyle` 是有效 `HighlightStyle` 实例(duck typing:`module` 或 `extension` 字段存在)
- **H2**:`markdownSyntaxHighlight` 是合法 Extension(typeof object)
- **H3**:specs 数组长度 = 15(精确断言,防 copy-paste 漏 rule;通过 `as unknown as { specs?: unknown[] }` cast 安全访问 CM6 内部)
- **H4**:heading 比例梯度单调递减(h1 > h2 > h3 > h4 > h5 > h6,防比例数字 copy-paste 错)

### 3. `package.json` + `bun.lock` **(R4 override-blacklist)**

`@lezer/highlight 1.2.3` 升级为 direct dep。

**R4 override 论证**:
- **wrapper 不可行性**:`@codemirror/language` 的 `HighlightStyle.define([{ tag, ... }])` API **直接吃 `Tag` 对象引用**,这些 `Tag` 常量(`tags.heading1` 等)只由 `@lezer/highlight` 导出 — 没有字符串 / wrapper 替代方案
- **风险评估**:0 上游侵入(纯 dep 追加);版本 1.2.3 与既有 transitive(via `@codemirror/language@6.12.3`)一致,**0 bundle 增量**;`bun.lock` 是 dep 锁版机械副产物,不可拆分
- **本季 R4 配额**:本笔 1 笔(2026 Q2 第 2 笔本季)

## 回归测试 / 验收

| 项 | 结果 | 证据 |
|---|---|---|
| **C1 typecheck** | ✓ | `bun run typecheck` 16/16 |
| **C2 adapter 测试** | ✓ | 517/517 不变(本 feat 不触飞书)|
| **C3 app 测试** | ✓ | 46/46 markdown-editor-extensions.test.ts(原 42 + 新 4) / 全套 699 pass 1 known Kobalte happydom 假错(预存,memory `reference_known_dev_issues.md`)|
| **C4 .md 视觉层次** | 待 user 装 .app 实测 | dev .app 已 build |
| **C5 .ts/.json 等其它语言无变化** | 待 user 实测 | (markdown highlight 仅通过 `markdownEditorExtensions` 注入,其它文件不调用)|
| **C6 .md 内 ts 代码块仍着色** | 待 user 实测 | (`Prec.high` 仅覆盖 markdown tag,代码块 `codeLanguages` 走 default fallback)|
| **C7 选区蓝 + heading 加粗叠加 OK** | 待 user 实测 | (iter-2 drawSelection 半透明蓝 + 700 字重不冲突)|
| **C8 dark / light 双模式对比度** | 待 user 实测 | (所有色全走 CSS 变量 `var(--text-strong)` `var(--primary)` 自动跟随)|

## 测试产物路径

- raw binary:`packages/desktop/src-tauri/target/release/DeskFox`
- .app(已 cp 兜底):`packages/desktop/src-tauri/target/release/bundle/macos/DeskFox Dev.app`
- .dmg:`packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox Dev_1.14.33_aarch64.dmg`

## 回退方法

```bash
git revert f7b8c8bf8  # feat commit
```

或人工:
- `markdown-editor-extensions.ts` 删 `markdownHighlightStyle` + `markdownSyntaxHighlight` 两个 export 块 + `markdownEditorExtensions()` 数组首位
- `markdown-editor-extensions.test.ts` 删 H1-H4 describe 段
- `package.json` 删 `@lezer/highlight` direct dep + `bun install`

回退后 markdown 编辑态回到 iter-2 行为(`defaultHighlightStyle` 兜底,heading 字号无差异),其它语言 0 影响。

## 不做(明确划界,留 backlog 给 iter-3.1)

| 不做 | 原因 |
|---|---|
| 空行间距增强(`.cm-line:empty` 加高) | iter-2 教训"调研再细实际用才能暴露真实摩擦",首期只动 highlight 看反馈;D4 默认 A |
| blockquote 左竖线 | D5 默认 A 同上,CSS 改动可作 iter-3.1 |
| `[data-context="md-editor"]` attribute | CSS 标记后续真需要时再加,本期 highlight 走 JS spec 已足够 |
| 改 `code-mirror-view.tsx:33` 全局 defaultHighlightStyle | 通用组件,改了破坏其它语言;走 `extraExtensions` 增量注入 |
| Live Preview(Obsidian 风) | 2 周+ 工程量,DeskFox 定位不匹配,1-spec 明确否决 |

## Phase 1 e2e

本 feat 是 view layer 视觉项,**纯 CodeMirror highlight spec** — Logic 清单(单元测试 H1-H4 覆盖 spec 完整性 + 比例梯度)足够,View 清单 e2e(打开 .md 看 DOM 字号差异)在 Phase 1 e2e 基础设施支持 CodeMirror 后再补。

## 实施时长

约 90 分钟(spec 调研 + 基线矫正 25 + plan 10 + 实现 20 + 测试 15 + dep + typecheck fix 10 + build 10 + 文档 10)。

## R5 测试纪律

Medium feat ≥ 1 e2e 或 3 unit,本 feat 4 unit(H1-H4)— 达标 ✓。
