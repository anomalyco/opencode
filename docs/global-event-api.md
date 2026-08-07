# `/global/event` API 接口文档

## 1. API 概述

`GET /global/event` 是一个基于 **Server-Sent Events (SSE)** 的实时事件流接口。客户端通过该接口订阅服务端的全局事件总线（`GlobalBus`），接收所有项目实例的生命周期事件、会话事件、工具调用事件、权限请求等。

该接口是 opencode 前后端通信的核心通道，所有 UI 状态同步均依赖此事件流。

## 1.5 端点选择指南

opencode 提供两个 SSE 事件端点，适用于不同场景：

| 特性 | `/global/event`（本文档） | `/api/event` |
|---|---|---|
| 信封格式 | `{ directory, project?, workspace?, payload }` | `{ id, type, data, durable?, location? }` |
| 心跳方式 | 类型化事件 `server.heartbeat`（每 10 秒） | SSE 注释 `: heartbeat`（每 15 秒） |
| 事件范围 | 所有项目实例的全局事件 | 当前实例的事件 |
| 背压处理 | 无界队列（不丢弃事件） | 有界队列（容量 256，溢出时断开连接） |
| 适用场景 | TUI、桌面客户端、多项目监控 | 单项目集成、Web 客户端 |

> **建议**：大多数客户端应使用 `/global/event`。仅在需要 Protocol 原生信封格式或单实例隔离时使用 `/api/event`。

## 2. 连接方式

### 请求

```
GET /global/event
Accept: text/event-stream
```

### 响应头

| Header | 值 | 说明 |
|---|---|---|
| `Content-Type` | `text/event-stream` | SSE 标准内容类型 |
| `Cache-Control` | `no-cache, no-transform` | 禁止缓存和转换 |
| `X-Accel-Buffering` | `no` | 禁用 Nginx 缓冲 |
| `X-Content-Type-Options` | `nosniff` | 禁止 MIME 嗅探 |

> **注意**：响应压缩被显式禁用，确保事件实时送达。

## 2.5 连接管理

### 认证

默认情况下，`/global/event` 不需要认证。当服务端启用 `ServerAuth` 时，支持以下认证方式：

- **HTTP Basic Auth**：`Authorization: Basic <base64(username:password)>`
- **查询参数**：`GET /global/event?auth_token=<base64(username:password)>`

认证失败时返回 `401 Unauthorized`，响应头包含 `WWW-Authenticate: Basic realm="Secure Area"`。

### 连接限制

服务端不对并发 SSE 连接数做限制。每个连接独立订阅全局事件总线。客户端应自行控制连接数量，避免不必要的资源消耗。

### 错误响应

连接建立阶段可能返回以下 HTTP 状态码：

| 状态码 | 含义 |
|---|---|
| `200` | 连接成功，开始接收事件流 |
| `401` | 认证失败 |
| `500` | 服务端内部错误 |

连接建立后，错误通过事件流中的 `session.error` 事件传递，不会中断 SSE 连接。

## 3. SSE 数据格式

每个 SSE 帧的传输格式为：

```
event: message
data: <JSON>

```

其中 `<JSON>` 为事件信封的 JSON 序列化字符串。

## 4. 事件信封结构

每个事件的 JSON 数据结构如下：

```typescript
{
  directory: string       // 项目目录路径，或 "global"
  project?: string        // 项目 ID（可选）
  workspace?: string      // 工作区 ID（可选）
  payload: EventPayload   // 事件载荷（联合类型，见下文）
}
```

### EventPayload 结构

大多数事件的 `payload` 结构为：

```typescript
{
  id: string              // 事件唯一 ID（格式：evt_*）
  type: string            // 事件类型标识符
  properties: object      // 事件特定属性
}
```

`sync` 事件的 `payload` 结构为：

```typescript
{
  type: "sync"
  id: string              // 原始事件 ID
  syncEvent: {
    type: string          // 带版本号的事件类型（如 "session.next.step.ended.2"）
    id: string            // 原始事件 ID
    seq: number           // 序列号
    aggregateID: string   // 关联实体 ID（通常为 sessionID，用于事件分组和重放）
    data: object          // 原始事件数据
  }
}
```

## 5. 连接生命周期事件

### 5.1 连接建立（`server.connected`）

客户端连接成功后，服务端立即发送：

