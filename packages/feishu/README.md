# Feishu Chat Gateway

本包在当前 Windows 电脑上通过飞书官方 Node SDK 的 WebSocket 长连接接收消息，并在同一进程中使用内嵌 OpenCode 与 DeepSeek 生成最终纯文本回复，不需要公网回调地址，也不会启动额外的 OpenCode HTTP 监听端口。

## 飞书应用设置

在飞书开放平台启用机器人和长连接事件订阅，订阅 `im.message.receive_v1`。应用需要具备接收单聊消息、接收群聊中明确 `@机器人` 的消息以及发送消息的权限，并发布一个测试可用版本。未提及机器人的群聊消息会被静默忽略。

## 本机配置

复制 `.env.example` 为被 Git 忽略的 `.env.local`，填写字段，不要把值写进仓库、日志、截图或问题报告：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_MODEL`，使用 `providerID/modelID`，例如 `deepseek/deepseek-chat`
- `FEISHU_DATA_DIRECTORY`，存放网关 SQLite 与降级日志
- `FEISHU_WORKSPACE_DIRECTORY`，OpenCode Session 使用的项目目录

DeepSeek API Key 继续由 OpenCode 本机认证状态管理，不复制到飞书包。启动预检会确认模型确实解析到 DeepSeek 且认证可用；失败时只报告字段名或净化后的原因，不打印凭据。

## 启动

在 `packages/feishu` 目录运行：

```powershell
bun run start
```

进程以前台方式保持运行。首版只使用 WebSocket Channel，不配置公网回调。

## 数据与审计

主任务库位于 `FEISHU_DATA_DIRECTORY` 下。用户消息、最终回答、逐句事件、模型执行和投递状态以追加式事件记录；认证秘密和模型隐藏思考过程不得写入 SQLite、降级日志或控制台。

后续 MySQL 库存查询仍只允许固定只读模板。Agent 始终不暴露数据库或其他工具。
