# OpenCode Observer 设计文档

## 1. 概述

OpenCode Observer 是一个独立的 Web 服务端，用于实时监控 `opencode serve` 的 session 活动状态。它提供类似 opencode TUI 的 Web 界面，能够：

- 列出当前所有 session，标识正在运行的 session
- 切换到某个 session 时，实时显示大模型交互流、tool 调用流、subagent 调用流
- 实时流式展示 LLM 文本输出、reasoning 过程、tool 执行进度

## 2. OpenCode 源码架构分析

### 2.1 核心架构

opencode 采用 Effect 生态构建，核心包结构：

| 包 | 职责 |
|---|---|
| `packages/core` | 核心数据模型（Session、Message、Event、Project 等） |
| `packages/opencode` | 主应用（CLI、Server、TUI、Session 管理） |
| `packages/server` | V2 API 层 |
| `packages/sdk` | 自动生成的 TypeScript SDK 客户端 |

### 2.2 Session 数据模型

**Session.Info**（`packages/core/src/session/schema.ts`）：

```typescript
{
  id: string              // "ses_" 前缀
  parentID?: string       // 父 session（fork 关系）
  projectID: string
  agent?: string          // 当前 agent
  model?: ModelV2.Ref     // 当前 model
  cost: number
  tokens: { input, output, reasoning, cache: { read, write } }
  time: { created, updated, archived? }
  title: string
  location: Location.Ref
  subpath?: string
}
```

**SessionStatus**（`packages/opencode/src/session/status.ts`）：

```typescript
type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; action?: {...}; next: number }
```

### 2.3 Message 数据模型

**V1 Message（SDK 类型）**：

- `UserMessage`：用户消息，包含 text、files、agents、references
- `AssistantMessage`：助手消息，包含 model、agent、cost、tokens、error

**Part 类型**（消息的组成部分）：

| Part 类型 | 说明 |
|---|---|
| `TextPart` | LLM 文本输出 |
| `ReasoningPart` | 推理/思考过程 |
| `ToolPart` | 工具调用（含 state: pending/running/completed/error） |
| `SubtaskPart` | 子代理/子任务调用 |
| `StepStartPart` | 步骤开始 |
| `StepFinishPart` | 步骤结束（含 cost、tokens） |
| `AgentPart` | Agent 切换 |
| `CompactionPart` | 压缩/摘要 |
| `RetryPart` | 重试 |

**ToolState**：

```typescript
type ToolState =
  | { status: "pending"; input: {}; raw: string }
  | { status: "running"; input: {}; title?; metadata?; time: { start } }
  | { status: "completed"; input: {}; output: string; title; metadata; time: { start, end } }
  | { status: "error"; input: {}; error: string; metadata?; time: { start, end } }
```

### 2.4 Event 系统

opencode 使用 EventV2 事件溯源系统，事件分为两类：

**Durable Events**（持久化事件）：

| 事件类型 | 说明 |
|---|---|
| `session.next.step.started` | 步骤开始（含 agent、model） |
| `session.next.step.ended` | 步骤结束（含 cost、tokens） |
| `session.next.step.failed` | 步骤失败 |
| `session.next.text.started` | 文本输出开始 |
| `session.next.text.ended` | 文本输出结束 |
| `session.next.tool.called` | 工具被调用（含 tool name、input） |
| `session.next.tool.progress` | 工具执行进度 |
| `session.next.tool.success` | 工具执行成功 |
| `session.next.tool.failed` | 工具执行失败 |
| `session.next.reasoning.started` | 推理开始 |
| `session.next.reasoning.ended` | 推理结束 |
| `session.next.prompted` | 用户发送消息 |
| `session.next.agent.switched` | Agent 切换 |
| `session.next.model.switched` | Model 切换 |

**Ephemeral Events**（瞬态事件，不持久化）：

