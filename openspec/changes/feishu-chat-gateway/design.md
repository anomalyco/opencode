## Context

OpenCode 当前仓库已经具备 Effect 原生的 `packages/sdk-next` 内嵌宿主、Session V2 持久输入与事件接口，以及一个较早的 Slack Socket Mode 集成示例。飞书应用凭据已经在本机被 Git 忽略的 `packages/feishu/.env.local` 中准备，DeepSeek 认证沿用 OpenCode 本机认证状态，但仓库中尚无 `packages/feishu` 实现。

本次变更跨越飞书长连接、OpenCode 会话、模型执行、持久任务、回复投递和审计日志。运行环境固定为当前 Windows 电脑，不要求公网端口。飞书应用可用范围承担本阶段入口准入；项目不建立另一套用户权限系统。由于本阶段没有数据库或本机工具能力，MySQL 不在运行链路中，但消息、追踪和纠正数据必须能被后续数据库变更复用。

数据流如下：

```text
飞书单聊 / 群聊 @机器人
        |
        v
官方 Channel 长连接与消息标准化
        |
        v
过滤 -> SQLite 持久接收事件与任务 -> 快速结束回调
        |
        v
按会话串行的后台 worker
        |
        v
内嵌 sdk-next -> feishu-chat Agent -> DeepSeek
        |
        v
持久 Session 事件 / 最终投影消息
        |
        v
SQLite 记录回答 -> 飞书最终文本回复 -> 记录投递结果
```

## Goals / Non-Goals

**Goals:**

- 在当前 Windows 电脑上以一条启动命令运行飞书长连接机器人，无需公网回调地址。
- 正确处理单聊和群聊提及，把单聊回复送回原单聊，并把群聊回复作为带原生 requester mention 的普通消息送到原群聊主时间线。
- 为同一飞书会话复用稳定的 OpenCode Session，保证同会话顺序和跨会话并发。
- 使用 DeepSeek 完成纯文本回答，并以工具列表和权限策略两层约束禁止全部工具执行。
- 对飞书重复投递、进程重启、模型失败和回复投递不确定性采取可解释、可恢复且不轻易重复回复的处理。
- 保存完整消息、逐句事件、模型执行、回答和投递结果的追加式全链路日志，为后续人工纠正、gold cases 和 MySQL 业务查询提供稳定证据。

**Non-Goals:**

- 不读取或写入用户文件，不执行 Shell、PowerShell、终端命令或项目代码修改。
- 不连接或操作 MySQL 或其他业务数据库。
- 不实现飞书卡片流式更新、思考过程展示或多条进度消息。
- 不建立项目自己的用户、角色或授权系统，也不改造旧 `/feishu` 到 Discord 的转发链路。
- 不在首版实现多机部署、集群 Session 所有权或 Windows 服务安装器。

## Decisions

### 1. 使用独立工作区包和官方 Channel 高层接口

新增 `packages/feishu` 作为顶层集成包。包内只承担配置、飞书接入、消息标准化、会话路由、任务调度、OpenCode 调用、回复和网关日志，不放入 MySQL 业务查询逻辑。

首版固定 `@larksuiteoapi/node-sdk@1.71.1`，使用官方 Channel 高层接口和 WebSocket 长连接，启用单聊并要求群聊提及。Channel 回调只做输入验证、过滤和本机持久接纳，模型推理交给后台 worker；回调以三秒内完成为目标。

采用高层 Channel 而非底层 `WSClient + EventDispatcher`，因为前者已经覆盖标准化、提及过滤、去重和重连的基础行为。也不采用飞书进程调用独立 OpenCode HTTP 服务，因为 `sdk-next` 可以在同一进程复用真实路由和 Session 语义，不需要增加端口、进程发现和跨进程鉴权。

### 2. 配置在启动边界验证，秘密不进入领域对象

启动时一次性读取并校验 `FEISHU_APP_ID`、`FEISHU_APP_SECRET` 和本机选择的 DeepSeek 模型引用。飞书凭据只从 `.env.local` 或等价进程环境读取；DeepSeek API Key 继续由 OpenCode 认证状态管理。缺失字段只报告字段名，任何日志和错误对象都不得携带已有值。

模型引用必须在启动探针中解析为可用的 DeepSeek provider/model；不能解析、认证失败或指向非 DeepSeek 模型时启动失败。确切的本机 provider/model ID 在实施首个配置测试时从现有 OpenCode 配置只读确认，不把 API Key 复制到飞书包配置。

网关内部只传递已经归一化的非秘密配置。日志写入前使用统一净化边界删除已知秘密值、认证字段和常见凭据键值；普通业务文本不默认脱敏。

### 3. 使用确定性哈希路由 Session 和 prompt message

