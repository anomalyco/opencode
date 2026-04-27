---
feat-id: file-tree-dnd
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 文件树拖放移动 — changelog

## Commit #1 — 拖放核心

**关联 commit**: `4b73b1229`
**所在分支**: `feat/editable-file-viewer`
**baseline tag**: 沿用线
**实际改动**: 见 2-plan.md "Commit #1" 段

**行数**:
- 新文件: `utils/file-tree-dnd.ts` 95 + `utils/file-conflict.ts` 50 = 145
- 新文件 docs: `docs/features/file-tree-dnd/{1-spec,2-plan,3-changelog,INDEX}` ≈ 280
- 改上游: `file-tree.tsx` +152 / `lib.rs` +8 / `docs/features/INDEX.md` +1 = +161
- 总 staged: ~586 行(走 `[large-diff: 含三文档骨架 + 拖放核心,紧耦合]`)

**验收(user 已手测通过 2026-04-27)**:
- T1 跨目录拖文件 → 移动 ✅
- T2 同名自动后缀 ✅
- T3 拖父进子 → 静默拒绝 ✅
- T4a/b 拖到自身目录 / 自身 → no-op ✅
- T5 spring-load 600ms 自动展开折叠目录 ✅(初版有 bug 已 fix:state undefined 算"未展开"+ dragleave 不动 timer)
- T10a/b/c/d 视觉反馈 + 出 tree 不影响其他 drop 目标 ✅
- T11 跨设备 move 错误 toast(未实测,见已知遗留)

**踩坑记录**:
1. spring-load 第一版判断 `if (state && !state.expanded)` 漏了 `state===undefined` 的从未打开过的目录,导致这些目录不会 spring-load。改成 `!state?.expanded` 覆盖两种情况
2. `onDragLeave` 在子元素之间移动时会假触发(HTML5 已知坑),会反复清 spring timer。改成 timer 只在 `onDragOver` 检测到 target 切换时重置,dragleave 不动 timer。root 区域单独有 dragleave 用 relatedTarget 判定真离开

## Commit #2 — 多选系统

**关联 commit**: `ce043ee69`
**实际改动**:
- 新文件 `packages/app/src/context/file/selection-store.ts` (~85 行):`createSelectionStore()`,提供 `paths()` / `add` / `remove` / `toggle` / `replace` / `clear` / `isSelected` / `setAnchor` / `rangeSelect(target, flatVisible)`
- `packages/app/src/context/file.tsx`(+5 行):`createSelectionStore()` + 挂到 `useFile().selection`
- `packages/app/src/components/file-tree.tsx`(~80 行):
  - FileTreeNode 加 `selected` / `onSelectMaybe` / `computeDragSources` props,把 `onClick` 拽进 `local` 与 `handleClick` 组合(避免 {...rest} 覆盖)
  - selected 视觉:`ring-1 ring-interactive-base ring-inset`(区分于 active 的 filled bg)
  - dragstart:多源走 `application/x-deskfox-paths` MIME(JSON 数组),单源沿用原 `text/plain "file:<rel>"` 协议(兼容 attachments)
  - FileTree component 加 `handleRowSelect`(普通/Shift/Ctrl 三态)+ `computeDragSources`(单/多源切换)
  - 普通 click 不阻止默认 → expand/open file 仍正常
  - Shift+click 范围选用 `nodes()` 的 absolute 列表(同层 FileTree 内 ok,跨层降级为单选,可接受 v1)

**行数**: 87 行(< 500 阈值,无 large-diff 标记)

**验收(user 已手测通过 2026-04-27)**:
- T6a Ctrl+click 选 3 个 → 拖第一个 → 三个都移动 ✅
- T6b Shift+click 范围选 ✅
- T6c 修饰键时不打开/不展开 ✅
- T6d 拖动期间所有源行 opacity-50 ✅
- T6e selected ring vs active fill 视觉区分 ✅
- T6f 普通单 click 重置 selection,正常 open/expand ✅
- T6g 拖未选中的文件,selection 不被覆盖 ✅

## Commit #3 — 剪切/粘贴/复制 + Tauri copy_path + 批量删除 + 多个 UX 修复

