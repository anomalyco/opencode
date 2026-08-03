## Why

当前项目已经具备可用的 OpenCode 会话能力和 DeepSeek 模型配置，但员工还没有一个无需公网回调、可在现有飞书工作环境中直接使用的对话入口。先打通受限的飞书纯聊天链路，可以独立验证接入、会话连续性、模型调用、回复投递和全链路日志，再把 MySQL 业务查询能力作为独立变更接入，避免同时引入数据库风险。

## What Changes

- 新增独立的 `packages/feishu`，在当前 Windows 电脑上通过飞书官方 Node SDK 的 WebSocket 长连接接收消息并发送最终文本回复，无需公网地址。
- 支持机器人单聊，以及群聊中明确 `@机器人` 的消息；未提及机器人的群消息静默忽略。
- 将飞书单聊和群消息串稳定映射到 OpenCode Session，使同一会话保留上下文、不同会话相互隔离，并允许不同会话并行处理。
- 使用确定性消息标识、本地持久任务状态和顺序调度实现重复投递抑制、同会话串行、进程重启恢复和谨慎的回复重试。
- 通过 `packages/sdk-next` 在同一进程内调用 OpenCode，固定使用 DeepSeek 和专用 `feishu-chat` Agent；该 Agent 不注册任何工具并拒绝全部工具调用。
- 使用本机 SQLite 保存追加式任务状态和全链路事件，记录完整消息、逐句事件、统一 `trace_id`、模型执行、最终回答、投递结果和后续人工纠正关联。
- 从本机环境读取飞书凭据，继续使用 OpenCode 已有的 DeepSeek 认证；凭据、令牌、隐藏思考过程和其他认证秘密不得进入仓库、日志、错误回复或测试快照。
- 将本次范围限定为“飞书消息 → OpenCode/DeepSeek → 飞书最终回复”。MySQL、文件、终端、项目修改、业务工具、流式卡片和自建权限系统均不在本次变更范围内。
- 形成三个可独立验收的里程碑：本机飞书收发链路；稳定会话与受限模型执行；可恢复任务、幂等投递和追加式审计日志。

## Capabilities

### New Capabilities

- `feishu-message-gateway`: 飞书长连接接入、单聊与群聊提及过滤、后台处理和最终文本回复行为。
- `feishu-conversation-routing`: 飞书会话到 OpenCode Session 的稳定映射、顺序与并发、幂等和重启恢复行为。
- `restricted-chat-execution`: 通过内嵌 OpenCode 和 DeepSeek 执行纯文本对话，并强制禁止全部工具能力。
- `conversation-event-log`: 对话、模型执行和投递过程的追加式逐句事件、统一追踪、人工纠正关联和秘密排除行为。

### Modified Capabilities

无。

## Impact

- 新增 `packages/feishu` 工作区包、启动命令、配置校验、飞书适配器、会话路由、任务调度、本机 SQLite 存储及相关测试。
- 新增 `@larksuiteoapi/node-sdk@1.71.1` 运行时依赖，并复用 `@opencode-ai/sdk-next`、Bun SQLite、Effect 和现有 OpenCode Session V2 能力。
- 飞书侧需要启用机器人、长连接和 `im.message.receive_v1`，授予接收单聊、接收群聊提及和发送消息所需权限，并发布供测试人员使用的应用版本。
- DeepSeek 认证继续由 OpenCode 现有本机状态提供；飞书应用凭据只存在于被 Git 忽略的本机环境配置。
- 本次变更不修改 MySQL，也不改变后续“飞书入口 → MySQL 业务工具 → Web/MCP/Spring Boot 接入”的总体路线。