```json
{
  "directory": "global",
  "payload": {
    "id": "evt_0192a3b4c5d6e7f8g9h0j1k2l3",
    "type": "server.connected",
    "properties": {}
  }
}
```

### 5.2 心跳（`server.heartbeat`）

连接期间每 **10 秒**发送一次心跳：

```json
{
  "payload": {
    "id": "evt_0192a3b4c5d7e8f9g0h1j2k3l4",
    "type": "server.heartbeat",
    "properties": {}
  }
}
```

> **事件 ID 格式**：`evt_` + 12 位十六进制时间戳编码 + 14 位随机 base62 字符（共 30 字符）。ID 按时间单调递增，可用于排序和去重。

### 5.3 连接断开

连接关闭时，SSE 流终止。客户端应实现重连逻辑。

## 6. 完整事件目录

### 6.1 服务器事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `server.connected` | `{}` | 否 | 连接建立时发送 |
| `server.heartbeat` | `{}` | 否 | 每 10 秒心跳 |
| `server.instance.disposed` | `{ directory: string }` | 否 | 单个项目实例被销毁 |
| `global.disposed` | `{}` | 否 | 所有实例被销毁 |

### 6.2 会话 V2 事件（`session.next.*`）

#### 会话控制

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `session.next.agent.switched` | `{ timestamp, sessionID, messageID, agent: string }` | 是 (v1) | 会话内 Agent 切换 |
| `session.next.model.switched` | `{ timestamp, sessionID, messageID, model: Model.Ref }` | 是 (v1) | 会话内模型切换 |
| `session.next.moved` | `{ timestamp, sessionID, location: Location.Ref, subdirectory?: string }` | 是 (v1) | 会话迁移到新位置 |
| `session.next.prompted` | `{ timestamp, sessionID, messageID, prompt: Prompt, delivery: Delivery }` | 是 (v1) | 用户 prompt 投递到会话 |
| `session.next.prompt.admitted` | `{ timestamp, sessionID, messageID, prompt: Prompt, delivery: Delivery }` | 是 (v1) | Prompt 持久化准入（变为可见前） |
| `session.next.context.updated` | `{ timestamp, sessionID, messageID, text: string }` | 是 (v1) | 会话上下文文本更新 |
| `session.next.synthetic` | `{ timestamp, sessionID, messageID, text: string }` | 是 (v1) | 合成系统消息注入 |
| `session.next.retried` | `{ timestamp, sessionID, attempt: number, error: RetryError }` | 是 (v1) | LLM 请求因错误被重试 |

> **RetryError** 结构：`{ message: string, statusCode?: number, isRetryable: boolean, responseHeaders?: Record<string, string>, responseBody?: string, metadata?: Record<string, string> }`

#### Shell 执行

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `session.next.shell.started` | `{ timestamp, sessionID, messageID, callID, command: string }` | 是 (v1) | Shell 命令执行开始 |
| `session.next.shell.ended` | `{ timestamp, sessionID, callID, output: string }` | 是 (v1) | Shell 命令执行完成 |

#### 步骤（Step）

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `session.next.step.started` | `{ timestamp, sessionID, assistantMessageID, agent, model: Model.Ref, snapshot?: string }` | 是 (v1) | LLM Provider 步骤（一轮模型交互）开始 |
| `session.next.step.ended` | `{ timestamp, sessionID, assistantMessageID, finish, cost, tokens: Tokens, snapshot?, files?: string[] }` | 是 (v2) | LLM Provider 步骤成功完成 |
| `session.next.step.failed` | `{ timestamp, sessionID, assistantMessageID, error: UnknownError }` | 是 (v2) | LLM Provider 步骤失败 |

> **Tokens** 结构：`{ input: number, output: number, reasoning: number, cache: { read: number, write: number } }`

#### 文本流

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `session.next.text.started` | `{ timestamp, sessionID, assistantMessageID, textID }` | 是 (v1) | 文本生成开始 |
| `session.next.text.delta` | `{ timestamp, sessionID, assistantMessageID, textID, delta }` | 否（仅实时） | 流式文本片段 |
| `session.next.text.ended` | `{ timestamp, sessionID, assistantMessageID, textID, text }` | 是 (v1) | 文本生成完成，包含完整文本 |