| 事件类型 | 说明 |
|---|---|
| `session.next.text.delta` | 文本流式增量 |
| `session.next.tool.input.delta` | 工具输入流式增量 |
| `session.next.reasoning.delta` | 推理流式增量 |
| `session.next.compaction.delta` | 压缩流式增量 |

**V1 Bridge Events**（通过 GlobalBus 桥接的 V1 事件）：

| 事件类型 | 说明 |
|---|---|
| `session.created` | Session 创建 |
| `session.updated` | Session 更新 |
| `session.deleted` | Session 删除 |
| `message.updated` | 消息更新 |
| `message.part.updated` | 消息 Part 更新 |
| `session.status` | Session 状态变更 |
| `session.idle` | Session 变为空闲 |

### 2.5 opencode serve API

`opencode serve` 启动一个 HTTP 服务器，暴露以下关键端点：

**全局事件流**：
- `GET /global/event` — SSE 端点，推送所有全局事件（包含所有 session 的事件）

**Session 管理**：
- `GET /session` — 列出所有 session
- `GET /session/status` — 获取所有 session 的状态映射
- `GET /session/:sessionID` — 获取特定 session
- `GET /session/:sessionID/message` — 获取 session 的消息列表

**V2 API**：
- `GET /api/session` — V2 session 列表（带分页）
- `GET /api/session/:sessionID/message` — V2 消息列表（带分页）
- `GET /api/event` — V2 事件流（原生 EventV2 载荷）

**认证**：
- 请求头 `x-opencode-directory` 指定项目目录
- 如果设置了 `OPENCODE_SERVER_PASSWORD`，需要 Authorization 头

### 2.6 TUI 实时更新机制

TUI 通过以下方式实现实时更新：

1. **SDK 客户端**连接到 `/global/event` SSE 端点
2. 事件通过 `GlobalBus` → SSE → SDK 客户端 → SolidJS 响应式系统
3. 事件批处理：16ms 内的事件合并为一次渲染
4. 关键事件驱动 UI 更新：
   - `session.next.text.delta` → 实时追加文本
   - `message.part.updated` → 更新 Part 状态
   - `session.status` → 更新 session 运行状态

## 3. Observer 架构设计

### 3.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                      Browser (React)                         │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Session List │  │ Message View │  │ Tool/Subagent View │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬───────────┘  │
│         └────────────────┼───────────────────┘              │
│                          │ WebSocket                         │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│                   Observer Server                            │
│  ┌───────────────────────┼───────────────────────────────┐  │
│  │              WebSocket Hub                             │  │
│  │   (管理客户端连接, 广播事件)                            │  │
│  └───────────────────────┼───────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────┼───────────────────────────────┐  │
│  │            Event Processor                             │  │
│  │  (解析事件, 维护 session 状态, 聚合消息)                │  │
│  └───────────────────────┼───────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────┼───────────────────────────────┐  │
│  │           SSE Client (连接 opencode serve)             │  │
│  └───────────────────────┼───────────────────────────────┘  │
│                          │ SSE (/global/event)               │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│                  opencode serve                              │
│              (HTTP Server + SSE)                             │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 技术选型

| 组件 | 技术 | 理由 |
|---|---|---|
| 后端运行时 | Node.js + TypeScript | 与 opencode 生态一致，可复用 SDK 类型 |
| 后端框架 | Express + ws | 轻量、成熟、WebSocket 支持好 |
| 前端框架 | React 18 + TypeScript | 生态成熟，组件丰富 |
| 前端构建 | Vite | 快速开发体验 |
| 样式 | Tailwind CSS | 快速开发，与 TUI 风格接近 |
| 代码高亮 | Prism.js / highlight.js | 工具输出代码高亮 |
| Markdown 渲染 | react-markdown | LLM 输出 Markdown 渲染 |

### 3.3 后端设计

#### 3.3.1 SSE Client

连接 opencode serve 的 `/global/event` SSE 端点，接收所有实时事件：

