---
feat-id: chat-drop-overlay-stuck-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# chat-drop-overlay-stuck-fix — changelog

**关联 commit**: `a4883fef4`(fix + bug-repro 测试)+ `<本笔 commit>`(docs)
**所在分支**: `feat/chat-drop-overlay-stuck-fix`
**规模**: Medium-(85 行 / 2 文件,三文档全套)
**Bug 来源**: 2026-05-18 user 报告(`OPENCODE-PLAN/需求池/聊天窗口-拖拽浮层无法关闭.md`)

## 根因

`file-tree.tsx` 行 `onDrop`(line 882-893)调 `event.stopPropagation()` 杀掉 `attachments.ts` 注册在 `document` 上的 bubble 阶段 drop 监听 → `setDraggingType(null)` 不执行 → 浮层卡死。

同时 `attachments.ts` 没监听 `dragend`,导致 Esc 取消 / 拖到非 drop zone(标题栏 / 边缘)等不发 drop 的内部 drag 场景,浮层也漏清。

## 实际改动

### 1. `packages/app/src/components/prompt-input/attachments.ts`(+13)

加 helper `handleDragOverlayReset` ONLY 清状态:

```ts
const handleDragOverlayReset = () => {
  input.setDraggingType(null)
}
```

`onMount` 内新增 2 个 listener(原 3 个保留):

```ts
makeEventListener(window, "drop", handleDragOverlayReset, { capture: true })
makeEventListener(window, "dragend", handleDragOverlayReset)
```

- **capture-phase `drop` on window**:不被 file-tree 行的 bubble 阶段 `stopPropagation()` 杀,外部 OS 文件 drop 到文件树时兜底清浮层
- **`dragend` on window**:source 元素 fire 后 bubble 到 window,覆盖 Esc 取消 / 拖到非 drop zone / 拖出窗口等不发 drop 的内部 drag 场景

### 2. `packages/app/src/components/prompt-input/drag-overlay-cleanup.test.ts`(新,+72)

bug-repro 测试 2 个,验证修法依赖的 DOM 事件流前置假设:

| 测试 | 验证 |
|---|---|
| `child stopPropagation 不杀 window capture drop` | child bubble 监听被杀(`bubbleCount=0`),但 window capture 监听仍触发(`captureCount=1`)→ 修法成立 |
| `dragend 在 source 元素 fire 后能 bubble 到 window` | source 元素 dispatch dragend,window 监听触发(`dragendCount=1`)→ 修法成立 |

happydom + bun:test,纯 DOM 事件 dispatch,不依赖 SolidJS context。

## 行数

| 项 | 行数 |
|---|---|
| `attachments.ts` insertions | 13 |
| `drag-overlay-cleanup.test.ts` 新增 | 72 |
| 净 | +85 |

## 验证

| 项 | 结果 |
|---|---|
| `bun run typecheck` | EXIT=0 |
| `bun test drag-overlay-cleanup.test.ts` | ✅ 2/2 |
| `bun test src/components/prompt-input/` 回归 | ✅ 53/53(7 文件) |
| `build-deskfox.ps1 -Env dev -NoBundle` | ✅ 2m40s |
| user runtime A1(单文件拖到聊天) | ✅ |
| user runtime A2(单文件释放在文件树行,触发 file-tree-dnd 移动) | ✅(本 bug 核心修复点) |
| user runtime A3(Esc 取消) | ✅(dragend 兜底) |
| user runtime A5(资源管理器拖图片到聊天) | ✅ |
| user runtime A6(资源管理器拖图片释放在文件树文件夹) | ✅(capture drop 兜底) |

## 复审(commit 前)6 项审查全过

| 审查点 | 结论 |
|---|---|
| 其他 `onDragEnd` handlers(workspace tab / sidebar / terminal / session-side-panel / file-tree row) | 全走 `@thisbeyond/solid-dnd` pointer-based DnD,不发 native dragend/drop → 不触发新 listener,正交无冲突 |
| `dataTransfer.setData` 来源 | 全仓只有 `file-tree.tsx` 用,浮层激活条件不变(workspace tab 等拖拽不会误亮浮层)|
| `handleGlobalDrop` line 182 redundant `setDraggingType(null)` | 保留,belt-and-suspenders;删了反而让 handleGlobalDrop 依赖"capture 必先跑"耦合反增 |
| dialog 打开时 race | 新 capture handler 没 `isDialogActive()` 守卫,但 ONLY 清状态;dialog 打开时 draggingType 本就 null,清 null 无害 |
| dragenter/dragleave 配对(spec 提到) | 没改 dragleave 逻辑(`relatedTarget === null` 标准模式);本 fix 修的是 stuck 不是 flicker,flicker 不在本 bug 范围 |
| `handleGlobalDragLeave` 仍可能漏触发 | 是的,但 dragend(内部 drag)+ capture drop(外部 drag 落到 stopPropagation 子元素)两路兜底能 cover 所有 stuck 路径 |

## R 合规

- **R2** FORK marker 2 处(helper 定义段 + onMount 注册段)
- **R3** 不涉及
- **R4** 0 override(`packages/app/src/components/prompt-input/` 已在 fork 白名单)
- **R5** ✅ **bug-repro 测试先行,fix + test 同 commit,message 标 `[bug-repro: 文件树拖文件到聊天窗口释放后浮层卡死]`**
- **R6** 不涉及

## 回退

```
git revert a4883fef4
```

回退后 `attachments.ts` 回到 `0fbe34a87` 状态(5.15.1 ship 版本),user 重新撞此问题。

## 关联

- **延续**:`file-tree-multi-drag-to-chat` feat — 多选拖到聊天的浮层激活逻辑 by design,本 fix 只修清理路径
- **bug 来源**:需求池 `聊天窗口-拖拽浮层无法关闭.md`(2026-05-18 入池)
- **相关 feat**:`file-tree-dnd` — file-tree 行 onDrop 的 `stopPropagation()` 是本 bug 的关键诱因