#### 推理流（Reasoning）

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `session.next.reasoning.started` | `{ timestamp, sessionID, assistantMessageID, reasoningID, providerMetadata? }` | 是 (v1) | 推理/思考生成开始 |
| `session.next.reasoning.delta` | `{ timestamp, sessionID, assistantMessageID, reasoningID, delta }` | 否（仅实时） | 流式推理片段 |
| `session.next.reasoning.ended` | `{ timestamp, sessionID, assistantMessageID, reasoningID, text, providerMetadata? }` | 是 (v1) | 推理/思考生成完成 |

#### 工具输入流（Tool Input）

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `session.next.tool.input.started` | `{ timestamp, sessionID, assistantMessageID, callID, name }` | 是 (v1) | 工具输入流开始 |
| `session.next.tool.input.delta` | `{ timestamp, sessionID, assistantMessageID, callID, delta }` | 否（仅实时） | 流式工具输入片段（原始 JSON） |
| `session.next.tool.input.ended` | `{ timestamp, sessionID, assistantMessageID, callID, text }` | 是 (v1) | 工具输入流完成 |

#### 工具执行

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `session.next.tool.called` | `{ timestamp, sessionID, assistantMessageID, callID, tool, input, provider: { executed, metadata? } }` | 是 (v1) | 工具被调用且输入已解析 |
| `session.next.tool.progress` | `{ timestamp, sessionID, assistantMessageID, callID, structured, content: ToolContent[] }` | 是 (v1) | 工具执行进度检查点 |
| `session.next.tool.success` | `{ timestamp, sessionID, assistantMessageID, callID, structured, content, outputPaths?, result?, provider }` | 是 (v1) | 工具执行成功 |
| `session.next.tool.failed` | `{ timestamp, sessionID, assistantMessageID, callID, error, result?, provider }` | 是 (v1) | 工具执行失败 |

#### 上下文压缩（Compaction）

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `session.next.compaction.started` | `{ timestamp, sessionID, messageID, reason: "auto" \| "manual" }` | 是 (v1) | 会话历史压缩开始 |
| `session.next.compaction.delta` | `{ timestamp, sessionID, messageID, text }` | 否（仅实时） | 流式压缩文本片段 |
| `session.next.compaction.ended` | `{ timestamp, sessionID, messageID, reason, text, recent }` | 是 (v1) | 会话历史压缩完成 |

#### 回退（Revert）

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `session.next.revert.staged` | `{ timestamp, sessionID, revert: Revert.State }` | 是 (v1) | 回滚状态暂存（提交前预览） |
| `session.next.revert.cleared` | `{ timestamp, sessionID }` | 是 (v1) | 暂存的回滚被清除（未提交） |
| `session.next.revert.committed` | `{ timestamp, sessionID, messageID }` | 是 (v1) | 暂存的回滚被提交 |

### 6.3 会话 V1 事件

#### 持久化事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `session.created` | `{ sessionID, info: SessionInfo }` | 是 (v1) | 新会话创建 |
| `session.updated` | `{ sessionID, info: SessionInfo }` | 是 (v1) | 会话元数据更新 |
| `session.deleted` | `{ sessionID, info: SessionInfo }` | 是 (v1) | 会话删除 |
| `message.updated` | `{ sessionID, info: Message }` | 是 (v1) | 消息（user/assistant）创建或更新 |
| `message.removed` | `{ sessionID, messageID }` | 是 (v1) | 消息从会话中移除 |
| `message.part.updated` | `{ sessionID, part: Part, time: number }` | 是 (v1) | 消息部分（text/tool/reasoning 等）创建或更新 |
| `message.part.removed` | `{ sessionID, messageID, partID }` | 是 (v1) | 消息部分移除 |

#### 实时事件（仅在线，不可重放）

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `message.part.delta` | `{ sessionID, messageID, partID, field, delta }` | 否 | 消息部分流式增量 |
| `session.diff` | `{ sessionID, diff: FileDiff.Info[] }` | 否 | 会话文件差异变更 |
| `session.error` | `{ sessionID?: string, error }` | 否 | 会话级错误通知 |

### 6.4 会话状态事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `session.status` | `{ sessionID, status: SessionStatus }` | 否 | 会话状态变更（idle/busy/retry） |
| `session.idle` | `{ sessionID }` | 否（已弃用） | 会话空闲（请使用 `session.status`） |
| `session.compacted` | `{ sessionID }` | 否 | 会话压缩完成通知 |

> **SessionStatus** 联合类型：
> - `{ type: "idle" }` — 空闲
> - `{ type: "busy" }` — 忙碌
> - `{ type: "retry", attempt, message, action?: { reason, provider, title, message, label, link? }, next }` — 重试中

