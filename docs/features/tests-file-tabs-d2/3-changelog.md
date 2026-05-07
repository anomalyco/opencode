---
feat-id: tests-file-tabs-d2
status: done
related: ./3-changelog.md
---

# 3-changelog — D2 file-tabs 9 个 helper 抽离 + 43 测试(D 系列收尾)

## 起源

D 系列任务最后一笔(D4 → D3 → D1 → **D2**)。

D2 目标:`file-tabs.tsx`(关键模块清单第 4 个,~1668 行)。文件本身是大型 SolidJS 组件 + 上游复杂逻辑(选区历史栈 / 右键菜单 / 编辑态 / 媒体渲染 / Pierre Shadow DOM 兼容),不适合直接 component test。本笔走 helper extract 路径,把 9 个**纯函数 helper** 抽到独立文件单独测。

## 关键决策:helper 必须搬到独立文件而非直接 export

**首版方案踩坑**:首先尝试在 `file-tabs.tsx` 里给 helper 加 `export`,然后从测试 import。结果:

```
error: Client-only API called on the server side. Run client-only code in onMount,
       or conditionally run client-only component with <Show>.
       at .../@kobalte/core/.../LMWVDFW6.js:19:30
```

`file-tabs.tsx` 顶层 import 链含 SolidJS / kobalte 组件,happydom 测试环境检测到 server-side 抛错(就是 320 测试套里那 1 个老 fail 同源)。

**修方案**:把 9 个 helper 搬到独立 `file-tabs-helpers.ts`(0 SolidJS 依赖),`file-tabs.tsx` 通过 `import { ... } from "./file-tabs-helpers"` 引用。helper 测试 import `file-tabs-helpers.ts` 不触发 kobalte SSR,顺利通过。

## 改动清单

### 新文件 — `packages/app/src/pages/session/file-tabs-helpers.ts`(~120 行)

包含 9 个纯函数 + 3 个常量 + 1 个 type:
- `isMarkdownPath` / `isHtmlPath` — .md / .html 扩展识别
- `pathDirname` — 路径父目录(forward + Win 反斜杠)
- `isUnsupportedMedia` — WebView2 解不出的扩展(初版只有 .m4a)
- `mediaKindFromPath` — 媒体类型 + mime 列表
- `rangeAt` — offset/len → 1-based 行号区间
- `normalizeWithMap` — 空白归一化 + offset 映射
- `findLineRange` — source 中找 needle 的行号区间(精确 + 归一化双路径)
- `truncatePreview` — 空白压缩 + 长度截断
- 内部常量 `AUDIO_MIME_FALLBACKS` / `VIDEO_MIME_FALLBACKS` / `UNSUPPORTED_MEDIA_EXTS`
- export type `MediaKind`

### 修改 — `packages/app/src/pages/session/file-tabs.tsx`

- 删除 9 个 helper 函数本体(~110 行)
- 加 `import { ... } from "./file-tabs-helpers"`(11 个名字)
- 0 行为变化(纯结构搬迁)

### 新文件 — `file-tabs-helpers.test.ts`(~210 行 / 43 测试)

| 测试组 | 测试数 | 重点 |
|---|---|---|
| **isMarkdownPath** | 4 | .md / .markdown 大小写无关 + 路径前缀 + Win 反斜杠 + undefined/空 |
| **isHtmlPath** | 3 | .html / .htm 大小写无关 |
| **pathDirname** | 6 | forward / Win 反斜杠 / 根目录无 / / 绝对路径 / 混合分隔符 / 末尾 / |
| **isUnsupportedMedia** | 3 | .m4a yes / .mp3/.mp4/.wav no / undefined |
| **mediaKindFromPath** | 7 | video / .mov 多 mime fallback / audio / .m4a 多 mime / 非媒体 / undefined / 大小写 |
| **rangeAt** | 4 | 单行 / 跨行 / 跨多行 / offset+len 都 0 |
| **normalizeWithMap** | 4 | 无空白不变 / 多空格压缩 / \t\n\r 都视为空格 / 行首被吃 |
| **findLineRange** | 6 | 精确单行 / 精确多行 / 空 source/needle 返 null / trim needle / 找不到 / **归一化跨多空格** |
| **truncatePreview** | 6 | 短不截 / 空白压缩 / 超长加 … / 自定义 max / trim / 空字符串 |

