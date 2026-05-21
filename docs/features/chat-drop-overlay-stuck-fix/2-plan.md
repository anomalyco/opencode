---
feat-id: chat-drop-overlay-stuck-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# chat-drop-overlay-stuck-fix — 2-plan

## 实施计划(spec 选型 C 落地)

### Step 1:写 bug-repro 测试(R5 硬要求)

新建 `packages/app/src/components/prompt-input/drag-overlay-cleanup.test.ts`:

| 测试 | 验证目标 | 修复前 | 修复后 |
|---|---|---|---|
| `child stopPropagation 不杀 window capture drop` | DOM 事件流前置假设 ①:capture 阶段在 bubble 之前 fire,不被 child stopPropagation 杀 | bubble 监听被杀(已实测 `bubbleCount=0`)+ 旧代码无 capture 监听 → 状态 stuck | window capture handler 触发(`captureCount=1`)→ `setDraggingType(null)` 执行 |
| `dragend 在 source 元素 fire 后能 bubble 到 window` | DOM 事件流前置假设 ②:dragend bubble 到 window 可被监听 | 旧代码无 dragend 监听 → Esc 取消 / 拖出无人清状态 | window dragend handler 触发(`dragendCount=1`)→ `setDraggingType(null)` 执行 |

happydom + bun:test,纯 DOM 事件 dispatch 不依赖 SolidJS context,可单测。

### Step 2:实施修复 `attachments.ts`

加 helper:

```ts
const handleDragOverlayReset = () => {
  input.setDraggingType(null)
}
```

`onMount` 内新增 2 个 listener:

```ts
makeEventListener(window, "drop", handleDragOverlayReset, { capture: true })
makeEventListener(window, "dragend", handleDragOverlayReset)
```

**保留**原 `handleGlobalDrop` 里的 `setDraggingType(null)`(line 182)— belt-and-suspenders,删了反而让 handleGlobalDrop 依赖"capture 必先跑"耦合反增。

### Step 3:自测

- typecheck(monorepo 全量)
- bug-repro 测试 2/2
- 整套 prompt-input 测试回归(7 文件 53 测试)
- release build(`build-deskfox.ps1 -Env dev -NoBundle`)
- launch DeskFox,user runtime 测验收 A1-A8

### Step 4:复审可能的回归点(commit 前)

| 审查点 | 结论 |
|---|---|
| 其他 `onDragEnd` handlers(workspace tab / sidebar / terminal / session-side-panel / file-tree row) | 全走 `@thisbeyond/solid-dnd` pointer-based DnD,不发 native dragend/drop → 不触发我的新 listener |
| `dataTransfer.setData` 来源 | 全仓只有 `file-tree.tsx` 用 → workspace tab 等拖拽 dataTransfer.types 不含 "Files"/"text/plain"/"application/x-deskfox-paths",浮层激活条件不变,不会误亮 |
| dialog 打开时 race | 新 capture handler 没 `isDialogActive()` 守卫,但 ONLY 清状态;dialog 打开时 draggingType 本就 null,清 null 无害 |
| dragenter/dragleave 配对(spec 提到) | 没改 dragleave 逻辑(`relatedTarget === null` 标准模式);本 fix 修的是 stuck 不是 flicker,flicker 不在本 bug 范围 |
| `handleGlobalDrop` line 182 redundant cleanup | 保留,belt-and-suspenders |

## 决策轨迹

### 2026-05-21 初版选型

最初设计时只考虑了 `dragend`(覆盖内部 drag 取消),没意识到外部 OS drag 落到 file-tree 行的场景 — 用户那一刻没 source 元素 → 不发 dragend → 仍可能 stuck。复审时补 capture-phase drop 作为第二路兜底,覆盖外部 drag 路径。

### 2026-05-21 helper 提取问题

考虑过把 `handleDragOverlayReset` 抽到独立文件做 R5 决策 2 helper-extract,但只 3 行 setState 调用,抽离反而过度抽象。**改走"模块内 helper + 实测事件流前置假设"路线**:测试不测 helper 本身(平凡),测的是修法依赖的 DOM 事件流行为(`child.stopPropagation` 不杀 `window` capture / `dragend` 能 bubble),这才是修法成立的关键证明。

### 2026-05-21 测试设计

第 3 个测试"reset callback 调用后浮层可重新激活"试图测 `setState` 调用循环,但因 bun:test 的 `toBe` 类型严格(state widened 后调用 `toBe("image")` 类型不匹配)删除。第三个测试本来就没意义(只测自己 mock 的 setState),删除后保留 2 个真正有价值的事件流测试。

### 2026-05-21 user 实测 5 场景全过

verification A1-A6 跑过,A7/A8 边界未明确实测但代码路径与 A1 等价(handleGlobalDrop 处理路径不变)。user 通过 → commit。