### 6.5 待办事项事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `todo.updated` | `{ sessionID, todos: Array<{ content, status, priority }> }` | 否 | 会话 Todo 列表更新 |

### 6.6 安装事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `installation.updated` | `{ version: string }` | 否 | 服务端已完成升级 |
| `installation.update-available` | `{ version: string }` | 否 | 有新版本可用 |

### 6.7 工作区事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `workspace.ready` | `{ name: string }` | 否 | 工作区初始化完成 |
| `workspace.failed` | `{ message: string }` | 否 | 工作区初始化失败 |
| `workspace.status` | `{ workspaceID, status: "connected" \| "connecting" \| "disconnected" \| "error" }` | 否 | 工作区连接状态变更 |

### 6.8 Worktree 事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `worktree.ready` | `{ name, branch?: string }` | 否 | Worktree 初始化完成 |
| `worktree.failed` | `{ message }` | 否 | Worktree 初始化失败 |

### 6.9 VCS 事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `vcs.branch.updated` | `{ branch?: string }` | 否 | 当前 Git 分支变更 |

### 6.10 文件系统事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `file.edited` | `{ file: string }` | 否 | 文件被工具编辑 |
| `file.watcher.updated` | `{ file: string, event: "add" \| "change" \| "unlink" }` | 否 | 文件系统监听事件（新增/修改/删除） |

### 6.11 权限事件（V2）

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `permission.v2.asked` | `{ id, sessionID, action, resources, save?, metadata?, source? }` | 否 | 权限请求提出，等待用户回复 |
| `permission.v2.replied` | `{ sessionID, requestID, reply: "once" \| "always" \| "reject" }` | 否 | 用户回复权限请求 |

### 6.12 权限事件（V1）

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `permission.asked` | `{ id, sessionID, permission, patterns, metadata, always, tool? }` | 否 | V1 权限请求提出 |
| `permission.replied` | `{ sessionID, requestID, reply: "once" \| "always" \| "reject" }` | 否 | V1 用户回复权限请求 |

### 6.13 问题事件（V2）

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `question.v2.asked` | `{ id, sessionID, questions, tool? }` | 否 | 向用户提问，等待回答 |
| `question.v2.replied` | `{ sessionID, requestID, answers: string[][] }` | 否 | 用户回答问题 |
| `question.v2.rejected` | `{ sessionID, requestID }` | 否 | 用户拒绝/关闭问题 |

### 6.14 问题事件（V1）

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `question.asked` | `{ id, sessionID, questions, tool? }` | 否 | V1 向用户提问 |
| `question.replied` | `{ sessionID, requestID, answers: string[][] }` | 否 | V1 用户回答问题 |
| `question.rejected` | `{ sessionID, requestID }` | 否 | V1 用户拒绝/关闭问题 |

### 6.15 插件事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `plugin.added` | `{ id }` | 否 | 插件注册 |

### 6.16 PTY 事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `pty.created` | `{ info: PtyInfo }` | 否 | PTY 终端创建 |
| `pty.updated` | `{ info: PtyInfo }` | 否 | PTY 终端状态变更 |
| `pty.exited` | `{ id, exitCode }` | 否 | PTY 终端进程退出 |
| `pty.deleted` | `{ id }` | 否 | PTY 终端被移除 |

> **PtyInfo**：`{ id, title, command, args, cwd, status: "running" \| "exited", pid, exitCode? }`

### 6.17 项目事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `project.updated` | `{ id, worktree, vcs?, name?, icon?, commands?, time, sandboxes }` | 否 | 项目元数据更新 |
| `project.directories.updated` | `{ projectID }` | 否 | 项目目录变更 |

### 6.18 集成事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `integration.updated` | `{}` | 否 | 集成配置变更 |
| `integration.connection.updated` | `{ integrationID }` | 否 | 集成连接状态变更 |

### 6.19 目录 / 模型 / 引用 / LSP 事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `catalog.updated` | `{}` | 否 | Provider 目录更新 |
| `models-dev.refreshed` | `{}` | 否 | 模型定义刷新 |
| `reference.updated` | `{}` | 否 | 引用源（本地仓库等）更新 |
| `lsp.updated` | `{}` | 否 | LSP 语言服务器状态变更 |

