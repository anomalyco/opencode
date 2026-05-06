---
feat-id: right-click-stale-selection-fix
status: done
related: ./3-changelog.md
---

# 3-changelog — 文件查看器右键残留旧选区修复

## 现象

.md 文件查看器中:
1. 选中一段文字 A
2. 鼠标点击空白区域(选区视觉清掉)
3. 在别处右键 → 弹出右键菜单 + 旧选区 A 重新高亮 + 菜单"复制 / 加聊天"操作的目标是 A

变体:连续选两段 A → B,任意位置右键,菜单永远命中 A(更长那条),而不是最近的 B。

## Root cause

`packages/app/src/pages/session/file-tabs.tsx` 内 `handleSelectionContextMenu` + `pickBestRecentSelection` 这套"选区历史栈"机制:

```
selectionchange 事件 → 把所有非空选区无脑入栈(30 秒窗口 / 16 条上限)
contextmenu 事件   → 从历史栈挑"文本最长"的快照,反推选区 → 设置 mdMenu.text + overlay 高亮
```

这套机制 2026-04-29 加进来,**只为对抗 Pierre 的 Shadow DOM(`diffs-container`)在 macOS WebKit 上的 selection collapse bug**(右键瞬间浏览器把多行选区 collapse 成单词,需要历史栈反推)。

**问题**:它被全局应用到了所有 `onContextMenu` 入口,包括 light DOM 的 .md 自渲染区(`renderMarkdown` / line 1094)。light DOM 上浏览器自己保选区,栈反而引入两个副作用:

| 副作用 | 触发路径 |
|---|---|
| 旧选区残留复活 | 用户点空白 → 浏览器清选区,但 `selectionchange` 不会 fire "选空"事件,栈里旧条目仍在 → 30 秒内任何右键都能拿到它 |
| 算法忽略点击位置和时间新旧 | `pickBestRecentSelection` 只比 `text.length`,不看 `time`,不看 `event.clientX/Y` 是否在 range 内 → 选 A(长)→ 选 B(短)→ 永远拿到 A |

## 修复:分路径处理(方案 D)

`renderMarkdown`(line 1094 / light DOM)和 `renderDefault`(line 1276 / `@pierre/diffs` Shadow DOM)虽然共用 `handleSelectionContextMenu`,但它们的 DOM 类型其实天然不同:

| 区域 | DOM | 浏览器选区行为 | 需要历史栈? |
|---|---|---|---|
| renderMarkdown(.md 自渲染) | light DOM | Mac/Win 都自己保 | **不需要** |
| renderDefault(`@pierre/diffs`) | Shadow DOM | macOS WebKit collapse | 仅 Mac 需要 |

新加 light DOM 专用 handler `handleLightDomContextMenu`:
- 直接读 `window.getSelection()`
- 选区为空 → `text=""` + 清 overlay → 菜单弹出但"复制 / 加聊天"项 disabled(凭 `mdMenu().text.trim()` 判)
- 选区非空 → 用当前选区,正常工作

`renderMarkdown` 的 `onContextMenu` 改挂新 handler,顺手撤掉无用的 `onMouseDown={handlePreContextCapture}`(那是给 Shadow DOM 路径收 ShadowRoot 的)。

`renderDefault` 路径完全不动 — Pierre Shadow DOM 仍走老 `handleSelectionContextMenu` + `pickBestRecentSelection`,**Mac WebKit collapse 防御一字未改,零回归风险**。

## 改动文件

- `packages/app/src/pages/session/file-tabs.tsx`
  - +30 行(新增 `handleLightDomContextMenu` 函数 + FORK 注释解释为什么 light DOM 走简单路径)
  - 改 1 处挂载(renderMarkdown 的 `onContextMenu` 换 handler + 撤 `onMouseDown`)

## 验证

- typecheck:15/15 pass
- DeskFox.exe release build:`packages/desktop/src-tauri/target/release/DeskFox.exe`(35MB)
- user runtime 测试通过(2026-05-06):
  - 选 A → 点空白 → 别处右键 → 不再命中 A ✓
  - 选 A → 选 B → 在 B 上右键 → 命中 B ✓
  - 选 A → 选 B → 空白处右键 → 不再命中 A ✓
  - 选完 → 在选区上右键 → 命中(回归确认)✓
- Mac 路径(Pierre Shadow DOM)未改动,Mac 端零回归

## 规模 / R 标记

- 规模:Tiny(~30 行净增 / 1 文件)
- R2 FORK marker:✓(新 handler 加 FORK 块说明)
- R3 黑名单:无
- R4 override:无
- 上游侵入:0(纯 fork-only 修)
