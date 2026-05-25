---
feat-id: md-editing-iter-3
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-editing-iter-3 — 2-plan(实施计划)

## 规模:Medium- ~80-100 行代码 + ~30 行测试 / 2 文件 / 0 上游侵入

锁版决策 **A/A/A/A/A**(白领基线 — GitHub MD CSS + iA Writer)。

## 实施顺序

### Phase 1 — markdownHighlightStyle + markdownSyntaxHighlight(~50 行)

**文件**:`packages/app/src/utils/markdown-editor-extensions.ts`

1. 补 import:
   ```ts
   import { HighlightStyle, foldGutter, foldKeymap, syntaxHighlighting } from "@codemirror/language"
   import { tags as t } from "@lezer/highlight"
   ```
2. 在文件顶部(PHRASES 之前)加 export `markdownHighlightStyle` + `markdownSyntaxHighlight`(spec 已给完整代码)
3. `markdownEditorExtensions()` 返回数组**开头**加 `markdownSyntaxHighlight`(在 foldGutter 之前;Prec.high 已确保优先级,顺序也排前安全)

### Phase 2 — Unit 测试(~30 行)

**文件**:`packages/app/src/utils/markdown-editor-extensions.test.ts`(追加 describe 段)

| # | 用例 |
|---|---|
| H1 | `markdownHighlightStyle` 是有效 HighlightStyle 实例(可用 `instanceof` 或 duck typing) |
| H2 | `markdownSyntaxHighlight` 是合法 Extension(typeof object,不 throw)|
| H3 | spec 列表全 — `HighlightStyle.define` 内部 specs 数组 ≥ 13 条(6 heading + strong/emphasis/monospace/quote/url/link/list/processingInstruction/contentSeparator)|
| H4 | heading1-6 字号梯度递减:h1=2em > h2=1.5em > h3=1.25em(防 copy-paste 数字错)|

### Phase 3 — 收尾

- `bun run typecheck` 16/16
- adapter 测试 517/517 不动(不触飞书)
- app 测试:既有用例 + 新 H1-H4 通过
- Build dev .app(C6)
- user 装新 .app 实测 C4-C8(打开 .md 看视觉 / 打开 .ts 看不影响 / 打开 .md 含代码块看 ts 关键字仍着色 / dark/light 双模式)
- 3-changelog + INDEX done + 改动日志.md entry

## commit 链(预期)

| # | commit |
|---|---|
| 1 | `docs(md-editing-iter-3): 1-spec` ✓ 已 commit `1b9f4c0ef` |
| 2 | `docs(md-editing-iter-3): 1-spec 矫正白领用户基线` ✓ 已 commit `52978936d` |
| 3 | `docs(md-editing-iter-3): 2-plan` (本笔) |
| 4 | `feat(md-editing-iter-3): markdownHighlightStyle + markdownSyntaxHighlight + 接入 + 4 单测` |
| 5 | `docs(md-editing-iter-3): 3-changelog + INDEX done + 改动日志` |

## 风险

| 风险 | 实施期对应 |
|---|---|
| 代码块内部高亮被 markdown highlight 抢占 | Build 后 user 打开 `.md` 含 ` ```ts ` 块验证 |
| heading 比例在小屏太大跳变 | A 档(2.0em h1) 实测;若问题降 D1=B(1.8em)|
| `monospace` 背景在 lineWrapping 多行 inline code 上断裂 | 接受(box-decoration-break 浏览器支持普遍 OK)|
| `Prec.high` 优先级解析错位导致 default tags 也被 markdown 覆盖 | H1-H4 单测 + 实测打开 .json 验证 |

## 不做(明确)

- 不改 `code-mirror-view.tsx`(generic 组件,markdown highlight 只通过 `extraExtensions` 注入)
- 不改 `defaultHighlightStyle`(保留作 fallback)
- 不加 D4(空行间距)/ D5(blockquote 左竖线)— 首期只动 highlight,看反馈再 iter-3.1
- 不加 `[data-context="md-editor"]` attribute(目前 highlight 走 JS spec 已足够,CSS 标记后续真需要时再加)