单聊规范键为 `feishu:direct:<chat_id>:<sender_id>`。群聊规范键为 `feishu:thread:<chat_id>:<thread_root>`，其中 `thread_root` 按 `thread_id`、`root_id`、当前 `message_id` 的顺序选择。规范键只在内存中短暂存在，持久层保存其带版本命名空间的 SHA-256 标识。

OpenCode Session ID 从规范键的哈希确定性生成；飞书 `message_id` 从独立命名空间确定性生成 OpenCode prompt message ID。相同外部消息始终命中相同 Session 和 prompt ID，从而复用 Session V2 的精确重试语义。Session 创建时显式指定 `feishu-chat` Agent、已验证的 DeepSeek 模型和项目 Location；若确定性 Session 已存在则接管而不是新建。

同一个 Session 使用 keyed worker 串行执行。不同 Session 由受控并发池并行执行，单个会话失败不阻塞其他会话。该方案比只用进程内 `Map` 多出少量持久状态，但能够跨重启保持上下文、顺序和幂等。

### 4. 将持久接纳与模型执行分开

Channel 回调在一个 SQLite 事务中写入 `message_received`、逐句事件和待处理任务，提交成功后立即返回。任务状态机为：

```text
received -> admitted -> running -> answered -> sending -> delivered
    |           |          |          |          |
    +-----------+----------+----------+----------+--> failed
                                               \--> uncertain_delivery
```

`gateway_task` 保存用于恢复的当前状态、确定性标识、回复目标和尝试计数；`reply_mention_id` 和 `reply_mention_name` 是可空的任务投递元数据：前者是原始请求者的飞书 `open_id`，后者是可选的已观察显示名称。仅已接纳的群聊任务捕获和持久化这两个字段；单聊任务及其发送均不带这两个字段。状态可以推进，但每次推进必须同时向不可变的 `gateway_event` 追加对应事件。历史事件不更新、不覆盖。

进程启动时扫描非终态任务：

- `received` 可以首次提交。
- 已经生成确定性 prompt ID 的任务使用相同 ID调用 `sessions.prompt(...)`，仅接受 Session V2 判定为精确重试的结果。
- `answered` 或明确 `not_sent` 的可重试发送失败可以继续发送。
- `delivered` 永不重发。
- `uncertain_delivery` 保留人工排查状态，不自动重发。

该设计承认外部飞书发送接口不提供跨系统原子提交，因此选择“避免重复回复”优先于“网络不确定时保证至少一次回复”。

### 5. 使用 sdk-next 的真实内嵌路由和 Session V2 语义

网关在一个进程生命周期 Effect Scope 内创建一次 `OpenCode.create()`。它不启动 TUI、CLI 子进程或 HTTP listener。对于每个确定性 Session，调用 `sessions.create` 或 `sessions.get`，固定 Agent 和模型，然后以确定性 message ID 调用 `sessions.prompt`。

worker 在提交 prompt 前订阅 `sessions.events({ sessionID, after })`，并且只有观察到当前确定性 prompt message ID 的 `session.next.prompted` 后，才把后续事件归属到本轮。匹配 assistant message ID 的 `session.next.step.ended` 是本轮成功终点，`session.next.step.failed` 是失败终点；本轮出现工具请求时立即中断并按策略失败处理。到达终点后，网关通过投影消息接口读取该 assistant message 的最终文本、Token、费用和完成状态。当前 Session V2 的 `sessions.wait` 尚未实现，网关不得调用它；未来若要采用 `wait`，必须通过单独变更验证其持久化语义和故障恢复边界。只有完整最终文本进入飞书发送；文本增量不发送，reasoning 内容不记录。

项目新增隐藏的 `feishu-chat` Agent：

- `tools["*"] = false`，不向模型暴露工具。
- 权限默认全部 `deny`，形成第二层执行阻断。
- 系统提示只允许纯文本对话，并明确文件、终端和数据库能力尚未开放。

若 Session 事件仍出现任何工具调用请求，worker 立即调用 `sessions.interrupt`，追加 `operation_blocked`/策略违规事件，并生成不执行工具的失败回复。双层约束优于只依赖 Prompt，因为后者不能作为执行安全边界。

### 6. 使用独立 SQLite 任务库和追加式事件表

网关使用 Bun 内置 SQLite，数据库位于 OpenCode 本机数据目录下的飞书子目录，不进入 Git。启用 WAL、外键和显式 schema 版本迁移；schema version 2 对 version 1 进行加法升级，新增可空的 `reply_mention_id`（原始请求者的飞书 `open_id`）和 `reply_mention_name`（可选的已观察显示名称），不改写已有任务或回答正文。

核心表分为：