### 6.20 MCP 事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `mcp.tools.changed` | `{ server: string }` | 否 | MCP 服务器工具列表变更 |
| `mcp.browser.open.failed` | `{ mcpName, url }` | 否 | MCP 浏览器打开失败 |

### 6.21 TUI 事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `tui.prompt.append` | `{ text }` | 否 | 向 TUI 输入框追加文本 |
| `tui.command.execute` | `{ command }` | 否 | 触发 TUI 命令执行 |
| `tui.toast.show` | `{ title?, message, variant: "info"\|"success"\|"warning"\|"error", duration }` | 否 | 显示 TUI 通知弹窗 |
| `tui.session.select` | `{ sessionID }` | 否 | 切换 TUI 当前会话 |

### 6.22 遗留事件

| 事件类型 | Properties | 持久化 | 说明 |
|---|---|---|---|
| `command.executed` | `{ name, sessionID, arguments, messageID }` | 否 | 遗留命令执行事件 |

## 7. Sync 事件（持久化事件包装器）

对于所有标记为**持久化**的事件，除了正常的 `payload` 外，还会额外发射一个 `sync` 包装事件，用于事件重放和持久化同步。

### 结构

```json
{
  "directory": "<项目目录>",
  "project": "<项目ID>",
  "workspace": "<工作区ID>",
  "payload": {
    "type": "sync",
    "id": "<原始事件ID>",
    "syncEvent": {
      "type": "<事件类型>.<版本号>",
      "id": "<原始事件ID>",
      "seq": 0,
      "aggregateID": "<聚合根ID，通常为 sessionID>",
      "data": { "timestamp": 1700000000000, "sessionID": "ses_xyz", "assistantMessageID": "msg_123", "finish": "stop", "cost": 0.01, "tokens": { "input": 100, "output": 50, "reasoning": 0, "cache": { "read": 80, "write": 20 } } }
    }
  }
}
```

### 示例

一个 `session.next.step.ended` 事件会产生两个 SSE 帧：

**帧 1 — 普通事件：**

```json
{
  "directory": "/home/user/project",
  "project": "proj_abc",
  "payload": {
    "id": "evt_001",
    "type": "session.next.step.ended",
    "properties": {
      "timestamp": 1700000000000,
      "sessionID": "ses_xyz",
      "assistantMessageID": "msg_123",
      "finish": "stop",
      "cost": 0.01,
      "tokens": { "input": 100, "output": 50, "reasoning": 0, "cache": { "read": 80, "write": 20 } }
    }
  }
}
```

**帧 2 — Sync 包装器：**

```json
{
  "directory": "/home/user/project",
  "project": "proj_abc",
  "payload": {
    "type": "sync",
    "id": "evt_001",
    "syncEvent": {
      "type": "session.next.step.ended.2",
      "id": "evt_001",
      "seq": 5,
      "aggregateID": "ses_xyz",
      "data": { "timestamp": 1700000000000, "sessionID": "ses_xyz", "assistantMessageID": "msg_123", "finish": "stop", "cost": 0.01, "tokens": { "input": 100, "output": 50, "reasoning": 0, "cache": { "read": 80, "write": 20 } } }
    }
  }
}
```

### 会触发 Sync 包装的持久化事件列表

**Session V2 (v1)**：`session.next.agent.switched`, `session.next.model.switched`, `session.next.moved`, `session.next.prompted`, `session.next.prompt.admitted`, `session.next.context.updated`, `session.next.synthetic`, `session.next.shell.started`, `session.next.shell.ended`, `session.next.step.started`, `session.next.text.started`, `session.next.text.ended`, `session.next.reasoning.started`, `session.next.reasoning.ended`, `session.next.tool.input.started`, `session.next.tool.input.ended`, `session.next.tool.called`, `session.next.tool.progress`, `session.next.tool.success`, `session.next.tool.failed`, `session.next.retried`, `session.next.compaction.started`, `session.next.compaction.ended`, `session.next.revert.staged`, `session.next.revert.cleared`, `session.next.revert.committed`

**Session V2 (v2)**：`session.next.step.ended`, `session.next.step.failed`

**Session V1 (v1)**：`session.created`, `session.updated`, `session.deleted`, `message.updated`, `message.removed`, `message.part.updated`, `message.part.removed`

## 7.5 完整示例

### 线格式示例

以下是一个真实的 SSE 流片段，展示连接建立后接收到的前几个事件：

