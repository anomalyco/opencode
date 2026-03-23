# OpenCode App - Frontend Application

## 功能概述

OpenCode App 是 OpenCode 的 Web 前端应用，提供 AI 编程助手的完整用户界面：

- **项目管理**：多项目支持、Git worktree 多工作区
- **会话系统**：与 AI 的对话会话、消息历史、代码 diff 审查
- **终端集成**：内置终端（xterm.js），支持命令执行
- **文件浏览**：文件树、代码查看、选中上下文
- **模型管理**：多 AI 提供商支持、模型选择
- **设置系统**：主题、快捷键、通知、语言设置

## 技术栈

| 类别     | 技术                          |
| -------- | ----------------------------- |
| 框架     | SolidJS（细粒度响应式 UI）    |
| 路由     | @solidjs/router               |
| 状态管理 | solid-js/store（createStore） |
| 数据获取 | @tanstack/solid-query         |
| UI 组件  | @opencode-ai/ui（共享组件库） |
| 样式     | Tailwind CSS 4                |
| 终端     | xterm.js + ghostty-web        |
| Markdown | marked + shiki                |
| 国际化   | @solid-primitives/i18n        |
| 构建工具 | Vite 7                        |
| 测试     | Bun test + Playwright E2E     |

## 目录结构

```
src/
├── app.tsx              # 应用入口，路由和 Provider 层级
├── entry.tsx            # 渲染入口，平台适配
├── index.css            # 全局样式
├── context/             # 全局状态 Context
│   ├── global-sync.tsx  # 全局数据同步（项目、provider）
│   ├── global-sdk.tsx   # 全局 SDK 客户端
│   ├── sync.tsx         # 目录级数据同步（消息、diffs）
│   ├── sdk.tsx          # 目录级 SDK 客户端
│   ├── settings.tsx     # 用户设置
│   ├── models.tsx       # AI 模型管理
│   ├── terminal.tsx     # 终端会话管理
│   ├── file.tsx         # 文件系统操作
│   ├── prompt.tsx       # 提示词输入和上下文
│   ├── permission.tsx   # 权限请求处理
│   ├── notification.tsx # 通知管理
│   ├── layout.tsx       # 布局状态
│   └── language.tsx     # 国际化
├── pages/
│   ├── home.tsx         # 首页（最近项目）
│   ├── session.tsx      # 会话页面主组件
│   ├── layout.tsx       # 主布局（侧边栏导航）
│   ├── directory-layout.tsx  # 目录级布局
│   └── session/         # 会话页面子组件
│       ├── message-timeline.tsx    # 消息时间线
│       ├── terminal-panel.tsx      # 终端面板
│       ├── session-side-panel.tsx  # 侧边面板
│       ├── review-tab.tsx          # Diff 审查
│       └── composer/               # 输入区域组件
├── components/          # 可复用 UI 组件
│   ├── prompt-input.tsx # 提示词输入
│   ├── file-tree.tsx    # 文件树
│   ├── terminal.tsx     # 终端组件
│   ├── dialog-*.tsx     # 对话框组件
│   ├── settings-*.tsx   # 设置组件
│   └── session/         # 会话相关组件
├── utils/               # 工具函数
│   ├── server.ts        # 服务器连接
│   ├── persist.ts       # 本地存储
│   └── sound.ts         # 音效播放
└── i18n/                # 国际化翻译
    ├── en.ts
    └── zh.ts
```

## 架构设计

### Provider 层级

```
PlatformProvider                    # 平台 API（通知、链接打开）
└── ThemeProvider                   # 主题（深色/浅色）
    └── LanguageProvider            # 国际化
        └── QueryClientProvider     # React Query
            └── ServerProvider      # 服务器连接
                └── GlobalSDKProvider   # 全局 SDK
                    └── GlobalSyncProvider  # 全局数据同步
                        └── SettingsProvider  # 用户设置
                            └── PermissionProvider  # 权限处理
                                └── LayoutProvider  # 布局状态
                                    └── ModelsProvider  # 模型管理
                                        └── SDKProvider  # 目录级 SDK
                                            └── SyncProvider  # 目录级同步
                                                └── TerminalProvider
                                                    └── FileProvider
                                                        └── PromptProvider
```

### 数据流

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Backend    │────▶│    SDK       │────▶│   Sync       │
│  (HTTP/WS)   │     │  (API 调用)  │     │  (Store)     │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
                                                 ▼
                                         ┌──────────────┐
                                         │   Context    │
                                         │  (响应式状态) │
                                         └──────────────┘
                                                 │
                                                 ▼
                                         ┌──────────────┐
                                         │  Components  │
                                         │    (UI)      │
                                         └──────────────┘
```

### 关键业务逻辑

#### 1. 会话消息同步（sync.tsx）

- 使用 `createStore` 管理消息、parts、diffs
- 支持乐观更新（用户消息即时显示）
- 历史消息懒加载和分页
- WebSocket 实时更新

#### 2. 权限和问题处理

- 工具权限请求（文件写入、Shell 执行）
- 支持自动响应规则
- 集成系统通知

#### 3. 文件操作（file.tsx）

- 文件读取和缓存
- 文件树懒加载
- 选中行范围上下文

#### 4. Worktree 多工作区

- Git worktree 多工作区支持
- 每个 worktree 独立会话
- 工作区创建、切换、删除

## 调试

- **NEVER** restart the app or server process during debugging

## 本地开发

`opencode dev web` 代理 `https://app.opencode.ai`，本地 UI 修改不会显示。需要分开运行：