```typescript
class OpenCodeSSEClient {
  // 连接管理
  connect(url: string, headers?: Record<string, string>): void
  disconnect(): void
  // 自动重连（指数退避）
  // 事件分发
  onEvent(handler: (event: GlobalEvent) => void): () => void
}
```

关键事件处理：

| 事件 | 处理 |
|---|---|
| `session.created/updated/deleted` | 更新 session 列表缓存 |
| `session.status` | 更新 session 运行状态 |
| `message.updated` | 更新消息缓存 |
| `message.part.updated` | 更新 Part 状态（含实时文本流） |
| `session.next.text.delta` | 实时文本增量（流式输出） |
| `session.next.tool.*` | 工具调用状态更新 |
| `session.next.reasoning.delta` | 推理增量流 |
| `session.next.step.started/ended` | 步骤生命周期 |

#### 3.3.2 Session State Manager

维护 session 的内存状态，提供查询接口：

```typescript
class SessionStateManager {
  // Session 列表
  getSessions(): SessionInfo[]
  getSession(id: string): SessionInfo | undefined
  getSessionStatus(id: string): SessionStatus

  // 消息
  getMessages(sessionID: string): Message[]
  getMessage(sessionID: string, messageID: string): Message | undefined

  // 实时流
  getActiveStream(sessionID: string): ActiveStream | undefined
}
```

#### 3.3.3 WebSocket Hub

管理浏览器客户端连接，推送实时事件：

```typescript
class WebSocketHub {
  // 客户端管理
  addClient(ws: WebSocket): void
  removeClient(ws: WebSocket): void

  // 订阅管理（客户端可订阅特定 session）
  subscribe(ws: WebSocket, sessionID: string): void
  unsubscribe(ws: WebSocket, sessionID: string): void

  // 事件广播
  broadcast(event: ObserverEvent): void
  broadcastToSession(sessionID: string, event: ObserverEvent): void
}
```

#### 3.3.4 REST API

提供初始数据加载的 REST 端点：

| 端点 | 说明 |
|---|---|
| `GET /api/sessions` | 获取所有 session 列表（含状态） |
| `GET /api/sessions/:id` | 获取特定 session 详情 |
| `GET /api/sessions/:id/messages` | 获取 session 消息历史 |
| `GET /api/status` | Observer 服务状态 |

#### 3.3.5 WebSocket 消息协议

**客户端 → 服务端**：

```typescript
type ClientMessage =
  | { type: "subscribe"; sessionID: string }    // 订阅 session 实时事件
  | { type: "unsubscribe"; sessionID: string }  // 取消订阅
  | { type: "ping" }                            // 心跳
```

**服务端 → 客户端**：

```typescript
type ServerMessage =
  | { type: "session.list"; sessions: SessionInfo[] }           // Session 列表更新
  | { type: "session.status"; sessionID: string; status: SessionStatus }  // 状态变更
  | { type: "session.messages"; sessionID: string; messages: Message[] }  // 消息列表
  | { type: "message.updated"; sessionID: string; message: Message }      // 消息更新
  | { type: "part.updated"; sessionID: string; part: Part }               // Part 更新
  | { type: "text.delta"; sessionID: string; messageID: string; partID: string; delta: string }  // 文本流
  | { type: "reasoning.delta"; sessionID: string; messageID: string; partID: string; delta: string }  // 推理流
  | { type: "tool.progress"; sessionID: string; part: ToolPart }          // 工具进度
  | { type: "step.started"; sessionID: string; data: StepStartedData }    // 步骤开始
  | { type: "step.ended"; sessionID: string; data: StepEndedData }        // 步骤结束
  | { type: "pong" }                                                       // 心跳响应
  | { type: "connected" }                                                  // 连接确认
  | { type: "error"; message: string }                                     // 错误
```

### 3.4 前端设计

#### 3.4.1 页面布局

