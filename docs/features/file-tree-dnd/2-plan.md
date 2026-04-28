---
feat-id: file-tree-dnd
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md ./4-test-checklist.md
---

# 文件树拖放移动 — plan

## 实施步骤(4 笔 commit + 1 笔索引)

### Commit #1 — 拖放核心(~280 行)

**新文件**:
- `packages/app/src/utils/file-tree-dnd.ts` — `parseDataTransferPaths`、`isValidMoveTarget`(cycle 检测)、`uniqueParents`
- `packages/app/src/utils/file-conflict.ts` — `computeAvailableTarget(targetDir, sourceName)` 自动后缀算法

**改上游**:
- `packages/app/src/components/file-tree.tsx`:
  - `onDragStart` `effectAllowed: "copy"` → `"copyMove"`
  - 文件夹行 + 树根加 `onDragOver` / `onDragLeave` / `onDrop`
  - drag state signal(`dragging` / `dropTarget`)
  - 视觉:源行 opacity-50,目标行 ring-2
  - spring-load:hover 折叠文件夹 600ms 自动 expand
  - 错误用 showToast
- `packages/desktop/src-tauri/src/lib.rs`:
  - 加 `exists_path(path) -> bool` 命令(用于 conflict pre-check)
  - 注册到 `invoke_handler`

### Commit #2 — 多选系统(~180 行)

**新文件**:
- `packages/app/src/context/file/selection-store.ts` — `createSelectionStore()`:`paths()` / `add` / `remove` / `toggle` / `rangeSelect(anchor, target, flatNodes)` / `clear` / `isSelected`

**改上游**:
- `packages/app/src/context/file.tsx`:挂 `selection` 到 `useFile()` 返回值
- `packages/app/src/components/file-tree.tsx`:
  - 行 onClick 加 Shift/Ctrl 行为 + lastClicked anchor
  - dragstart 时如果 source 不在 selection → 先 clear+add
  - drop handler 改为遍历 selection 而非单个 source
  - 视觉:被选中行 `bg-surface-selected`(自定义 class,与 active 不同)

### Commit #3 — 剪切/粘贴/复制 + Tauri copy_path(~200 行)

**新文件**:
- `packages/app/src/context/file/clipboard-store.ts` — `createClipboardStore()`:`{ mode: "cut"|"copy"|null, paths }` + `setCut` / `setCopy` / `clear`
- `packages/app/src/hooks/use-file-tree-shortcuts.ts` — 全局 keydown 监听,在文件树聚焦时触发 Ctrl+X/C/V/Z

**改上游**:
- `packages/desktop/src-tauri/src/lib.rs`:
  - 加 `copy_path(from, to) -> Result<(), String>` 命令(含 `copy_dir_all` 助手)
  - 注册到 `invoke_handler`
- `packages/app/src/context/file.tsx`:挂 `clipboard` 到 `useFile()`
- `packages/app/src/components/file-tree.tsx`:
  - `renderRowMenuItems` 加剪切/复制/粘贴 ContextMenu.Item(粘贴仅文件夹行 + clipboard 非空时显示)
  - 视觉:被剪切的行 opacity-60 + italic
  - 引入 use-file-tree-shortcuts hook

### Commit #4 — Undo + 外部文件拖入(~250 行)

**新文件**:
- `packages/app/src/context/file/undo-stack.ts` — `createUndoStack()`:`push(entry)` / `pop()` 容量 20
  - entry 类型:`{ kind: "move", pairs }` 或 `{ kind: "copy", created }`
  - pop 时执行反向 rename / trash + 刷新

**改上游**:
- `packages/app/src/context/file.tsx`:挂 `undoStack`
- `packages/app/src/components/file-tree.tsx`:每次 move/copy 操作 push 到 undo stack;Ctrl+Z 通过 use-file-tree-shortcuts 触发 pop
- `packages/branding/tauri-overrides/{dev,beta,prod}.json`:注入 `app.windows[0].dragDropEnabled = false`(让 webview 接收 drop event 而非 OS 接管)
- `packages/app/src/components/file-tree.tsx`:onMount 注册 `getCurrentWebviewWindow().onDragDropEvent`,drop 时通过 `elementFromPoint(x, y)` 找 folder row,调 copy_path

### Commit #5 — 索引收尾(~30 行)

回填 4 个 commit hash 到 `docs/features/file-tree-dnd/3-changelog.md`,改动日志.md 加索引行 + push origin。

## 决策轨迹(开发中追加)

### D1 (规划阶段) — 用 HTML5 drag API 还是 @thisbeyond/solid-dnd?

- HTML5 已经是 onDragStart 现状,继续用保持风格统一
- solid-dnd 适合排序/重排,不适合"drop 到任意 target"
- **结论**: HTML5

### D2 — selection/clipboard/undo 放哪?

- 候选 A:扩展 tree-store.ts(上游)
- 候选 B(选用):新文件,放 `context/file/` 目录,挂到 `useFile()` 返回值
- **理由**: P1 隔离原则,fork 自有逻辑放新文件,改动只在 `file.tsx` 加 1-3 行挂载

### D3 — Tauri 外部文件拖入怎么开?

- tauri.conf.json `dragDropEnabled` 默认 `true`(OS 接管,JS 收不到)
- 候选 A:改 tauri.conf.json(触发黑名单 override)
- 候选 B(选用):改 `packages/branding/tauri-overrides/*.json`(已有的品牌覆盖配置,合法路径)
- **理由**: 0 黑名单 override

(后续踩坑追加)

## 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| `std::fs::rename` 跨设备失败 | 中 | v1 toast 报错,文档写明 |
| 多选拖动部分失败 | 中 | 失败 entry 单独 toast,成功不回滚(类资源管理器) |
| Undo 跨 session 不持久 | 低 | v1 in-memory,文档写明 |
| HTML5 drag 与 Tauri WebviewWindow event 双轨冲突 | 中 | 树内拖用 HTML5,外部拖入用 Tauri event,通过 dataTransfer 是否有 paths 区分 |

## 预算

- 改上游:`file-tree.tsx` ~400 + `file.tsx` ~30 + `lib.rs` ~50 = ~480 行
- 新文件 fork-only:5 个 utility / store / hook ~ 380 行
- 新文件 docs:本目录三文档 ~ 300 行
- 总:~1160 行,4 笔 commit 平均 ~290/笔,过 500 阈值的笔走 [large-diff]
