---
feat-id: file-tree-multi-drag-to-chat
status: done
related: ./3-changelog.md
---

# 文件树多选拖动到聊天窗口接通

## 需求来源

User 2026-05-15 反馈:右侧文件目录树里能选中多个文件 / 文件夹,但拖到聊天窗口不工作。希望多选拖动跟单选一致 — 每个选中项加一个 `@-mention` 文件 part。

## 根因

`file-tree-dnd` feat(2026-04-27)留了内部多选拖动协议:`application/x-deskfox-paths` MIME = JSON[abs paths]。但**当时只设计用于树内移动**(`setDraggingPaths` 信号 in-memory),`application/x-deskfox-paths` MIME 写了之后**没人读**。

聊天端 `attachments.ts:handleGlobalDrop` 只看 `text/plain: file:<rel>` 单源协议(file-tree 单选时写的)。多选拖到聊天 → `text/plain` 空 → 走 `event.dataTransfer.files` 兜底 → 树内文件不是 OS File 对象 → fallthrough → 啥都没发生。

## 修法

**接通 attachments 侧的多选 MIME 消费**(树侧 0 改动):

1. **新文件 `multi-path-drop.ts`** — 纯函数 helper(无 context 依赖,可单测):
   ```ts
   parseMultiPathDropPaths(json, root) → string[]
   ```
   abs JSON → rel 路径数组,容错 7 种边界。

2. **`attachments.ts` `handleGlobalDrop`** — 加多选 MIME 分支,放在单选 `text/plain` 之前(优先级)。N 个路径循环 `addPart`,每个一个 `@-mention`。

3. **`attachments.ts` `handleGlobalDragOver`** — 把 `application/x-deskfox-paths` 也算 `@mention` drag 提示,与单选 UX 一致(显示拖拽预览)。

## 文件改动

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/components/prompt-input/multi-path-drop.ts`(新)| 纯函数 helper + FORK 注释 | +30 |
| `packages/app/src/components/prompt-input/attachments.ts` | import helper + dragOver/drop 两处接入 | +20 / -1 |
| `packages/app/src/components/prompt-input/attachments.test.ts` | 10 个新单测覆盖 helper 边界 | +60 |

总 +111 / -1,Tiny tier。

## R5 测试覆盖(10 单测 + helper extract 模式)

attachments.ts 整文件因 SolidJS context 链(usePrompt / useLanguage / useSDK)直接单测会撞 "Client-only API called on the server side" 错。R5 决策 2 的 **helper extract 模式**正好适用 — 把纯逻辑抽到 `multi-path-drop.ts`,attachments.ts 调用它,单测只测 helper。

| 测试 | 覆盖 |
|---|---|
| `empty / null / undefined input → []` | 输入兜底 |
| `invalid JSON → []` | JSON.parse 抛错容错 |
| `non-array JSON → []` | 非数组类型容错 |
| `converts abs paths under root to relative (forward slash)` | 正常路径 |
| `normalizes Windows backslash in abs paths` | Win 反斜杠归一化 |
| `handles root with trailing slash` | root 末尾斜杠容错 |
| `abs path not under root → fallback original path` | 跨盘符 / 外部拖入路径 |
| `missing root → returns all paths normalized` | sdk.directory 未初始化场景 |
| `non-string entries filtered out` | 非字符串条目过滤 |
| `abs path equal to root → empty string` | 拖整个 root 边界 |

attachments.test.ts 7 → 17 测试,全过。

## 边界情况

| 场景 | 行为 |
|---|---|
| 单文件拖 | 树侧仍走 `text/plain: file:<rel>` 原行为 ✅ 无回归 |
| 多选 2+ 文件 | 新分支命中,每个加 1 个 `@-mention` part |
| 多选含文件夹 | 文件夹 path 一并加,opencode 支持 `@folder/` 读内容 |
| 跨盘符 / abs 不在 root 下 | 退化用 abs 路径(LLM 拿完整路径),不破 |
| JSON 损坏 | helper 兜底返 `[]`,fallthrough 到原 files 路径 |
| 拖 root 自身 | helper 返空字串 `""`(语义上 = "整个项目")|

## 验证

| 项 | 结果 |
|---|---|
| `bun test attachments.test.ts` | ✅ 17/17 全过(7 老 + 10 新) |
| `bun run typecheck` | ✅ 16/16 全过 |
| `build-deskfox.ps1 -Env dev -NoBundle` | ✅ 2m49s |
| user runtime — 多选拖动每个变 @-mention chip | ✅ |
| user runtime — 单选拖动原行为 | ✅ 不破 |

## R 合规

- **R2** FORK marker 加 2026-05-15 + feat-id(两处:multi-path-drop.ts 头注 + attachments.ts dragOver / drop / import 三处 FORK 标)
- **R3** 不涉及品牌/主题/icon
- **R4** 0 override,`packages/app/src/components/prompt-input/` 在白名单
- **R5** helper extract 模式(决策 2 双清单 Logic 清单)+ 10 单测 + 0 R4
- **R6** 不涉及网络监听

## 回退

```
git revert e2f7fef6c
```

回退后 `multi-path-drop.ts` 删除,attachments.ts 回到原状,user 重新撞此 bug(多选拖到聊天无效)。

## 关联

- **复用**:`file-tree-dnd`(2026-04-27 立的 `application/x-deskfox-paths` 内部协议)— 本笔把它接通到聊天侧消费
- **复用**:单选 `text/plain: file:<rel>` 路径继续生效,与本笔多选分支共存
- **遵守**:R5 决策 2 "helper extract 模式"先例(`tests-codemirror-fixture-d3` / `tests-tauri-invoke-mock-d4` 同等场景)