```
┌─────────────────────────────────────────────────────────┐
│  OpenCode Observer                          [连接状态]   │
├──────────────┬──────────────────────────────────────────┤
│              │  Session: xxx                            │
│  Sessions    │  Agent: code | Model: claude-4-sonnet    │
│              │  Status: ● busy                          │
│  ● ses_abc   │──────────────────────────────────────────│
│  ○ ses_def   │                                          │
│  ○ ses_ghi   │  [User]                                  │
│  ○ ses_jkl   │  请帮我实现一个功能...                     │
│              │                                          │
│              │  [Assistant]                              │
│              │  我来帮你实现这个功能。首先...               │
│              │                                          │
│              │  🔧 Read(file.ts) ✓                      │
│              │  ┌──────────────────────────────┐        │
│              │  │ // file content...            │        │
│              │  └──────────────────────────────┘        │
│              │                                          │
│              │  🔧 Write(file.ts) ⏳                    │
│              │  Writing changes...                      │
│              │                                          │
│              │  🤖 SubAgent: search                     │
│              │  └─ Searching codebase...                │
│              │                                          │
│              │  💭 Reasoning...                          │
│              │  Let me think about this...              │
│              │                                          │
│              │  Continuing response...▌                 │
│              │                                          │
├──────────────┴──────────────────────────────────────────┤
│  Cost: $0.05 | Tokens: 1.2k in / 800 out               │
└─────────────────────────────────────────────────────────┘
```

#### 3.4.2 组件结构

```
App
├── Header                     # 顶部栏（标题、连接状态）
├── Sidebar                    # 左侧 Session 列表
│   ├── SessionList            # Session 列表
│   │   └── SessionItem        # 单个 Session 项（含状态指示器）
│   └── SessionFilter          # 过滤/搜索
└── MainContent                # 主内容区
    ├── SessionHeader           # Session 标题、Agent、Model、状态
    ├── MessageList             # 消息列表
    │   ├── UserMessage         # 用户消息
    │   ├── AssistantMessage    # 助手消息
    │   │   ├── TextContent     # 文本内容（Markdown 渲染）
    │   │   ├── ReasoningBlock  # 推理/思考块
    │   │   ├── ToolCallBlock   # 工具调用块
    │   │   │   ├── ToolHeader  # 工具名称、状态
    │   │   │   ├── ToolInput   # 工具输入参数
    │   │   │   └── ToolOutput  # 工具输出结果
    │   │   └── SubAgentBlock   # 子代理调用块
    │   └── SystemMessage       # 系统消息
    └── StatusBar               # 底部状态栏（Cost、Tokens）
```

#### 3.4.3 实时流式渲染

关键实时渲染逻辑：

1. **LLM 文本流**：收到 `text.delta` 事件时，追加到当前文本 Part，显示闪烁光标
2. **Reasoning 流**：收到 `reasoning.delta` 事件时，追加到推理块，可折叠显示
3. **Tool 调用流**：
   - `tool.called` → 显示工具名称和输入参数
   - `tool.progress` → 更新进度指示器
   - `tool.success` → 显示输出结果，标记成功
   - `tool.failed` → 显示错误信息，标记失败
4. **SubAgent 调用**：通过 `SubtaskPart` 显示子代理信息，嵌套展示
5. **Step 生命周期**：`step.started` → 显示开始指示器，`step.ended` → 显示统计信息

### 3.5 数据流

