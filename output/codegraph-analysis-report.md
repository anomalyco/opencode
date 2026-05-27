# OpenCode 仓库 CodeGraph 全面分析报告

> 基于 CodeGraph 索引：1,752 文件 | 23,787 节点 | 51,308 边 | 43.44 MB

---

## 1. 项目概览

**OpenCode** 是一个开源的 AI 编程助手平台，提供 CLI、桌面应用和 Web 三种交互界面。它支持多种 LLM 提供商（Anthropic、OpenAI、Google、Copilot 等），内置工具系统（文件读写、Shell、搜索等），并通过插件架构支持扩展。

### 技术栈
- **语言**: TypeScript (96.5%) + TSX (22.4%) + 少量 Python/YAML
- **运行时**: Bun（主要）+ Node.js
- **构建**: Turbo (monorepo) + SST (基础设施)
- **数据库**: SQLite (Drizzle ORM)
- **前端**: SolidJS (app) + Ink (TUI)
- **效果系统**: Effect-TS

### 代码规模统计

| 节点类型 | 数量 |
|---------|------|
| 函数 (function) | 4,483 |
| 常量 (constant) | 3,530 |
| 导入 (import) | 9,871 |
| 类型别名 (type_alias) | 2,530 |
| 接口 (interface) | 475 |
| 类 (class) | 281 |
| 方法 (method) | 693 |
| 变量 (variable) | 148 |
| 路由 (route) | 17 |

---

## 2. Monorepo 架构

```
opencode/
├── packages/
│   ├── opencode/          ★ 核心 CLI 引擎 (835 文件, 515 src)
│   ├── app/               ★ 桌面/Web 前端 (242 文件)
│   ├── console/           ★ 管理控制台 + Zen API 代理 (202 文件)
│   ├── core/              基础工具库 (42 文件)
│   ├── sdk/js/            JavaScript SDK
│   ├── plugin/            插件系统 API
│   ├── ui/                共享 UI 组件库
│   ├── desktop/           Electron 桌面应用
│   ├── enterprise/        企业版功能
│   ├── function/          云函数
│   ├── slack/             Slack 集成
│   ├── storybook/         UI 组件文档
│   ├── containers/        容器化部署
│   ├── opencode-patent-plugin/       专利插件
│   ├── professional-router-plugin/   专业路由插件
│   ├── script/            构建脚本
│   └── web/               Web 版本
├── infra/                 SST 基础设施定义
├── sdks/vscode/           VS Code 扩展
├── github/                GitHub Action
├── script/                顶层脚本
└── runtime/               Python 运行时辅助
```

---

## 3. 核心包深度分析：`packages/opencode`

这是整个项目的核心，包含 AI 编程助手的全部业务逻辑。

### 3.1 模块结构 (30+ 模块)

| 模块 | 文件数 | 职责 |
|------|--------|------|
| `cli/` | ~80 | CLI 命令 + TUI (终端界面) |
| `cli/cmd/tui/` | ~70 | Ink-based 终端 UI（最大子模块） |
| `server/` | 97 | HTTP/WebSocket 服务器 + API 路由 |
| `session/` | 20 | 会话管理、消息处理、LLM 循环 |
| `tool/` | 25 | 工具系统（bash/read/write/edit/glob/grep 等） |
| `provider/` | 30 | LLM 提供商适配器 |
| `config/` | 20 | 配置管理（agent/mcp/keybinds/permissions） |
| `acp/` | 3 | Agent Communication Protocol |
| `plugin/` | - | 插件加载器 |
| `computer-use/` | 10 | 计算机使用（桌面自动化） |
| `bus/` | 3 | 事件总线 |
| `account/` | 5 | 账户管理 |
| `auth/` | 1 | 认证 |
| `lsp/` | - | LSP 客户端 |
| `v2/` | - | V2 版本消息格式 |

### 3.2 核心架构流程

```
用户输入 (CLI/Web/Desktop)
    ↓
CLI Bootstrap → Server (HTTP/WS)
    ↓
Session Manager → Prompt Builder → LLM Provider Adapter
    ↓                                        ↓
Tool Registry ← Tool Execution ← AI Response
    ↓
File System / Shell / MCP / Search
```

### 3.3 Session/LLM 处理管线

**关键文件**: `session/processor.ts`, `session/llm.ts`, `session/prompt.ts`

- **ProcessorContext**: 维护工具调用状态、流式文本、reasoning 映射
- **Loop**: 持续循环处理 LLM 响应，执行工具调用，直到完成
- **Compaction**: 会话压缩机制（处理长上下文）
- **Prompt**: 系统提示词构建（86 个符号，最复杂的模块之一）

