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

**关联 commit**: `<待填>`
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

## Commit #3 — 剪切/粘贴/复制 + Tauri copy_path

**关联 commit**: `<待填>`
**实际改动**: 见 2-plan.md "Commit #3" 段
**行数**: 待填

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
