---
feat-id: feishu-bridge-permission-card
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge-permission-card — 1-spec

## 一句话

飞书 session LLM 调工具触发 opencode 权限请求时,plugin 拦截事件 → 渲染飞书 CardKit 交互卡片 → user 在飞书点[允许一次/始终允许/拒绝]→ plugin 调 `client.permission.reply` 回写 → agent loop 解锁。**保持 user 显式批准的 trust 边界**,不做 auto-allow。

## 背景 — 为何不能 auto-allow

2026-05-10 user 反馈飞书 session 触发"需要权限"GUI 对话框等不到点击 → agent 死锁(Hebing—one 实测)。最快修法是 `tools:` 字段 per-session pre-approve 全部权限,但 user 决策**不能**(安全考虑) — 飞书 session 同样需要每次出域操作的 user 显式确认。

调研发现 opencode 暴露了完整的 permission 子系统 API:
- `permission.asked` Bus event(`packages/opencode/src/permission/index.ts:78`)— plugin event hook 能 subscribe
- `client.permission.reply({requestID, reply, message?})` SDK 标准方法(`packages/sdk/js/src/v2/gen/sdk.gen.ts:2664`)— plugin 可调用
- `Permission.CorrectedError`(reject + message)→ LLM 收到 user 反馈

→ 可实现真互动方案,**0 上游改动**。

## 验收标准

| # | user-visible 行为 | 验证方式 |
|---|---|---|
| 1 | LLM 调 file/shell 工具触发权限,飞书弹卡片(不再卡 GUI) | 实测发请求需要 read 工具的任务 |
| 2 | 卡片显示:权限类型 + 路径 + 元数据 + 3 按钮[允许一次 / 始终允许 / 拒绝] | 截图 |
| 3 | user 点[允许一次] → 当次工具 OK,**下次同操作仍弹卡片** | 实测连续 2 次 |
| 4 | user 点[始终允许] → ruleset 加 entry,**后续相同 pattern 自动放行** | 实测 |
| 5 | user 点[拒绝] → tool 报 `RejectedError`,LLM 收到拒绝信号继续 | 看 LLM reply 措辞 |
| 6 | 5 分钟无人点 → plugin 自动 reply "reject",防 chat 永久卡死 | 实测放置 6min |
| 7 | 同 chat 多 permission 并发 → 排队 / 多卡片 | 触发 multi-step tool 任务 |
| 8 | 卡片只在飞书 session 出现,主 GUI session 行为不变(仍弹原 GUI 对话框) | 主 GUI 跑同任务 |

## 不在范围(本期不做)

- **#5b LLM 主动反问工具(question / clarify)的真互动版**:跟 #5a 共用 CardKit 基础设施,但触发路径不同(需要拦截 question 工具调用而非 permission 事件)。临时止血走 system prompt(已合 dev),真互动版作为 #5b 后续做
- **拒绝时填写理由的输入框**:飞书 CardKit `Action` 元素仅支持 button / picker,无 free-text input,本期不做。reject 直接抛 `RejectedError`(无 user message),LLM 看到通用拒绝信号即可。后续若必要,通过卡片"展开理由"二级交互或 chat 让 user 接着发文字消息补充
- **始终允许 pattern 范围编辑**:opencode 默认 `always` 用 request.always 字段(通常包含目录的 glob 模式),本期 plugin 不修改、直接 forward。后续给 user 在卡片选 wider/narrower scope 的能力是 #5b 之后的事

## 决策点

### D1:WSS 事件订阅 vs HTTP webhook 接收 card action
- A. EventDispatcher 注册 `card.action.trigger` handler 走 WSS — 跟现有 `im.message.receive_v1` 同模式
- B. 起 HTTP webhook server,飞书后台配 callback URL → CardActionHandler 接
- **决定 A** — 已有 WSS 长连接,加一个 event handler 是最少改动;不需要后台改 webhook 配置 + 不需要暴露端口
- 风险:lark-node-sdk 1.50.0 的 EventDispatcher 是否支持 `card.action.trigger` 事件,需实测;若不支持降级到 polling `permission.list()`(每 2-3s 一次)

### D2:卡片设计 — 3 按钮 vs 5 按钮
- 3 按钮:[允许一次 / 始终允许 / 拒绝]— 对齐 opencode `Reply: "once" | "always" | "reject"`
- 5 按钮:加 [仅本会话允许]、[拒绝并附理由] 等
- **决定 3 按钮** — 跟 opencode 数据模型 1:1,无歧义;附理由功能见"不在范围"

### D3:超时兜底 vs 不超时
- 超时 5min 自动 reject;没超时 → user 关掉飞书后 chatQueue 永久卡死(因为 chatQueue 里这条任务永远不返回)
- 不超时 → user 永远能补点;但卡死 chatQueue 同 chat 后续消息
- **决定 5min 超时**;超时通过 `client.permission.reply({reply: "reject"})` 走 opencode 标准 reject 路径

### D4:chatQueue 阻塞性
- 当前 `runOpencode` 在 chatQueue 里跑,等 promptAsync.await,permission 卡死时 chatQueue 同 chat 锁死
- Layer 1 设计是这样;permission 卡片机制不动 chatQueue 模型,**只是把"等"变成"等可批准/可超时"**
- 多 chat 仍并发,只锁死单 chat,可接受

### D5:chatId → sessionID 反查机制
- plugin event hook 收到 `permission.asked` event 含 sessionID,但需要知道 chatId 才能发卡片
- 扩 `chatToSession` Map 反向 index `sessionToChat: Map<sessionID, chatId>`
- 多 chat 共用 sessionID 不存在(plugin 本身就是 1:1 chat→session 创建)

## 安全考虑

| 风险 | 应对 |
|---|---|
| 卡片被 chat 内非 owner 点(群组场景)| 暂不做;群组场景不在飞书桥接当前优先级 |
| user 不在线 → 卡死 5min | 超时兜底走 reject |
| 飞书 WSS 投递延迟 / 丢失 card.action 事件 | polling fallback(`permission.list()` 每 5s 检查一次,5min 超时 = 60 次轮询)|
| 同请求被 user 多次点击触发多次 reply | opencode `permission.reply` 内部对同一 requestID 多次调用是幂等的(`pending.delete(requestID)` 后续 noop)|

## 跟 OpenClaw 对比

| 维度 | OpenClaw | 本方案 |
|---|---|---|
| 实现路径 | plugin 内嵌 OpenClaw runtime,直接拦截 agent loop 内的"need permission"内部状态 | sandbox plugin → bus event → CardKit → SDK reply |
| 改动量 | 大量内部 SDK 集成 | 0 上游侵入,纯 fork 端代码 |
| 可移植性 | 仅 OpenClaw 体系 | opencode 标准 API,future-proof |
| **结论** | 同等用户体验,**我们路径反而更干净**(走文档化 SDK)|

## 规模

**Medium**(2-4 天):
- ~300 行净代码(permission-card.ts + 改 plugin.ts + 改 wss-client.ts)
- ~150 行单测(card schema 构造 / reply routing / timeout / dedup)
- 实测调试 1 天(CardKit 边界 + 飞书 WSS 行为)

## R5 测试覆盖目标

- card schema 渲染纯函数 → 100% 覆盖(各 permission 类型 + metadata 变体)
- reply routing(action.value parse + dispatch)→ 关键路径覆盖
- timeout 兜底 → 时序测试
- session/chat 反查 + 隔离 → 单测多 chat 场景

## R4 / 上游侵入

- 0 R4 override 预计
- 0 上游侵入预计(全在 fork-only `adapter-feishu-lark/`)