### 3.4 工具系统

**核心接口**: `tool/tool.ts` - `Def<Parameters>` 定义工具签名，`ExecuteResult` 返回结果

| 工具 | 文件 | 功能 |
|------|------|------|
| bash/shell | `shell.ts` | Shell 命令执行 (54 symbols) |
| read | `read.ts` | 文件读取 |
| write | `write.ts` | 文件写入 |
| edit | `edit.ts` | 文件编辑 |
| glob | `glob.ts` | 文件模式匹配 |
| grep | `grep.ts` | 内容搜索 |
| webfetch | `webfetch.ts` | URL 内容获取 |
| websearch | `websearch.ts` | Web 搜索 |
| task | `task.ts` | 子代理任务 |
| question | `question.ts` | 用户交互提问 |
| plan | `plan.ts` | 计划工具 |
| todo | `todo.ts` | TODO 管理 |
| lsp | `lsp.ts` | LSP 集成 |
| skill | `skill.ts` | 技能加载 |
| mcp-exa | `mcp-exa.ts` | Exa MCP 工具 |

**registry.ts** (58 symbols) 是工具注册中心，统一管理所有工具。

### 3.5 Provider 适配器系统

**核心文件**: `provider/provider.ts` (74 symbols)

支持的 LLM 提供商：
- **Anthropic** (Claude 系列)
- **OpenAI** (GPT 系列)
- **Google** (Gemini 系列)
- **GitHub Copilot** — 完整的自定义 SDK (`provider/sdk/copilot/`)
- **AWS Bedrock**
- **Azure**
- **自定义兼容提供商**

Copilot SDK 包含：
- OpenAI-compatible chat 消息转换
- OpenAI Responses API 支持
- 多种内置工具（code-interpreter, file-search, web-search, image-generation, local-shell）

### 3.6 Server 架构

**97 个文件**，采用分层路由架构：

```
server/
├── server.ts              主服务器 (50 symbols)
├── adapter.ts/adapter.bun.ts/adapter.node.ts   运行时适配器
├── auth.ts, cors.ts       中间件
├── middleware.ts          (24 symbols) 请求中间件
├── routes/
│   ├── global.ts          全局路由
│   ├── control/           控制路由
│   ├── instance/          实例路由
│   │   ├── httpapi/       HTTP API (最大子目录)
│   │   │   ├── server.ts  API 服务器 (91 symbols)
│   │   │   ├── handlers/  处理器 (session, config, file, provider...)
│   │   │   ├── groups/    路由分组
│   │   │   └── middleware/ 中间件 (auth, error, workspace)
│   │   ├── session.ts     会话管理 (34 symbols)
│   │   ├── mcp.ts         MCP 路由
│   │   ├── provider.ts    Provider 管理
│   │   └── ...            (file, project, pty, question, sync, trace, tui)
│   └── ui.ts              UI 路由
└── shared/                共享工具
```

API 命名空间包括：session, config, file, provider, instance, mcp, permission, pty, question, workspace, experimental, tui, lsp, command, event, auth, app, path, vcs, find, formatter, tool, worktree

### 3.7 TUI (终端 UI)

基于 Ink (React for CLI) 构建，约 70 个文件：