**关联 commit**: `<待填>`
**实际改动**:
- 新文件 `packages/app/src/context/file/clipboard-store.ts` (~60 行):`createClipboardStore()`(mode/paths/setCut/setCopy/clear/isCut/hasContent)
- 新文件 `packages/app/src/hooks/use-file-tree-shortcuts.ts` (~85 行):全局 keydown 监听,触发条件 = `focus 在文件树` OR (`selection 非空` + `focus 不在可编辑控件`),支持 onCut/onCopy/onPaste/onUndo
- `packages/desktop/src-tauri/src/lib.rs`(+50 行):
  - `copy_path(from, to)` 命令 + `copy_dir_recursive` 助手(递归复制目录,symlink 报错)
  - `next_available_path(dir, name)` 命令 — Rust 端一次性算出不冲突目标(替代 JS 多次 exists_path 调用,避免 `\` vs `/` path 分隔符歧义)
  - `split_name_ext` 助手与 JS 同语义
- `packages/app/src/utils/file-conflict.ts`(改 30 → 22 行):`computeAvailableTarget` 退化为单次 invoke `next_available_path`,JS 不再算 path
- `packages/app/src/utils/file-tree-dnd.ts`(+5 行):`isValidMoveTarget` 加 `allowSameDir` 选项(copy 模式同目录创建副本是合理的)
- `packages/app/src/context/file.tsx`(+5 行):createClipboardStore 挂到 `useFile().clipboard`;`tree.node` 暴露给 paste 用
- `packages/app/src/components/file-tree.tsx`(~150 行):
  - `clipboard` / `cutFor` / `copyFor` / `pasteTo` / `pasteSmart` / `findNodeByAbsolute` / `handleRowContextMenu`
  - FileTreeNode 加 `cut` / `onRowContextMenu` props,把 `onClick` + `onContextMenu` 拽进 local 避免 `{...rest}` 覆盖
  - `renderRowMenuItems` 加剪切/复制/粘贴(文件夹"粘贴到此文件夹",文件"粘贴到当前目录")
  - 树根菜单加"粘贴到项目根"(clipboard 非空)
  - `promptDelete` 复用 `sourcesFor` 支持批量删除("批量删除 N 个项目"对话框)
  - 视觉:被剪切行 opacity-60 + italic
  - **重要 fix**:hook 仅 level 0 注册(FileTree 是递归组件,每层注册 N 个 keydown listener 会让 Ctrl+V 粘贴 N 次)

**行数**: ~395 行(含 Rust 50 + JS 280 + bindings 自动生成 + docs/changelog ~15)

**踩坑记录**:
1. **`{...rest}` 覆盖 onContextMenu**:用户右键时 selection 没切换。根因 splitProps 漏了 `onContextMenu`,被 `{...rest}` 重置 undefined。修复:把它拽进 local
2. **already_exists 误报**:用户复制粘贴报路径冲突。表面看 computeAvailableTarget 返回了未带后缀的 initial。深挖发现 hook 在 N 个 FileTree 实例(递归层级)都注册了 listener → Ctrl+V 触发 N 次粘贴 → 第 1 次成功,第 2+ 次冲突。修复:仅 level 0 注册
3. **`/` vs `\` 分隔符歧义**:JS 端 joinAbs 用 `/`,Windows path 用 `\`,Tauri exists_path 在某些情况误判。彻底修复:把 conflict resolution 整体下沉到 Rust `next_available_path`,OS 原生 Path 处理
4. **selection 取 dir 失败**:`file.tree.node(rel)` 在 path normalize 不一致时取不到 → fallback 到 file 分支 → Ctrl+V 选文件夹粘到了同级。修复:新加 `findNodeByAbsolute` 通过 children 遍历查找
5. **build rename 被 Defender 锁**:Tauri build 末尾 rename `opencode-desktop.exe` → `DeskFox.exe` 偶发 PermissionDenied(Windows Defender 实时扫描锁源 exe)。临时解法:手动 PowerShell rename。后续如复现,需在 CLAUDE.md 验证约定段补一行

**验收(user 已手测通过 2026-04-27 → 28)**:
- T7a 剪切/粘贴 ✅
- T7b 复制/粘贴(原文件保留)✅
- T7c 递归复制目录 ✅
- T7d 同名自动后缀 ✅
- T7e 在编辑器/输入框聚焦时 Ctrl+X/V 不抢 ✅
- T7f 树根空白处粘贴到项目根 ✅
- T7g cut 后粘到自己当前所在目录 → 静默 no-op ✅
- 选文件夹 Ctrl+V → 复制到该文件夹内 ✅
- 选文件 Ctrl+V → 粘到同级目录 ✅
- 多选 Delete → "批量删除 N 个项目"对话框 ✅
- 右键 OS-like:右键未选中行 → replace selection 为该行 ✅
- 一次粘贴只触发一次(无 N 个 listener bug)✅

## Commit #4 — Undo + 外部文件拖入

**关联 commit**: `<待填>`
**实际改动**: 见 2-plan.md "Commit #4" 段
**行数**: 待填

## 总体 review 自检(commit #5 索引收尾时填)

- [ ] FORK marker 全加(file-tree.tsx 多处 / file.tsx 挂载点 / lib.rs 块 / tauri-overrides 配置)
- [ ] typecheck + i18n parity 通过
- [ ] DeskFox build wrapper 验证通过
- [ ] T1-T11 验收点全过
- [ ] 改动日志.md 已加索引行

## 已知遗留

- 跨设备 move(D: → C:)失败时 toast 报错,不做 copy+delete fallback(v2)
- Undo 仅 in-memory,重启失效(v2 可考虑 localStorage 持久化)
- 拖动浮动 tooltip "将移动 N 个文件"未做(v2 UX)

## 回退方法

```
git revert <#4 hash> <#3 hash> <#2 hash> <#1 hash>
```

或一笔回滚到 #5 之前:

```
git reset --hard <pre-commit-1-hash>
```