```bash
# Terminal 1 - 后端（在 packages/opencode）
bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 2 - App（在 packages/app）
bun dev -- --port 4444

# 打开 http://localhost:4444（指向 localhost:4096 的后端）
```

## SolidJS 开发规范

- 使用 `createStore` 而非多个 `createSignal`
- 使用 `splitProps` 分离本地 props 和其他 props
- 使用 `createMemo` 处理派生状态
- 使用 `createSimpleContext` from `@opencode-ai/ui/context` 创建 Context

```tsx
export function Component(props: Props) {
  const [local, rest] = splitProps(props, ["href", "children"])
  return (
    <a href={local.href} {...rest}>
      {local.children}
    </a>
  )
}
```

## 工具调用

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE

## 浏览器自动化

使用 `agent-browser` 进行 Web 自动化：

1. `agent-browser open <url>` - 打开页面
2. `agent-browser snapshot -i` - 获取可交互元素（@e1, @e2）
3. `agent-browser click @e1` / `fill @e2 "text"` - 交互
4. 页面变化后重新 snapshot

### 移动端浏览器模拟

测试移动端布局时，使用 `set viewport` 设置视口尺寸：

```bash
# 竖屏模式：1080(宽) x 1920(高)
agent-browser set viewport 1080 1920

# 横屏模式：1920(宽) x 1080(高)
agent-browser set viewport 1920 1080
```

完整流程示例：

```bash
# 测试竖屏布局
agent-browser open http://localhost:3000 && agent-browser set viewport 1080 1920 && agent-browser snapshot -i

# 切换到横屏布局
agent-browser set viewport 1920 1080 && agent-browser snapshot -i
```

## 后端 API 接口

前端通过 `@opencode-ai/sdk` 调用后端 REST API。SDK 位于 `packages/sdk/js/src/v2/`，使用 OpenAPI 自动生成。

### API 模块分类

| 模块           | 路径前缀                 | 主要功能                   |
| -------------- | ------------------------ | -------------------------- |
| `global`       | `/global/*`              | 全局事件流、健康检查、配置 |
| `auth`         | `/auth/*`                | Provider 认证凭证管理      |
| `project`      | `/project/*`             | 项目列表、Git 初始化       |
| `session`      | `/session/*`             | 会话 CRUD、消息发送、分支  |
| `message/part` | `/session/*/message/*`   | 消息和 Part 管理           |
| `permission`   | `/permission/*`          | 权限请求响应               |
| `question`     | `/question/*`            | 问题请求响应               |
| `provider`     | `/provider/*`            | AI Provider 列表、OAuth    |
| `file`         | `/file/*`                | 文件读写、状态             |
| `find`         | `/find/*`                | 文件/文本/符号搜索         |
| `pty`          | `/pty/*`                 | 终端会话管理               |
| `mcp`          | `/mcp/*`                 | MCP 服务器管理             |
| `worktree`     | `/experimental/worktree` | Git worktree 管理          |

### 核心 API 端点

```typescript
// SDK 客户端创建
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  directory: "/path/to/project"  // 自动添加 x-opencode-directory header
})

// 全局事件订阅（SSE）
client.global.event()           // SSE 流：实时消息、权限、状态更新

// 会话管理
client.session.list()           // 获取会话列表
client.session.create()         // 创建新会话
client.session.get({ sessionID })
client.session.update({ sessionID, title, time })
client.session.delete({ sessionID })
client.session.fork({ sessionID, messageID })
client.session.revert({ sessionID, messageID })
client.session.unrevert({ sessionID })

// 消息操作
client.session.messages({ sessionID, limit, before })  // 分页获取消息
client.session.prompt({ sessionID, parts, model })     // 发送消息（流式响应）
client.session.promptAsync({ ... })                     // 异步发送
client.session.diff({ sessionID, messageID })          // 获取代码变更

// 权限/问题响应
client.permission.list()
client.permission.reply({ requestID, reply, message })
client.question.list()
client.question.reply({ requestID, answers })
client.question.reject({ requestID })

// Provider/模型
client.provider.list()         // 可用 Provider 列表
client.provider.auth()         // 认证方法
client.provider.oauth.authorize({ providerID })
client.provider.oauth.callback({ providerID, code })

// 文件操作
client.file.list({ path })
client.file.read({ path })
client.file.status()

// 搜索
client.find.files({ query, type, limit })
client.find.text({ pattern })
client.find.symbols({ query })

// 终端
client.pty.list()
client.pty.create({ command, args, cwd })
client.pty.remove({ ptyID })
client.pty.connect({ ptyID })  // WebSocket 连接

// Worktree
client.worktree.list()
client.worktree.create({ branch })
client.worktree.remove({ directory })

// 配置
client.config.get()
client.config.update({ config })
client.global.config.get()
```

### 事件类型（SSE）

```typescript
// 通过 client.global.event() 订阅的事件
type Event =
  | { type: "message.part.created"; properties: { part } }
  | { type: "message.part.updated"; properties: { part } }
  | { type: "message.part.delta"; properties: { messageID; partID; delta } }
  | { type: "session.status"; properties: { sessionID; status } }
  | { type: "permission.asked"; properties: { sessionID; permission } }
  | { type: "question.asked"; properties: { sessionID; question } }
  | { type: "worktree.ready"; properties: { directory } }
  | { type: "worktree.failed"; properties: { directory; message } }
```

## 测试

```bash
bun run test:unit          # 单元测试
bun run test:unit:watch    # 单元测试（watch 模式）
bun run test:e2e           # E2E 测试（Playwright）
bun run test:e2e:ui        # E2E 测试带 UI
```
