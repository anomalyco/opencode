---
feat-id: tests-markdown-editor-extensions
status: in-progress
related: ./3-changelog.md
---

# 3-changelog — markdown-editor-extensions 易测纯函数 / 数据覆盖

## 起源

R5 决策 2 关键模块清单第 2 个文件 `markdown-editor-extensions.ts`(~440 行,11 项编辑增强 + Ctrl+F 搜索)。本笔覆盖**易测的纯函数 / 数据**,Command 类 / 异步 IO 转 backlog。

**透明声明**:本笔**未达 80% 行覆盖率门槛**(估算 ~17%),但已覆盖文件中所有适合 unit test 的部分。剩余 80%+ 是 CodeMirror Command(需 EditorView fixture)+ 异步 IO(需 mock Tauri invoke),独立 backlog。

## 改动清单

### 修改 — 7 个 helper 加 export 注解

`packages/app/src/utils/markdown-editor-extensions.ts`:
- `PHRASES` → `export const`(CodeMirror 搜索面板 i18n dict)
- `LIST_PATTERNS` → `export const`(4 个 regex:task / numbered / plain / blockquote)
- `TASK_PATTERN` → `export const`
- `URL_PATTERN` → `export const`
- `IMAGE_EXT_PATTERN` → `export const`
- `timestampName` → `export function`
- `depthOf` → `export function`

每处加 `// FORK: export for unit tests 2026-05-07`。0 行为变化。

### 新文件 — `markdown-editor-extensions.test.ts`(~280 行 / 42 测试)

| 测试组 | 测试数 | 重点 |
|---|---|---|
| **LIST_PATTERNS** | 12 | 4 个子模式各自匹配 / 不匹配 + 缩进处理 + marker 变体(* / + / -) |
| **TASK_PATTERN** | 4 | `[ ]` / `[x]` / `[X]` / **空 `[]`(Tier B 放宽)** |
| **URL_PATTERN** | 4 | http/https / 相对 / file: / mailto: / 含空格不匹配 |
| **IMAGE_EXT_PATTERN** | 3 | 9 种扩展名大小写 / 非图片扩展 / 路径前缀 |
| **timestampName** | 5 | 带扩展 / 无扩展默认 png / 空字符串 / 多 . / ISO 时间格式校验 |
| **depthOf** | 8 | undefined/空 / 根目录 / 一层 / 多层 / Windows 反斜杠 / 混合分隔符 / 前导末尾 / / 连续 // |
| **PHRASES** | 4 | zh/zht 双本对齐 / 11 个核心 key 全覆盖 / zh ≠ zht(防 copy-paste) |

## 测试结果

```
$ bun test src/utils/markdown-editor-extensions.test.ts
42 pass / 0 fail (128 expect calls)

$ bun run test:unit (full suite)
414 pass / 1 fail (kobalte SSR 老坑无关)
373 → 415 (+42 全 pass)
```

## 关键模块清单覆盖率推进

| 文件 | 之前 | 本笔后 | 达 80%? |
|---|---|---|---|
| `markdown-editor-extensions.ts` | 0% | **~17% 行覆盖**(7 helpers / 数据) | ✗ — 易测部分已覆盖,Command 类待 EditorView fixture |
| `dialog-settings.tsx` | 0% | 0% | ✗ |
| `file-tabs.tsx` | 0% | 0% | ✗ |
| `md-export-docx.ts` | ~87.5%(前笔达标)| ~87.5% | ✓ |

## 未覆盖的部分(转 backlog)

剩 11 项是 **CodeMirror Command 类** + **异步 IO**:

### CodeMirror Command(需 EditorView fixture)

- `continueListCommand` — Enter 智能续行(列表 / 编号 / 任务 / 块引用)
- `makeWrapCommand` 工厂 → `toggleBoldCommand` / `toggleItalicCommand`
- `insertLinkCommand` — Ctrl+K 插入链接
- `toggleTaskCheckCommand` — Ctrl+Enter 任务勾选 toggle
- `tableTabCommand` — 表格 Tab 跳格

**为什么转 backlog**:这些 Command 需要 `EditorView`(含真实 DOM、selection、dispatch transaction 系统)。happydom 是否完整支持 CodeMirror 的 view 层未验证,需要 setup 步骤(可能引入 jsdom + getComputedStyle polyfill)。setup 一次后这 6 个 command 测试预计能写得快,但 setup 本身是独立 feat。

### 异步 IO(需 mock Tauri invoke)

- `handlePasteHook` — 粘贴事件处理(图片识别 + URL 智能粘贴)
- `readFileAsBase64` — FileReader 异步读
- `handleImageDrop` — 拖入图片写盘 + 插入 markdown ref(调 `write_binary_file_absolute_base64`)

**为什么转 backlog**:依赖 `@tauri-apps/api/core` 的 `invoke`,需 module mock(bun test 自带 `mock` API 但需要 setup)。同样是"setup 一次复用"性质。

### 主入口

- `markdownEditorExtensions(opts)` — 集合所有扩展返回 Extension[]。返回值是 CodeMirror 内部数据结构,断言成本高,**通过 e2e 间接覆盖**更合适。

## 下一步建议(给 user 决策)

| 选项 | 内容 | 投入 |
|---|---|---|
| **D1** | 推进 `dialog-settings.tsx` 测试(SolidJS component test setup + 第 3 个关键模块开始)| 中(setup 1 次)|
| **D2** | 推进 `file-tabs.tsx` 测试(最复杂,~2000 行,选区 / 渲染 / 编辑态)| 高 |
| **D3** | 给 `markdown-editor-extensions.ts` 上 EditorView fixture,完成它到 80% | 高(setup CodeMirror 测试基础设施)|
| **D4** | 接 inlineLocalImages 的 Tauri invoke mock,顺手把 md-export-docx 推到 100% + 给 markdown-editor 同基础 | 中 |

**Claude 推荐**:**D1**(进入 SolidJS component test setup 阶段)— 因为 `dialog-settings.tsx` 是用户高频接触界面,新加测试覆盖直接价值;且 setup component test 一次后,后续 `dialog-custom-provider.test.ts`(已存在但 test 简单)可以扩,价值复用。

## 规模 / R 标记

- 规模:Medium(~280 行测试 / +7 行 export 注解 / 2 文件 / 0 R4 / 0 上游侵入)
- R2 FORK marker:✓
- R3 黑名单:无
- R4 override:无
- R5 测试纪律:本 feat 是测试,自然满足

## status 选 in-progress 的理由

按 R5 决策 2 关键模块覆盖率 ≥ 80% 是硬门槛,本笔仅达 ~17%。**transparent reporting 优先于 status flag**:即使本笔交付完整(覆盖了所有易测部分),也不应标 done 让 user 误以为达标。后续完整覆盖后再升 done。
