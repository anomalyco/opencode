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

### Commit #4 — Undo + 外部文件拖入 FileReader 路径 + tree-store fix(~390 行)

**新文件**:
- `packages/app/src/context/file/undo-stack.ts` — `createUndoStack()`:容量 20,push/pop/clear/size
  - entry 类型:`{ kind: "move", pairs }` 或 `{ kind: "copy", created }`
  - pop 调用注入的 reverter,reverter 自己跑反向 rename/trash + 返回需刷新目录列表
- `docs/features/file-tree-dnd/4-test-checklist.md` — 全套 32 条测试(A-G 七组)

**改上游**:
- `packages/app/src/context/file.tsx`:挂 `undoStack` 到 `useFile()`
- `packages/app/src/context/file/tree-store.ts`(**关键 fix**):`force=true` 必须绕过 inflight check;原版本即便 force 也会等到旧 inflight 的 stale promise → 拖放后刷新拉到操作前的列表(详见 D5)
- `packages/desktop/src-tauri/src/text_file.rs`:加 `write_binary_file_absolute_base64(path, base64)` 命令(500MB 上限,已存在则报错)
- `packages/desktop/src-tauri/src/lib.rs`:注册新命令
- `packages/app/src/components/file-tree.tsx`:
  - `handleMoveDrop` / `pasteTo` 末尾 push undo 对应 entry
  - 新增 `handleExternalDrop(File[])` 走 FileReader → base64 → invoke `write_binary_file_absolute_base64`
  - 新增 `readFileAsBase64(file)` helper
  - 新增 `undoLast()`:从 undoStack pop,执行反向 rename/trash,刷新涉及目录
  - Ctrl+Z 接入 `useFileTreeShortcuts`(只在 level 0 注册,与剪切粘贴一致)
  - `dropHandlers.onDragOver` 接受外部 OS files(`dataTransfer.types` 含 `"Files"`)
  - `dropHandlers.onDrop` 优先处理 `dataTransfer.files`(走 FileReader 路径)

### Commit #5 — 索引收尾(~13 行)

回填 4 笔 commit hash 到 `3-changelog.md`,改动日志.md 加 `file-tree-dnd` 索引行,4 文档全部 status: in-progress → done,`.gitignore` 加 `.obsidian/`。

## 决策轨迹(开发中追加)

### D1 (规划阶段) — 用 HTML5 drag API 还是 @thisbeyond/solid-dnd?

- HTML5 已经是 onDragStart 现状,继续用保持风格统一
- solid-dnd 适合排序/重排,不适合"drop 到任意 target"
- **结论**: HTML5

### D2 — selection/clipboard/undo 放哪?

- 候选 A:扩展 tree-store.ts(上游)
- 候选 B(选用):新文件,放 `context/file/` 目录,挂到 `useFile()` 返回值
- **理由**: P1 隔离原则,fork 自有逻辑放新文件,改动只在 `file.tsx` 加 1-3 行挂载

### D3 — Tauri 外部文件拖入(初版方案,后被推翻,见 D8)

- 计划:tauri-overrides 注入 `dragDropEnabled: false` + Tauri `onDragDropEvent` API
- 实测被推翻,见 D8

### D4(commit #3 中途) — JS 路径分隔符歧义 → Rust `next_available_path`

- 第一版 JS 端 `joinAbs` 用 `/`,Windows 实际 path 用 `\`,Tauri `exists_path` 在 mixed `\\...\\word/file.txt` 路径上偶发误判 → `computeAvailableTarget` 返回了**未带后缀**的 initial path → 后续 `copy_path` 报 `already_exists`
- **决策**:把整个 conflict-resolution 算法**整体下沉到 Rust** `next_available_path(dir, name)`,OS 原生 Path 处理,JS 侧只一次 invoke 拿结果
- 副效果:省了 N 次 Tauri 往返(以前 base-1/base-2... 每个都要 invoke 一次 exists_path)

### D5(commit #4 中途) — tree-store `force=true` 不真 force

- 用户报"文件夹内还显示已被移走的文件,刷新页面也不消失,只有变动其他文件才消失"
- 深挖:tree-store `listDir` 即便 `opts.force === true`,仍有 `if (pending) return pending` 检查 → 返回的可能是当前进行中的、操作前发起的 stale fetch 的 promise → store 拿到的是 stale 数据
- **决策**:把 inflight 检查包进 `if (!opts?.force)`,force 必须真重新发起 fetch
- 这是上游 tree-store 的轻微 bug,加 FORK marker 修

### D6(commit #3 中途) — Ctrl+V 触发 N 次粘贴 → hook 仅 level 0 注册

- 用户报粘贴动作做了多次,从第二次起 `already_exists`(实际产生 `-1`、`-2`... 多个副本)
- 根因:`useFileTreeShortcuts` 在每个 FileTree 实例都调,而 FileTree 是**递归组件** — 每展开一级就实例化一次,每个都注册 window keydown listener → Ctrl+V 一次按键触发 N 次回调
- **决策**:hook 仅在 `level === 0` 的 FileTree 实例注册

### D7(commit #3 中途) — `{...rest}` 覆盖 onContextMenu / onClick

- 用户报右键不正确改 selection;深挖发现 `splitProps` 漏列了 `onContextMenu`,所以它留在 `rest` 里(虽然没值)→ JSX `{...rest}` 把 `onContextMenu={undefined}` 覆盖到我之前手动绑的 handler 上
- **决策**:把 `onClick` 和 `onContextMenu` 都拽进 `local`,在 Dynamic 上手动绑 + 与原 callback 组合

### D8(commit #4 中途) — 外部 OS 文件 drop 终选方案

- ❌ 方案 A:Tauri WebviewWindow `onDragDropEvent` API(以为最 native)
  - 实测在本环境不工作(原因未定位,可能 Tauri 2 capability/版本/dragDropEnabled 配置交互),即便加了 `dragDropEnabled: false` 注入 + DPR 转换 + 元素查找,均未触发
- ❌ 方案 B:`dragDropEnabled: false` 让 webview 收 HTML5 drop,读 `file.path`(非标准但部分 webview 暴露)
  - 实测 Windows WebView2 给的 File 对象**没有** `.path`(诊断 toast 验证 keys 为空 + path=undefined)
- ✅ 方案 C(选用):**HTML5 drop + FileReader 读内容**
  - 默认 dragDropEnabled 配置(true,可不动 tauri-overrides),webview 仍能收 HTML5 drop event(实测 attachments.ts 的 chat input drop 一直工作的事实可证)
  - `FileReader.readAsDataURL` 读 base64 → invoke 新加的 `write_binary_file_absolute_base64` Rust 命令写盘
  - 副作用:文件夹拖入 HTML5 不递归,v1 跳过(已知限制)

### D9 — Tauri build rename 偶发 PermissionDenied

- Cargo 编译完 `opencode-desktop.exe`,Tauri 准备 rename 成 `DeskFox.exe` 时偶发 `PermissionDenied`(Windows Defender 实时扫描刚 build 完的 exe 锁住)
- 临时解法:手动 PowerShell `Move-Item opencode-desktop.exe DeskFox.exe`
- 后续如复现,可在 CLAUDE.md 验证约定段补"如 build 末段 rename fail,手动 mv 即可"

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
