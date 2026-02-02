# OpenCode Web API Gateway

OpenCode Web API Gateway 是 OpenCode 项目的一部分，提供了一个功能完整的 Web API 服务，作为 OpenCode AI 编程助手的后端服务层。

## 项目概述

OpenCode 是一个开源的 AI 编程代理工具，旨在为开发者提供一个强大、灵活且可扩展的编程助手。opencode-web 包提供了 Web API 网关服务，负责处理用户认证、会话管理、项目管理、任务调度等功能。

## 主要功能

### 用户认证系统
- 用户注册和登录
- JWT 令牌管理（访问令牌和刷新令牌）
- 用户资料管理
- 权限验证中间件

### 项目管理
- 项目的创建、读取和管理
- 用户项目权限控制
- 项目状态跟踪

### 会话管理
- 会话的创建、读取、更新和删除
- 容器生命周期管理（启动、停止）
- 会话历史记录和消息管理
- 实时事件流（SSE）

### 任务调度
- 基于 BullMQ 的异步任务队列
- AI 提示处理
- 自动清理任务

## 技术架构

- **语言**: TypeScript
- **运行时**: Bun
- **Web 框架**: Hono
- **数据库**: PostgreSQL (使用 Drizzle ORM)
- **缓存**: Redis
- **容器管理**: Docker API 集成
- **任务队列**: BullMQ

## API 端点

### 认证相关
- `POST /auth/register` - 用户注册
- `POST /auth/login` - 用户登录
- `POST /auth/refresh` - 刷新令牌
- `POST /auth/logout` - 用户登出
- `GET /auth/me` - 获取当前用户信息

### 项目相关
- `GET /projects` - 获取用户的所有项目
- `POST /projects` - 创建新项目
- `GET /projects/:id` - 获取特定项目
- `PUT /projects/:id` - 更新项目
- `DELETE /projects/:id` - 删除项目

### 会话相关
- `GET /sessions` - 获取用户的所有会话
- `POST /sessions` - 创建新会话
- `GET /sessions/:id` - 获取特定会话
- `DELETE /sessions/:id` - 删除（归档）会话
- `POST /sessions/:id/start` - 启动会话容器
- `POST /sessions/:id/stop` - 停止会话容器
- `POST /sessions/:id/prompt` - 发送提示到会话
- `GET /sessions/:id/events` - 会话事件流（SSE）
- `GET /sessions/:id/messages` - 获取会话消息

### 任务相关
- `GET /tasks` - 获取用户任务列表
- `GET /tasks/:id` - 获取特定任务
- `PUT /tasks/:id` - 更新任务

### 健康检查
- `GET /health` - 服务健康检查端点

## 环境配置

项目使用 Zod 进行环境变量验证，支持以下配置：

```typescript
const envSchema = z.object({
  // 服务器配置
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),

  // 数据库配置
  DATABASE_URL: z.string().default("postgres://opencode:opencode@localhost:5432/opencode"),

  // Redis 配置
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // JWT 配置
  JWT_SECRET: z.string().min(32).default("development-secret-key-change-in-production"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

  // Docker 配置
  DOCKER_SOCKET: z.string().default("/var/run/docker.sock"),
  SANDBOX_IMAGE: z.string().default("opencode-sandbox:latest"),
  SANDBOX_MEMORY_LIMIT: z.coerce.number().default(2 * 1024 * 1024 * 1024), // 2GB
  SANDBOX_CPU_LIMIT: z.coerce.number().default(2), // 2 CPUs
  SANDBOX_IDLE_TIMEOUT: z.coerce.number().default(30 * 60 * 1000), // 30 minutes

  // 工作区配置
  WORKSPACE_BASE_PATH: z.string().default("/var/lib/opencode/workspaces"),
})
```

## 启动服务

1. 确保已安装 Bun 运行时
2. 安装依赖：`bun install`
3. 设置环境变量
4. 启动开发服务器：`bun run dev`

## 容器集成

opencode-web 与 Docker 容器管理系统深度集成，能够动态管理沙盒环境容器的生命周期，为每个会话提供隔离的开发环境。

## 项目关系

opencode-web 是 OpenCode 项目生态系统的一部分，与以下组件协同工作：

- **opencode**: 终端用户界面和 CLI 工具
- **sandbox**: 沙盒执行环境
- **plugin**: 插件系统
- **ui**: UI 组件库

## 许可证

MIT License