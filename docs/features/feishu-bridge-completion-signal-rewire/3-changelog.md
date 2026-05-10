---
feat-id: feishu-bridge-completion-signal-rewire
status: reverted
related: ./3-changelog.md
---

# feishu-bridge-completion-signal-rewire — changelog(尝试 → revert,教训沉淀)

## 一句话

Layer 2 重构尝试 — dispatcher 从 `session.idle` 启发式信号切到 `message.updated` + `time.completed` 强信号,概念上对齐 OpenClaw CardPhase `streaming → completed` transition。**实测发现根本误判 opencode 行为模型**(一次 user prompt 产生**多条** assistant message,Layer 2 锁定 first 就 resolve 导致只发开场白)→ revert 回 Layer 1。本笔记录尝试 + 失败原因 + Layer 2.1 设计方向,backlog 立项。

> Medium 规模:实施 ~270 行新 dispatcher + ~150 行 17 单测 + 简化 message-pipeline ~85 行,然后整体 revert(commit `569dd65ff`)。
>
> 状态:**reverted**,但留 doc 记教训 + 给 Layer 2.1 重做用。

## commit 列表

| commit | 简述 |
|---|---|
| `ef1e2399d` | `feat(feishu-bridge): Layer 2 — dispatcher 切到 message.updated + time.completed 强完成信号`(主笔实施)|
| `569dd65ff` | `Revert "feat(feishu-bridge): Layer 2 — ..."`(实测失败后 revert)|

## 设计动机(改前)

Layer 1 的 `session.idle` 信号是启发式:
- session 整体空闲信号,跟某条具体 reply 完成不严格 1:1
- 工具调用 / 多步回复尾部出现 ghost placeholder 时,对应不到具体 message
- 5min 硬超时是兜底,长任务(>5min)被误杀

opencode `message.updated` 事件携带 `info.time.completed` 字段(undefined while running,timestamp on done)— 看起来是更强的 per-message 完成信号,概念上对齐 OpenClaw 的 CardPhase 状态机 `streaming → completed` transition。

## 实施(已 revert)

`prompt-dispatcher.ts` 重写 ~270 行:
- 替换 v1 累积全部 text part 的 echo-prone 路径
- 新增 `capturedAssistantID` 锁定机制(忽略 ghost / 历史轮 message)
- 新增 `pendingByMessage` 暂存(part 在 message.updated 前到达时按 messageID 分桶,锁定时迁移)
- resolve 类型从 `string` 升级为 `CompletionResult` union(`ok / error / no-message`)
- timeout 从主信号降级为事件丢失兜底(默认仍 30min)
- finalize 用 `finalized` flag 防 double-finalize(修 v1 supersede 路径下 map 已 delete 导致 finalize 误 bail 的隐 bug)

`message-pipeline.ts` 简化 ~85 行:
- `runOpencode` 删 `setImmediate` + `session.messages` 查询路径(~50 行)
- 删 `findLastUsefulAssistant` helper + `AssistantMessageEntry` 类型(Layer 1 修法,被 Layer 2 强信号取代,不再需要 ghost filter)
- 简化为 `await dispatcher.register()` 直接拿 `CompletionResult`,switch kind 处理

`prompt-dispatcher.test.ts` 新增 17 单测覆盖完整路径 — 17/17 全 pass,typecheck 16/16 绿。

## 实测发现的根本错误

user 用 `Hebing—one`(xiaomi mimo-v2.5-pro)发"OpenCode vs Obsidian 知识库"研究问题:
- 修前(Layer 1)预期:LLM 跑工具调研 → 完整 1693+ 字符答案
- 修后(Layer 2)实际:**只收到 37 字符开场白** "我来帮你研究这个问题。先获取 OpenCode 的相关信息,然后对比分析。"

数据库查 session 里的 message 序列,**3 条 message**:
1. user msg
2. **assistant msg #1** 6.2s / 12368 tokens — text "我来帮你研究...对比分析。" + 2 个 webfetch tool 调用 + completed
3. **assistant msg #2** 16s / 23554 tokens — text "## 研究结论 OpenCode 和 Obsidian..." (真答案) + completed

**opencode agent loop 在工具调用前后会拆出新的 assistant message**(不是单 message + 多 part)。Layer 2 的"first 新 assistant = 整个 turn"假设错了:
- dispatcher 锁定 msg #1
- msg #1 6.2s 后 `time.completed` set → resolve 返"我来帮你研究..."
- msg #2 真答案被忽略 → user 只收到开场白

之前 sample 中"单 message 多 part"模式(claude-code/sonnet 一次回复 75 个 tool 在一条 message 里)恰好掩盖了这个误判,Layer 2 看起来 work,实测 mimo provider 立刻露馅。

## Revert 决策

**选项**:
- A. 继续 Layer 2 + 修"多 message per turn"逻辑 — 累积 N 条 assistant 文本 → 等所有完成
- B. revert 回 Layer 1(已实测 5/5 修过)
- C. 先 B 再独立做 A

**user 选 C**:立刻 revert,Layer 2.1 重新设计 backlog 立项。reasoning:
- Layer 1 已实测可用,先回稳
- Layer 2 实施改动量大,带"该等所有 message"的新设计需要重新论证
- 不背 Layer 2 设计错的债

revert 后状态:Layer 1 ghost filter + 30min timeout + session.messages 兜底,验证过 5/5 修对的版本。

## Layer 2.1 设计方向(留 backlog)

Layer 2.1 应该:
- **等 session 整体 idle**(不是某条 message 完成),取所有 parentID = 触发 user msg 的 assistant message
- 找最后一条**有非空 text part**的 assistant(自动跳 ghost)
- 把 text 直接发飞书

跟 Layer 1 区别:
- Layer 1 用 `session.idle` + 后查 `session.messages` API → 有 race condition + 5min 硬超时
- Layer 2.1 仍用 `session.idle` 触发,但**事件累积**所有 part 文本 + 用 message.updated 事件追踪 messageID,不需要后查 API

实施时机:Layer 1 用一阵稳定后,出现"30min 超时不够"或"ghost filter 漏过新形态"信号再启动。

## 教训沉淀

1. **不能用单一 sample 推 LLM provider 行为通则**:claude-code/sonnet 喜欢"单 message 多 part",mimo-v2.5-pro 喜欢"多 message + tool 切分",同一 schema 不同模型用不同模式
2. **设计假设要有"反样本"验证**:Layer 2 设计 review 时只看了"单 message"的数据库样本就锁定了"first new assistant = 整个 turn",该用至少 2 个 provider sample 交叉验证
3. **revert 是合法选择**:Layer 2 实施完整、单测全过、typecheck 绿,但实测发现根本设计误判 → revert 比"打补丁修"更便宜,接受沉没成本

## R4 / 上游侵入

- 0 R4 override
- 0 上游侵入(全在 fork-only `adapter-feishu-lark/`)
- 净改动:revert 后 0(回到 Layer 1 状态)

## 跟进

backlog feat-id 沿用 `feishu-bridge-completion-signal-rewire`,Layer 2.1 重新设计;触发条件见 [`OPENCODE-PLAN/需求池/飞书桥接-openclaw能力对齐.md`](../../../OPENCODE-PLAN/需求池/飞书桥接-openclaw能力对齐.md) #1。
