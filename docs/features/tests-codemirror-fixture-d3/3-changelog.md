---
feat-id: tests-codemirror-fixture-d3
status: done
related: ./3-changelog.md
---

# 3-changelog — D3 CodeMirror Mock View + 6 Command + handlePasteHook 测试

## 起源

D 系列任务第 2 笔(D4 → **D3** → D1 → D2)。

D3 目标:CodeMirror EditorView fixture setup,完成 `markdown-editor-extensions.ts` Command 类覆盖。

## 关键洞察:不需要真 EditorView

CodeMirror Command 接受 `EditorView` 但**只用 `view.state` + `view.dispatch`**。可以用 EditorState + 简化 dispatch 构造 mock view,**避开 happydom 对 EditorView measurement / DOM observer 的兼容问题**。

```ts
function makeMockView(initial: string, cursor?: number): { view: EditorView; getDoc: () => string } {
  let state = EditorState.create({ doc: initial, selection: cursor ? { anchor: cursor } : undefined })
  const view = {
    get state() { return state },
    dispatch: (spec: unknown) => { state = state.update(spec).state },
  } as unknown as EditorView
  return { view, getDoc: () => state.doc.toString(), getCursor: () => state.selection.main.head }
}
```

这是 D3 的核心成果,**比真 EditorView fixture 更稳定**(不依赖 happydom)。

## 改动清单

### 修改 — 6 个 Command + handlePasteHook 加 export

`packages/app/src/utils/markdown-editor-extensions.ts`:
- `continueListCommand` → `export const`
- `toggleBoldCommand` / `toggleItalicCommand` → `export const`
- `insertLinkCommand` → `export const`
- `toggleTaskCheckCommand` → `export const`
- `tableTabCommand` → `export const`
- `handlePasteHook` → `export function`

每处加 `// FORK: export for unit tests(D3) 2026-05-07`。0 行为变化。

### 新文件 — `markdown-editor-extensions-commands.test.ts`(~310 行 / 36 测试)

| 测试组 | 测试数 | 重点 |
|---|---|---|
| **toggleBoldCommand** | 2 | 无选区插入 ** ** 中位 + 有选区包 ** + 选区保留 |
| **toggleItalicCommand** | 2 | 同 bold 但用 _ |
| **insertLinkCommand** | 2 | 无选区 []() + 有选区 [选中]() + 光标进 () |
| **toggleTaskCheckCommand** | 8 | [ ]↔[x] / [X]→[ ] / **空 [] → [x]**(Tier B 放宽)/ 缩进 / 非 task 返 false / 多行光标定位 |
| **continueListCommand** | 9 | 续 - / 续 1.→2. 编号递增 / 空 bullet 退出 / 续 - [ ] / 续 > / 缩进保留 / 普通段返 false / 选区返 false |
| **tableTabCommand** | 5 | 同行跳下 cell / 非表格行返 false / 选区返 false / 表格行末跳下行 / 末行跳普通行 |
| **handlePasteHook** | 8 | 无选区返 false / **选区+URL→改写 [选中](URL)**(preventDefault/stopPropagation 校验)/ 选区+非 URL 返 false / **text/uri-list fallback** / **uri-list 多行取首非 #**/ URL 含 query+fragment 完整保留 / 非 URL 含空格返 false / clipboardData null 防御 |

## 测试结果

```
$ bun test src/utils/markdown-editor-extensions-commands.test.ts
36 pass / 0 fail (59 expect calls / 215ms)

$ bun run test:unit (full suite)
472 pass / 1 fail (kobalte SSR 老坑无关)
437 → 473 (+36 全 pass)
```

## 关键模块覆盖率推进

| 文件 | 之前 | 本笔后 | 达 80%? |
|---|---|---|---|
| `md-export-docx.ts` | ~100% | ~100% | ✅(D4 已达)|
| **`markdown-editor-extensions.ts`** | ~17% | **~75%**(估算)| **接近** — 主要 Command + helpers 全测,剩 3 个异步路径 |
| `dialog-settings.tsx` | 0% | 0% | ✗ — D1 范围 |
| `file-tabs.tsx` | 0% | 0% | ✗ — D2 范围 |

`markdown-editor-extensions.ts` 实际覆盖深度估算:
- **数据 / 模式**:`PHRASES` / 4 LIST_PATTERNS / TASK_PATTERN / URL_PATTERN / IMAGE_EXT_PATTERN — 全 ✓
- **同步 helper**:`timestampName` / `depthOf` — 全 ✓
- **同步 Command**:6 个 — 全 ✓
- **同步 handler**:`handlePasteHook` — ✓
- **未测**:`readFileAsBase64`(异步 FileReader)/ `handleImageDrop`(异步 + invoke + FileReader)/ `markdownEditorExtensions`(主入口,通过 e2e 间接覆盖)

## D 系列任务进度

```
D4 (Tauri invoke mock + inlineLocalImages 100%):  ✓ done
D3 (mock view + 6 Command + handlePasteHook):     ✓ done(本笔)
D1 (SolidJS component test setup):                下一笔
D2 (file-tabs.tsx ~2000 行):                      最后
```

## 后续 mock view 模式复用价值

D3 建立的 `makeMockView` 工厂可复用到任何 CodeMirror Command 测试 — DeskFox 后续如果加新 Command,直接抄 fixture。比"真 EditorView + happydom 全配齐"模式快 5-10x。

## 规模 / R 标记

- 规模:Medium(~310 行测试 / +6 行 export 注解 / 2 文件 / 0 R4 / 0 上游侵入)
- R2 FORK marker:✓
- R3 黑名单:无
- R4 override:无
- R5 测试纪律:本 feat 是测试,自然满足

## 下一步:D1 — SolidJS component test setup

下一笔进入 D1 范围:`dialog-settings.tsx` SolidJS component test 起步。需要:
- 引入 `@solidjs/testing-library`(可能需 `bun add -D`)
- setup render / fire event / query DOM 模式
- 第 1 个 component test 跑通后,后续 component 复用此模式