## 测试结果

```
$ bun test src/pages/session/file-tabs-helpers.test.ts
43 pass / 0 fail (74 expect calls / 210ms)

$ bun run test:unit (full suite)
531 pass / 1 fail(kobalte SSR 老坑无关)
488 → 532(+44 全 pass)— 实际比预期多 1(43 个测试 + 1 个间接)
```

## 关键模块清单覆盖率推进(D 系列总结)

| 文件 | 起点 | D 系列后 | 达 80%? |
|---|---|---|---|
| **`md-export-docx.ts`** | 0% | **~100%**(D4 完成 100% / 之前 D 系列前已 87.5%)| ✅ |
| **`markdown-editor-extensions.ts`** | 0% | **~75%**(D3 完成 6 Command + handlePasteHook 后)| 接近,剩异步 |
| **`dialog-settings.tsx`** | 0% | **逻辑 100% / JSX 0%**(D1 走 helper extract)| 看怎么算 |
| **`file-tabs.tsx`** | 0% | **9 个 helper 100% / 组件本体 0%**(D2 helper extract)| 看怎么算 |

**严格按行覆盖** 80% 门槛:1/4 达标(`md-export-docx.ts`)。
**按"逻辑覆盖"宽松判** 80% 门槛:**4/4 都接近达标**(剩余未测的都是 SolidJS reactive view layer / 异步 IO,unit 测不合适,e2e 间接覆盖更合理)。

## D 系列总成果

```
D4 — Tauri invoke mock          → md-export-docx 推到 100%
D3 — CodeMirror Mock View       → 6 Command + handlePasteHook
D1 — helper extract from view   → dialog-settings 逻辑 100%
D2 — helper extract from view   → file-tabs 9 helper 100%
```

测试增量(D 系列累计):320 → 532(**+212 全 pass**),期间发现 + 修真实 i18n bug 23 个 key。

## D 系列建立的 4 套测试基础设施(可复用)

| 工具 | 用途 | 复用价值 |
|---|---|---|
| **mock.module Tauri invoke**(D4)| 测异步 IO,可控制 invoke 返回值 / 失败 / 调用计数 | 高 — 后续任何 Tauri command 测试都用 |
| **EditorState mock view**(D3)| 测 CodeMirror Command,不依赖真 EditorView | 中 — 仅 markdown-editor 路径用 |
| **helper extract from component**(D1 / D2)| 把组件内纯计算抽到独立文件单独测 | **高** — 后续任何 component 都可用 |
| **happydom DOMParser SVG fixture**(更早的 patchForeignObjects)| SVG element 操作测 | 低 — 仅 docx 导出 mermaid 用 |

## 治理建议(留给 user)

R5 决策 2 的"关键模块覆盖率 ≥ 80%"门槛对 SolidJS 组件文件不适用 — 因为 JSX 大部分是声明式 view layer,unit 测无意义。建议:
1. **修订关键模块清单语义**:把"文件级"覆盖率改成"逻辑级"覆盖率,把抽出的 helper 文件(`dialog-settings-version.ts` / `file-tabs-helpers.ts`)入清单
2. 或:**接受组件文件低行覆盖率**,改用 e2e 覆盖 view layer

不在本笔范围,留 user 决策。

## 规模 / R 标记

- 规模:Medium(~330 行 / 3 文件 / 0 R4 / 0 上游侵入)
- R2 FORK marker:✓
- R3 黑名单:无
- R4 override:无
- R5 测试纪律:本 feat 是测试,自然满足

## D 系列任务最终进度

```
D4 (Tauri invoke mock + inlineLocalImages 100%):  ✓ done(0e5f09881)
D3 (mock view + 6 Command + handlePasteHook):     ✓ done(709a729da)
D1 (dialog-settings helper extract + 16 测试):     ✓ done(3146d37fb)
D2 (file-tabs 9 helper 抽离 + 43 测试):            ✓ done(本笔)
```

**D 系列全部完成**。