- **routes/**: home, session（含对话/权限/子代理面板）
- **component/**: 对话框（模型选择、Provider、MCP、技能、会话列表等）
- **context/**: React 上下文（SDK、路由、主题、键绑定等）
- **plugin/**: 插件运行时（加载、API、插槽系统）
- **feature-plugins/**: 功能插件（侧边栏、系统面板）
- **config/**: TUI 配置与迁移

### 3.8 插件系统

**关键文件**: `plugin/loader.ts`, `plugin/index.ts`

- `load()`: 异步加载插件，解析输入
- `applyPlugin()`: 应用插件到系统
- **TUI 插件**: `packages/plugin/src/tui.ts` 提供 `TuiPluginModule` 接口
- **插件运行时**: TUI 内的 `plugin/runtime.ts` (75 symbols)

### 3.9 Computer Use

`computer-use/` 模块（10 文件）提供桌面自动化能力：
- Python 桥接 (`python-bridge.ts`)
- 权限管理 (`permissions.ts`, `grants-store.ts`)
- 应用层级控制 (`app-tiers.ts`)
- 屏幕截图和键盘/鼠标操作

---

## 4. 前端：`packages/app`

**242 文件**，基于 SolidJS 的桌面/Web 应用。

### 架构

```
app/src/
├── app.tsx                应用入口 (53 symbols)
├── entry.tsx              渲染入口 (30 symbols)
├── components/            UI 组件
│   ├── prompt-input/      富文本输入框（核心组件，~15 文件）
│   ├── session/           会话相关组件
│   ├── dialog-*.tsx       各种对话框
│   ├── file-tree.tsx      文件树
│   ├── terminal.tsx       终端组件
│   └── titlebar.tsx       标题栏
├── context/               SolidJS 上下文
│   ├── global-sync/       ★ 核心：客户端-服务器同步 (13+ 文件)
│   ├── command.tsx        命令系统 (33 symbols)
│   ├── file.tsx           文件管理
│   ├── layout.tsx         布局管理
│   ├── permission.tsx     权限管理
│   ├── sdk.tsx            SDK 客户端
│   └── ...                (terminal, server, settings, notification...)
├── pages/
│   ├── session.tsx        会话页面 (57 symbols)
│   ├── session/composer/  消息编辑器
│   ├── home.tsx           首页
│   └── layout.tsx         布局 (53 symbols)
├── i18n/                  国际化 (17 语言)
└── utils/                 工具函数
```

### 客户端同步系统 (`global-sync/`)

这是前端最复杂的子系统：
- **bootstrap.ts**: 初始化流程（加载配置、Provider、Agent、路径）
- **child-store.ts**: 子存储管理
- **event-reducer.ts**: SSE 事件归约
- **session-cache/prefetch/trim**: 会话缓存优化
- **eviction.ts**: 数据淘汰策略
- **queue.ts**: 操作队列

---

## 5. 管理控制台：`packages/console`

**202 文件**，SolidStart 全栈应用。

### 架构

```
console/
├── app/                   Web 前端
│   └── src/routes/
│       ├── zen/           ★ Zen API 代理服务
│       │   ├── v1/        OpenAI-compatible API
│       │   ├── go/        Go 版本 API
│       │   └── util/      Provider 适配器、限流
│       ├── workspace/     工作区管理
│       ├── black/         Black 订阅计划
│       ├── bench/         Benchmark
│       └── auth/          认证
├── core/                  后端核心
│   ├── src/               业务逻辑 (billing, subscription, workspace...)
│   ├── script/            管理脚本 (20+ 脚本)
│   └── schema/            数据库 Schema (Drizzle)
├── function/              云函数 (auth, log-processor)
├── mail/                  邮件模板
└── resource/              SST 资源定义
```

### Zen API 代理

提供 OpenAI 兼容的 API 代理，支持：
- `/v1/chat/completions` - Chat API
- `/v1/messages` - Messages API
- `/v1/models` - Models API
- `/v1/responses` - Responses API
- 多 Provider 路由（Anthropic, Google, OpenAI, OpenAI-compatible）
- IP/Key 限流、TPM 限制、试用限制

---

## 6. 基础工具库：`packages/core`

**29 文件**，提供跨包共享的基础设施：

| 模块 | 功能 |
|------|------|
| `util/flock.ts` | 文件锁 (30 symbols) |
| `util/effect-flock.ts` | Effect-TS 文件锁 |
| `util/log.ts` | 日志系统 (25 symbols) |
| `util/identifier.ts` | ID 生成 |
| `util/glob.ts` | Glob 模式 |
| `util/hash.ts` | 哈希工具 |
| `util/retry.ts` | 重试逻辑 |
| `effect/runtime.ts` | Effect Runtime |
| `effect/observability.ts` | 可观测性 |
| `npm.ts` | NPM 包管理 |
| `filesystem.ts` | 文件系统抽象 |

---

## 7. SDK 系统

### `packages/sdk/js/` — JavaScript SDK

自动生成的类型安全 HTTP 客户端：

**OpencodeClient** 类暴露所有 API 命名空间：
- `auth`, `app`, `global`, `event`, `config`, `experimental`
- `tool`, `worktree`, `find`, `file`, `instance`, `path`
- `vcs`, `command`, `lsp`, `session`, `provider`, `pty`
- `mcp`, `formatter`, `tui`

---

## 8. 基础设施

### SST (Serverless Stack)

```
infra/
├── app.ts         应用定义
├── console.ts     控制台 (43 symbols)
├── enterprise.ts  企业版
├── monitoring.ts  监控
├── secret.ts      密钥管理
└── stage.ts       阶段管理
```

部署到 AWS，使用 SST v3 构建无服务器架构。

---

## 9. 依赖关系图

### 包依赖关系（简化）

```
                    ┌─────────────┐
                    │  opencode   │ ★ 核心
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          ↓                ↓                ↓
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │   core   │    │  plugin  │    │   sdk    │
    └──────────┘    └──────────┘    └──────────┘
          ↑                ↑                ↑
          │                │                │
    ┌─────┴──────┐  ┌─────┴──────┐  ┌─────┴──────┐
    │    app     │  │   desktop  │  │  console   │
    └────────────┘  └────────────┘  └────────────┘
```

### 核心数据流

```
┌─────────┐     HTTP/WS     ┌──────────────┐    Effect    ┌─────────────┐
│  Client  │ ─────────────→ │    Server     │ ──────────→ │   Session    │
│(TUI/App) │ ←───────────── │  (routes/)   │ ←────────── │ (processor)  │
└─────────┘    SSE Events   └──────────────┘   Stream     └──────┬──────┘
                                                                     │
                                              ┌──────────────────────┤
                                              ↓                      ↓
                                      ┌──────────────┐    ┌──────────────┐
                                      │   Provider   │    │    Tool      │
                                      │ (adapter)    │    │  (registry)  │
                                      └──────┬───────┘    └──────┬───────┘
                                             │                   │
                                             ↓                   ↓
                                      ┌──────────────┐    ┌──────────────┐
                                      │ LLM APIs     │    │ FS/Shell/MCP │
                                      │ (Anthropic/  │    │ /Web/LSP     │
                                      │  OpenAI/...)  │    │              │
                                      └──────────────┘    └──────────────┘
```

---

## 10. 关键架构特征

### 10.1 Effect-TS 深度集成
- 核心 session/tool/provider 逻辑使用 Effect-TS 管理副作用
- 自定义 Runtime (`core/effect/runtime.ts`)
- Effect-aware 文件锁 (`effect-flock.ts`)

### 10.2 双运行时支持
- `adapter.bun.ts` / `adapter.node.ts` — 同时支持 Bun 和 Node.js
- 运行时检测并选择最优路径

### 10.3 插件架构
- 插件加载器 (`plugin/loader.ts`) 支持异步加载
- TUI 插件插槽系统 (`tui/plugin/slots.tsx`)
- 插件 API (`packages/plugin/src/tui.ts` 定义 `TuiPluginModule`)

### 10.4 实时同步
- SSE (Server-Sent Events) 推送
- 客户端事件归约器 (`event-reducer.ts`)
- 乐观更新 (`sync-optimistic`)
- 会话缓存与预取

### 10.5 多语言支持
- 前端 17 种语言 (i18n/)
- 管理控制台 17 种语言

### 10.6 安全模型
- 权限系统 (`config/permission.ts`)
- 工具执行许可 (`tool/tool.ts` 的 `Permissioner` 接口)
- Auth 中间件 (`server/auth.ts`, `server/routes/instance/httpapi/middleware/authorization.ts`)
- Computer-use 键盘黑名单 (`key-blocklist.ts`)

---

## 11. 复杂度热点

| 文件 | 符号数 | 说明 |
|------|--------|------|
| `session/prompt.ts` | 86 | 提示词构建（最复杂） |
| `session/session.ts` | 102 | 会话管理核心 |
| `provider/provider.ts` | 74 | Provider 集成 |
| `cli/cmd/tui/routes/session/index.tsx` | 106 | TUI 会话页 |
| `server/routes/instance/httpapi/server.ts` | 91 | HTTP API 服务器 |
| `cli/cmd/tui/context/theme.tsx` | 77 | TUI 主题系统 |
| `acp/agent.ts` | 81 | ACP Agent |
| `cli/cmd/tui/plugin/runtime.ts` | 75 | 插件运行时 |
| `tool/shell.ts` | 54 | Shell 工具 |
| `config/config.ts` | 66 | 配置管理 |

---

## 12. 总结

OpenCode 是一个**架构成熟的 AI 编程助手平台**，具有以下特点：

1. **Monorepo 架构**清晰，16 个包各司其职
2. **核心引擎** (`packages/opencode`) 是一个完整的 CLI + Server，包含 AI 循环、工具系统、Provider 适配
3. **多端统一**：TUI (Ink) + Desktop (Electron) + Web (SolidJS) 共享同一后端
4. **Effect-TS** 用于管理复杂的副作用链（LLM 流式响应、工具执行）
5. **插件系统**支持 TUI 和功能扩展
6. **Zen API 代理**提供 OpenAI 兼容的统一 LLM 接口
7. **SST 无服务器**部署到 AWS

**总代码量**: ~24,000 符号节点，~51,000 依赖边，是一个中大型 TypeScript 项目。