```
opencode serve                    Observer Server                  Browser
    │                                  │                              │
    │  SSE: session.next.text.delta    │                              │
    │─────────────────────────────────>│                              │
    │                                  │  WS: text.delta              │
    │                                  │─────────────────────────────>│
    │                                  │                              │ 追加文本+光标
    │                                  │                              │
    │  SSE: message.part.updated       │                              │
    │─────────────────────────────────>│                              │
    │                                  │  WS: part.updated            │
    │                                  │─────────────────────────────>│
    │                                  │                              │ 更新 Part 状态
    │                                  │                              │
    │  SSE: session.next.tool.called   │                              │
    │─────────────────────────────────>│                              │
    │                                  │  WS: tool.progress           │
    │                                  │─────────────────────────────>│
    │                                  │                              │ 显示工具调用
    │                                  │                              │
    │  SSE: session.next.tool.success  │                              │
    │─────────────────────────────────>│                              │
    │                                  │  WS: tool.progress           │
    │                                  │─────────────────────────────>│
    │                                  │                              │ 更新为成功状态
```

## 4. 项目结构

```
observer/
├── docs/
│   └── design.md              # 本设计文档
├── package.json
├── tsconfig.json
├── vite.config.ts              # 前端构建配置
├── src/
│   ├── server/                 # 后端
│   │   ├── index.ts            # 服务入口
│   │   ├── config.ts           # 配置管理
│   │   ├── sse-client.ts       # SSE 客户端（连接 opencode serve）
│   │   ├── state-manager.ts    # Session 状态管理
│   │   ├── ws-hub.ts           # WebSocket Hub
│   │   ├── rest-api.ts         # REST API 路由
│   │   └── types.ts            # 共享类型定义
│   ├── client/                 # 前端
│   │   ├── index.html          # HTML 入口
│   │   ├── main.tsx            # React 入口
│   │   ├── App.tsx             # 根组件
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts # WebSocket 连接 Hook
│   │   │   └── useSession.ts   # Session 数据 Hook
│   │   ├── components/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── SessionList.tsx
│   │   │   ├── SessionItem.tsx
│   │   │   ├── SessionView.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── UserMessage.tsx
│   │   │   ├── AssistantMessage.tsx
│   │   │   ├── TextContent.tsx
│   │   │   ├── ReasoningBlock.tsx
│   │   │   ├── ToolCallBlock.tsx
│   │   │   ├── SubAgentBlock.tsx
│   │   │   └── StatusBar.tsx
│   │   └── styles/
│   │       └── index.css       # Tailwind CSS
│   └── shared/
│       └── types.ts            # 前后端共享类型
└── scripts/
    └── dev.ts                  # 开发启动脚本
```

## 5. 配置

Observer 通过环境变量或命令行参数配置：

| 配置项 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| Observer 端口 | `OBSERVER_PORT` | `3210` | Observer Web 服务端口 |
| OpenCode URL | `OPENCODE_URL` | `http://localhost:4096` | opencode serve 地址 |
| OpenCode 目录 | `OPENCODE_DIRECTORY` | - | x-opencode-directory 头 |
| OpenCode 密码 | `OPENCODE_PASSWORD` | - | 认证密码 |
| 心跳间隔 | `HEARTBEAT_INTERVAL` | `30000` | WebSocket 心跳间隔(ms) |

## 6. 启动流程

1. Observer Server 启动 HTTP + WebSocket 服务
2. SSE Client 连接到 opencode serve 的 `/global/event`
3. 收到 `server.connected` 事件后，拉取初始 session 列表和状态
4. 浏览器连接 Observer WebSocket
5. Observer 推送 session 列表给浏览器
6. 浏览器订阅特定 session，Observer 推送该 session 的实时事件

## 7. 错误处理

- SSE 连接断开：自动重连（指数退避，最大 30s）
- WebSocket 客户端断开：清理订阅，不丢失 SSE 事件
- opencode serve 不可用：显示断开状态，持续重试
- 事件解析错误：跳过无效事件，记录日志

## 8. 性能考虑

- SSE 事件在服务端聚合后推送，避免每个 delta 都触发 WebSocket 消息
- Session 消息历史通过 REST API 按需加载，不全量推送
- WebSocket 消息使用二进制帧（JSON）减少开销
- 前端使用虚拟列表渲染大量消息
- 文本 delta 合并：16ms 内的 delta 合并为一次渲染
