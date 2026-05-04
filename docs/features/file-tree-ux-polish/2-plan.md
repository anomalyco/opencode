---
feat-id: file-tree-ux-polish
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# file-tree-ux-polish — Plan

> 2026-05-04。基于 1-spec.md(已锁版,6 开放点全决议)。
> 5 笔 commit,每笔可独立 revert。

---

## 实施顺序

```
#4 默认值       ← 简单,先做(build 第一眼能验)
#2 节点菜单     ← 加 copyPathToClipboard / refreshNode helpers
#3 空白菜单     ← 加 refreshAllExpanded 到 tree-store(#1 也要复用)
#5 键盘导航     ← 复用 #2 的 promptRename/promptDelete
#1 自动刷新     ← 复用 #3 的 refreshAllExpanded
build → 测试 → user ack → changelog → merge dev
```

---

## commit #4 — 默认值改两处

**Tiny,~3 行。**

| 文件:行 | 改动 |
|---|---|
| `packages/app/src/context/settings.tsx:111` | `showFileTree: false` → `true` |
| `packages/app/src/context/layout.tsx:250` | `tab: "changes"` → `"all"` |
| `packages/app/src/context/layout.tsx:623` | fallback `"changes"` → `"all"` |

**commit msg**:`feat(file-tree): 新用户默认展开右侧面板 + tab 默认所有文件 [feat: file-tree-ux-polish]`

**验收**:清 localStorage 后启动 → 面板显示 + tab "所有文件"。老用户不变(决议 D)。

---

## commit #2 — 节点右键菜单重整

**Medium,~50-80 行。** 全部在 `packages/app/src/components/file-tree.tsx`。

### 改动清单

1. **删 `window.print()` 项**(line 824-826)
2. **加 helper `copyPathToClipboard`**(放 promptRename 后):多选(selection 非空)→ 全部 path 用 `\n` 拼;单选 → 当前 target.absolute;`navigator.clipboard.writeText(...)` + toast
3. **加 helper `refreshNode`**:文件夹 → refresh 自身;文件 → refresh `dirname(path)`
4. **改 `promptNewFileAt` placeholder**(line 573):`"文件名(默认 .md)"` → `"文件名"`;defaultValue 保留 `untitled.md`(决议 B)
5. **重排 `renderRowMenuItems`**(line 811-860)按 4 组:
   - 组 1:重命名 / **复制**(在前)/ 剪切 / [粘贴 if clipboard 非空] / 删除
   - 组 2:在文件夹中显示 / 复制文件路径(新)
   - 组 3:新建文件(去 `(.md)` 字样)/ 新建文件夹
   - 组 4:刷新(新)

**commit msg**:`feat(file-tree): 节点右键菜单重整 — 4 组重排 + 加复制路径/刷新 + 删打印 [feat: file-tree-ux-polish]`

**验收**:菜单 4 组顺序对;复制路径单/多选都对(toast 提示数量);刷新单节点 OK;打印消失;新建文件文案不带 .md。

---

## commit #3 — 空白菜单 + 修复刷新递归

**Medium,~30-50 行。**

### 关键发现

`file.tree.refresh(path)` 当前只 force re-list **单个目录**,不刷已展开的子目录 — 这是"刷新没显示"的根因。需加递归版本。

### 改动清单

1. **`packages/app/src/context/file/tree-store.ts`** — 加 `refreshAllExpanded(rootPath)`:
   - 第一步 force list root
   - 然后扫 `tree.dir` 所有 `expanded:true` 的目录,跳过 root,逐个 force list
   - `Promise.all` 并发
   - return 处 export `refreshAllExpanded`

2. **`packages/app/src/context/file.tsx`** — 把 `refreshAllExpanded` 透出为 `file.tree.refreshAll(root)`(在 line 310 附近)

3. **`packages/app/src/components/file-tree.tsx`** — 重排 `renderEmptyMenuItems`(line 862-885)2 组:
   - 组 1:新建文件(去 `.md` 字样)/ 新建文件夹 / [粘贴到项目根 if clipboard]
   - 组 2:刷新 — 改 `file.tree.refresh(rootRel)` → `file.tree.refreshAll(rootRel)`

**commit msg**:`feat(file-tree): 空白处右键菜单重整 + 修复刷新递归(扫所有 expanded 子目录) [feat: file-tree-ux-polish]`

**验收**:空白菜单 2 组对;终端在子目录加文件后点刷新 → 子目录立即显示新文件;已展开的目录刷新后**保持展开**(不折叠)。

---

## commit #5 — 键盘导航

**Medium,~80-120 行。**

### 改动清单

1. **`packages/app/src/hooks/use-file-tree-shortcuts.ts`** —
   - 扩展 `ShortcutHandlers`:加 `onArrowUp` / `onArrowDown` / `onEnter` / `onRename` / `onDelete`
   - `onKeyDown` 加非 meta-key 分支:无 ctrl/meta/shift/alt 时,匹配 `ArrowUp` / `ArrowDown` / `Enter` / `F2` / `Delete` / `Backspace`(macOS,决议 E)
   - 复用现有 `shouldTrigger`(treesp focus 或 selection 非空 + 非可编辑控件)