- `gateway_task`：每个飞书 message ID 一行，保存当前可恢复状态、哈希会话键、Session ID、prompt message ID、回复目标、仅群聊任务可用的 `reply_mention_id`（原始请求者的飞书 `open_id`）/`reply_mention_name`（可选的已观察显示名称）投递元数据、尝试计数和投递状态。
- `gateway_event`：仅插入的事件流，至少包含 `event_id`、`event_type`、`occurred_at`、`sequence`、`conversation_id`、`turn_id`、`trace_id`、`parent_event_id`、`message_id`、`sentence_id`、`sentence_index`、actor、版本、状态、耗时、关联事件和净化后的 JSON 内容。

完整用户消息与逐句事件、完整回答与逐句事件均同时保存。拆句器只依据确定性的标点和换行规则；无法可靠拆分时把完整消息作为一个句子，不改写内容。

日志事件覆盖接收、Agent/模型选择、prompt 接纳、模型开始/完成/失败、工具策略阻断、回答、发送、失败、重试和后续人工纠正。后续 MySQL change 可以追加 intent、Skill、tool 和 SQL 事件，不需要改变现有 trace 主键和消息事件。

SQLite 主日志写入失败时，不得把任务标为已接纳或已完成。网关向 OpenCode 本机日志目录的独立降级 JSONL 文件追加最小错误记录并输出不含秘密的本机错误，随后让当前动作失败；降级文件不是主日志成功的替代品。

### 7. 通过端口适配隔离外部 SDK 和真实模型

飞书 Channel、回复客户端、OpenCode Session 客户端、时钟和 ID/哈希来源在包内以窄接口注入。领域测试使用内存适配器驱动真实路由、状态机和 SQLite，不模拟全局对象；另设少量针对官方 SDK payload 的契约测试。最终答案始终以不含 mention 的正文持久化；仅 Feishu SDK 交付适配器使用官方 Channel 客户端的 `mentions` send option 和可空的群聊投递元数据渲染原生 requester mention，绝不手工构造飞书 mention markup。群聊最终答案不传 `replyTo` 或 `replyInThread`，使固定版本 SDK 调用消息创建接口并把答案显示在群聊主时间线；单聊仍使用不带发送选项的普通文本消息。入站 `thread_id`、`root_id` 和确定性 Session 路由保持不变，这次只改变最终投递形态。

OpenCode 集成测试使用真实 `sdk-next` 内嵌路由、临时 Location 和测试 provider，验证确定性 Session、prompt 重试、事件收集与工具阻断。真实飞书和 DeepSeek 只用于最终手工烟雾测试，避免把外部账号和费用引入常规测试。

## Risks / Trade-offs

- [飞书发送成功但本地未记录成功会形成不确定投递] → 把状态记为 `uncertain_delivery`，不自动重发，并保留 trace 供人工确认。
- [本机掉电发生在飞书回调接收与 SQLite 提交之间] → 依赖飞书重复投递和确定性 message ID；只有事务提交成功才确认本地接纳。
- [官方 Channel 高层 API 的行为或类型与设计假设不一致] → 固定 SDK 版本，并用最小契约测试确认普通消息创建、原生提及和重连事件。
- [同一 Session 的消息并发导致上下文交错] → keyed worker 串行同 Session，禁止绕过队列直接调用 prompt。
- [DeepSeek 调用耗时超过飞书回调时限] → 回调只做持久接纳，模型在后台执行。
- [双层工具限制仍出现上游回归] → 监听工具事件并中断 Session；安全测试必须证明执行端口未被调用。
- [追加式事件快速增长] → 首版保留完整证据并提供只读查询索引；归档、压缩和保留周期作为后续运维变更。
- [逐句规则对无标点或语音文本不可靠] → 回退为一个完整句子，准确保留原意。
- [本机单进程不是高可用部署] → 本阶段接受单机边界，通过持久任务和重启恢复降低故障影响；集群所有权另行设计。

## Migration Plan

1. 新增 `packages/feishu`、隐藏 Agent 和自动化测试，不改变现有 Slack、TUI、Web 或数据库路径。
2. 在临时目录运行 SQLite migration、路由、幂等、恢复、日志净化和 sdk-next 集成测试。
3. 使用本机现有 OpenCode 认证状态只读确认 DeepSeek provider/model 引用，启动配置探针但不连接飞书。
4. 配置并发布飞书测试应用版本，先完成单聊烟雾测试，再完成群聊提及、重复投递、重启恢复和工具阻断验收。
5. 保留网关 SQLite 和降级日志作为审计证据；发布失败时停止飞书进程即可回滚，不影响 OpenCode 其他入口。数据库迁移只允许向前追加；需要回退二进制时先备份网关数据库。

## Open Questions

- 本机 OpenCode 配置中最终采用的 DeepSeek `providerID/modelID` 需要在实施首个配置测试中确认；该值不是秘密，但必须解析为 DeepSeek 且认证可用。
- Windows 上的长期进程托管方式暂不纳入 MVP；验收只要求一条本机命令可启动并在前台常驻。