```
event: message
data: {"directory":"global","payload":{"id":"evt_0192a3b4c5d6e7f8g9h0j1k2l3","type":"server.connected","properties":{}}}

event: message
data: {"directory":"/home/user/myproject","project":"proj_abc123","payload":{"id":"evt_0192a3b4c5d7e8f9g0h1j2k3l4","type":"session.created","properties":{"sessionID":"ses_0192a3b4c5d8e9f0g1h2j3k4l5","info":{"id":"ses_0192a3b4c5d8e9f0g1h2j3k4l5","title":"New Session","agent":"build","version":"0.5.0","time":{"created":1700000000000,"updated":1700000000000}}}}}

event: message
data: {"directory":"/home/user/myproject","project":"proj_abc123","payload":{"type":"sync","id":"evt_0192a3b4c5d7e8f9g0h1j2k3l4","syncEvent":{"type":"session.created.1","id":"evt_0192a3b4c5d7e8f9g0h1j2k3l4","seq":1,"aggregateID":"ses_0192a3b4c5d8e9f0g1h2j3k4l5","data":{"sessionID":"ses_0192a3b4c5d8e9f0g1h2j3k4l5","info":{"id":"ses_0192a3b4c5d8e9f0g1h2j3k4l5","title":"New Session","agent":"build","version":"0.5.0","time":{"created":1700000000000,"updated":1700000000000}}}}}}

event: message
data: {"payload":{"id":"evt_0192a3b4c5d8e9f0g1h2j3k4l5","type":"server.heartbeat","properties":{}}}

```

### 典型事件流

**文本生成流程**：

```
session.next.step.started → session.next.text.started → session.next.text.delta (×N) → session.next.text.ended → session.next.step.ended
```

**工具调用流程**：

```
session.next.tool.input.started → session.next.tool.input.delta (×N) → session.next.tool.input.ended → session.next.tool.called → session.next.tool.progress (×N) → session.next.tool.success | session.next.tool.failed
```

**权限交互流程**：

```
permission.v2.asked → (用户操作) → permission.v2.replied
```

**会话完成检测**：

```
session.next.step.ended → session.status { type: "idle" }
```

## 8. 注意事项

1. **事件顺序**：持久化事件会先发射普通事件帧，紧接着发射 `sync` 包装帧。客户端应正确处理两者的关联。

2. **实时事件不可重放**：标记为"仅实时"的事件（如 `*.delta`、`session.diff`、`session.error`）不会被持久化，断线重连后无法恢复。

3. **`server.instance.disposed` 特殊性**：该事件直接发射到 GlobalBus（不经过 EventV2），因此不会生成 `sync` 包装事件。

4. **`directory` 字段语义**：项目级事件为项目目录绝对路径；全局事件（如 `global.disposed`、`installation.updated`）为 `"global"`。

5. **V1 与 V2 事件共存**：权限和问题事件同时存在 V1 和 V2 版本（`permission.v2.*` / `question.v2.*`）。

6. **`session.idle` 已弃用**：请使用 `session.status` 中 `status.type === "idle"` 替代。

7. **心跳与重连策略**：`/global/event` 的心跳以类型化事件 `server.heartbeat` 发送（每 10 秒），可在事件处理器中直接捕获。建议客户端实现以下重连策略：
   - **超时检测**：超过 **30 秒**未收到任何事件（包括心跳）时，主动断开并重连
   - **指数退避**：初始重连间隔 1 秒，每次失败后翻倍，上限 30 秒
   - **抖动**：在退避间隔上添加 0–1 秒随机抖动，避免雷群效应
   - **状态恢复**：重连后通过 REST API（如 `/session`、`/sync`）重新获取当前状态，而非依赖事件重放

8. **事件 ID 格式**：所有事件 ID 格式为 `evt_` + 12 位十六进制时间戳编码 + 14 位随机 base62 字符（共 30 字符），按时间单调递增，可用于排序和去重。

9. **不支持 `Last-Event-ID`**：SSE 帧的协议级 `id` 字段始终为空，因此标准 SSE 的 `Last-Event-ID` 重连机制不可用。事件 ID 仅存在于 JSON 载荷的 `id` 字段中。

10. **背压与内存**：`/global/event` 使用无界队列，慢速消费者不会丢失事件但会导致服务端内存持续增长。`/api/event` 使用容量 256 的有界队列，队列满时连接将被终止（`SubscriberOverflowError`）。客户端应及时消费事件，避免在处理逻辑中执行阻塞操作。