2. **`packages/app/src/components/file-tree.tsx`** — 实现 5 个 callback 并接入:
   - `navigateRelative(delta: -1|1)`:用 `nodes()` 拿当前扁平 visible 序列,找当前 selection 末尾节点的 idx,选 `nodes()[idx+delta]?.path`(`selection.replace(...)`);selection 空 → 选第一个
   - `onEnterAction`:单选才响应;文件 → `props.onFileClick(node)`;文件夹 → toggle `expandDir/collapseDir`
   - `onRenameAction`:单选才响应,调 `promptRename(node)`
   - `onDeleteAction`:selection 非空才响应,调 `promptDelete(firstNode)`(promptDelete 内部已读 selection 处理批量)

**commit msg**:`feat(file-tree): 键盘导航 ↑↓/Enter/F2/Delete + macOS Backspace [feat: file-tree-ux-polish]`

**验收**:↑↓ 移动节点;Enter 文件打开 / 文件夹 toggle;F2 重命名;Delete/Backspace 删除;焦点在聊天框时**完全 no-op**;无 selection 时 ↑↓ 选第一个、其他键 no-op。

---

## commit #1 — LLM 响应结束自动刷新

**Tiny-Medium,~20-50 行。**

### 关键改动

`packages/app/src/pages/session/session-side-panel.tsx`(右侧面板组件,只在面板 mount 时挂监听 = 决议"面板可见才挂"自然实现):

```typescript
import { createEffect, on } from "solid-js"

let prevType: string | undefined
createEffect(
  on(
    () => sync.data.session_status[sessionId()]?.type,
    (currentType) => {
      const prev = prevType
      prevType = currentType
      if (prev === "busy" && currentType === "idle") {
        void file.tree.refreshAll(props.path)  // 复用 #3 的 refreshAll
      }
    },
  ),
)
```

依赖 #3 的 `refreshAll`,所以顺序 #3 必须在 #1 前。

**commit msg**:`feat(file-tree): LLM 响应结束(busy→idle)自动刷新文件树 [feat: file-tree-ux-polish]`

**验收**:LLM 改/删文件,响应结束瞬间树自然反映;流式中**不**触发(只在 busy→idle 边沿);连续提问每次结束触发一次,无抖动。

---

## 测试构建

```bash
bash packages/branding/scripts/build-deskfox.sh -Env dev --no-bundle
```

产物:`packages/desktop/src-tauri/target/release/DeskFox`(raw binary,不打 .app/.dmg)。

## 16 条测试用例(user 自测清单)

| # | 用例 | 期望 |
|---|---|---|
| 1 | 清 localStorage 后启动 | 面板显示 + tab "所有文件" |
| 2 | 节点右键 | 4 组顺序对,无"打印"项 |
| 3 | 单选 → 复制文件路径 | 剪贴板拿 abs path + toast |
| 4 | 多选 → 复制文件路径 | `\n` 拼接 + toast 提示数量 |
| 5 | 新建文件 | 默认值 `untitled.md` / placeholder "文件名" |
| 6 | 节点右键 → 刷新 | 刷该节点(或父目录)|
| 7 | 空白处右键 | 2 组顺序对 |
| 8 | 终端加文件 → 空白处刷新 | 已展开子目录显示新文件 |
| 9 | 单选 → ↑↓ | 节点高亮上下移动 |
| 10 | 单选文件 → Enter | 编辑器打开 |
| 11 | 单选文件夹 → Enter | toggle 展开 |
| 12 | 单选 → F2 | 重命名弹框 |
| 13 | 多选 → Delete | 批量删除确认 |
| 14 | macOS 单选 → Backspace | 删除确认 |
| 15 | 焦点聊天框 → ↑↓ Enter F2 Delete | 完全无影响 |
| 16 | LLM 写一个文件 | 响应结束自然出现 |

---

## 涉及文件汇总

| 文件 | 改动笔数 | 性质 |
|---|---|---|
| `packages/app/src/context/settings.tsx` | #4 | fork-only(已 fork)|
| `packages/app/src/context/layout.tsx` | #4 | fork-only |
| `packages/app/src/components/file-tree.tsx` | #2 #3 #5 | fork-only |
| `packages/app/src/context/file/tree-store.ts` | #3 | fork-only |
| `packages/app/src/context/file.tsx` | #3 | fork-only |
| `packages/app/src/hooks/use-file-tree-shortcuts.ts` | #5 | fork-only |
| `packages/app/src/pages/session/session-side-panel.tsx` | #1 | fork-only |

**0 上游侵入**(全是 file-tree-dnd 创建的 fork-only 文件)。

---

## 风险与回退

| 风险 | 缓解 |
|---|---|
| #5 键盘抢编辑器 hotkey | `shouldTrigger` 已严格(selection 非空 + 非可编辑控件) |
| #1 effect 面板未 mount 不挂 | **期望行为**(决议) |
| #3 递归刷新对超大目录性能 | 极少见,先不优化 |
| #4 老用户无感 | 决议 D 已明示不迁 |

每笔独立可 revert。整笔:`git revert <merge-commit>`。
