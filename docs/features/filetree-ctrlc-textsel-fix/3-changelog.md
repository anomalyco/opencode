---
feat-id: filetree-ctrlc-textsel-fix
status: done
related: ./3-changelog.md
---

# filetree-ctrlc-textsel-fix — changelog

**关联 commit**: (本笔 commit)
**所在分支**: `feat/filetree-ctrlc-textsel-fix`(合 dev 即销毁)
**触发原因**: User 报"聊天区和文件查看器区域,有时候 Ctrl+C 失效"——选了文字按 Ctrl+C 没有任何效果,粘贴后 OS 剪贴板内容是上一次的旧值。

## 规模分级

**Tiny**(~25 行 / 1 文件 / fork-only / bug fix)— 按规范 v2 仅产出 3-changelog.md,省 1-spec / 2-plan。

## 根因

`packages/app/src/hooks/use-file-tree-shortcuts.ts` 的 **B 路径**触发条件过宽,误抢只读区域的 Ctrl+C:

1. **文件树 selection 持久化**:`selection.clear()` 全仓**只在删除操作时**被调用一次(`file-tree.tsx:792`),普通 click(`replace`/`add`/`toggle`)只增不清。所以**用户只要点过任何一个文件**,`selection.paths().length > 0` 就一直为 true,直到删文件或 app 重启。
2. **B 路径条件过松**:`shouldTrigger()` 在 activeElement 不可编辑时,只要文件树 selection 非空就返回 true。聊天气泡 / 只读 md 查看器是普通 div(非 contenteditable),activeElement 落在 body —— `activeIsEditable()` 防不住,B 路径直接吞 Ctrl+C。
3. **`event.preventDefault()` + 自家 copy 不写 OS 剪贴板**:钩子 preventDefault 阻断了浏览器原生 copy → 同时 `copyFor` 调的 `clipboard.setCopy()` 是内部 signal store(`packages/app/src/context/file/clipboard-store.ts`),**完全不写 `navigator.clipboard`**。净效果:**用户按下 Ctrl+C → 啥也没发生**,OS 剪贴板保留旧值,所以"看起来 Ctrl+C 失效"。

"有时失效"的"有时"= 文件树有没有选过文件。

B 路径注释里宣称的设计意图("用户单击文件后焦点跑到 main editor 仍能 Ctrl+C")**实际从来没生效过** —— main editor 是 editable target,前一行 `activeIsEditable() return false` 已经拦掉了。B 路径只在 activeElement = body 之类的中性区生效,而中性区基本就是聊天/只读查看器场景,正好是误伤区。

## 实际改动

### `packages/app/src/hooks/use-file-tree-shortcuts.ts`(+25 / -2)

加一道闸 `hasTextSelectionOutsideFileTree()`:用 `window.getSelection()` 判定浏览器是否有非折叠的文本选区,且选区 anchor 落在文件树之外。**有就 return false**,把 Ctrl+C/X/V/Z 让回原生。

新增函数:

```ts
function hasTextSelectionOutsideFileTree(): boolean {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return false
  if (sel.toString().length === 0) return false
  const node = sel.anchorNode
  const el = node instanceof Element ? node : (node?.parentElement ?? null)
  if (!el) return false
  return !el.closest('[data-component="filetree"]')
}
```

`shouldTrigger()` 顺序变成:

1. A:focus 在文件树 → true
2. activeElement 是 input/textarea/contenteditable → false
3. **(新)** 文本选区在文件树外 → false(让原生 Ctrl+C 走)
4. B:文件树 selection 非空 → true

顺带把文件头注释和 `shouldTrigger()` 内的注释更新,把上面的"为什么需要这道闸"写清楚,后面看代码的人不会再踩同一坑。

**fork-only 文件**(头部 `[fork-only]` 标),无 FORK marker 需求;**0 上游侵入**;**0 黑名单触动**;**0 R4**。

## 排除的相邻 keydown 监听器

复查全仓 keydown listener,确认唯一拦截点是本钩子:

| 监听器 | 拦截范围 | 影响 |
|---|---|---|
| `command.tsx:382` (document) | 注册型 keymap | grep 全仓无 `ctrl+c` / `mod+c` keybind 注册 — 不干扰 |
| `session.tsx:1780` (document) | line 977 显式 `!(event.ctrlKey \|\| event.metaKey)` | Ctrl 系按键直接放行 — 不干扰 |
| `file-tabs.tsx:618` (window capture) | 只拦 Ctrl+F | 不干扰 |
| `file-tabs.tsx:950` (document capture) | 只拦 Esc | 不干扰 |
| `prompt-input.tsx:1358` (元素 onKeyDown) | 仅 textarea 聚焦时触发 | 不干扰 |
| 各 dialog onKeyDown | dialog 关闭时不挂载 | 不干扰 |

## 行数

| 项 | 行数 |
|---|---|
| 修改上游代码 | **0 行** |
| 修改 fork-only 代码 | ~25 行(use-file-tree-shortcuts.ts +28 / -3) |
| 文档(新文件,不计阈值) | ~80 行 |

代码远低于规范 v2 的 500 阈值,无 large-diff 标。

## 影响范围

- ✅ **聊天气泡选文本 Ctrl+C** — 走原生,复制文本(原来:复制文件路径或啥都不发生)
- ✅ **md 查看器选文本 Ctrl+C** — 走原生,复制文本(同上)
- ✅ **文件树焦点 Ctrl+C** — A 路径未动,仍复制文件路径
- ✅ **文件树有 selection,聊天区无文本选区,Ctrl+C** — B 路径保留,仍走文件树复制(B 的设计意图保留)
- ✅ **prompt-input / 编辑器 / 终端** — 都是 editable target,前一道闸拦,行为不变
- ✅ Ctrl+X 同样修好(文本选区在外 → 让原生走,原生在只读区无操作,clipboard 不被污染)

**未处理(YAGNI)**:Ctrl+V 与 Ctrl+Z 在中性区的同类过宽问题。Ctrl+V/Z 不依赖文本选区判定意图,新闸不命中。pre-existing,没收到 user 报告,本笔不扩大。后续若浮出再开 follow-up。

## 回归测试点

均按用户在 release `DeskFox.exe`(`packages/desktop/src-tauri/target/release/DeskFox.exe`,本笔 build 2m01s,exit 0)双击实测:

- **R1** 文件树点选任一文件 → 跳到聊天气泡,选段文字 → Ctrl+C → 粘到记事本是**文字** → ✅(user 确认)
- **R2** 文件树点选任一文件 → 跳到 md 查看器,选段文字 → Ctrl+C → 粘到记事本是**文字** → ✅(user 确认)
- **R3** 文件树焦点 Ctrl+C → 仍能复制文件路径(A 路径未动) → ✅(user 确认)
- **R4** 文件树有 selection,聊天区不选文本,Ctrl+C → 仍走文件树复制(B 路径保留) → ✅(user 确认)

## review 自检

- [x] 0 上游侵入(fork-only 文件改动)
- [x] 0 黑名单触动
- [x] 0 R4 override
- [x] 文件头注释 + `shouldTrigger()` 内注释更新,把"为什么需要文本选区闸"写清楚
- [x] 全仓 keydown 监听器复查,确认唯一拦截点
- [x] release 构建过(2m01s,exit 0)
- [x] user 双击实测 R1-R4 全过

## 已知遗留

- Ctrl+V / Ctrl+Z 在中性区与文件树 selection 共存时仍会触发文件树操作 — pre-existing,user 未报告,YAGNI 不扩大
- `hasTextSelectionOutsideFileTree()` 用 `anchorNode` 判定选区位置,跨多 DOM 边界的选区(罕见)可能误判 — 可接受,常见场景全覆盖

## 回退方法

```
git revert <code commit hash>
```

回退后只是回到"Ctrl+C 在中性区被钩子吞"的旧行为,无 schema 变化,无 server 感知。

**与上游 rebase 的关系**:本笔改的是 fork-only 文件,跟随上游升级**完全不会冲突**。
