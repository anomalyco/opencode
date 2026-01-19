# OpenCode API 合约文档

**生成时间**: 2026-01-19
**扫描级别**: Exhaustive
**API版本**: 0.0.3
**OpenAPI规范**: 3.1.1

## 📡 服务器信息

- **服务器URL**: `http://localhost:4096`
- **描述**: OpenCode API - AI驱动的开发工具后端

---

## 🔗 核心端点

### 1. 全局端点 (`/global/*`)

| 方法 | 端点              | 描述                |
| ---- | ----------------- | ------------------- |
| GET  | `/global/health`  | 健康检查            |
| GET  | `/global/event`   | 服务器发送事件(SSE) |
| POST | `/global/dispose` | 清理并释放所有资源  |

#### 健康检查响应

```json
{
  "healthy": true,
  "version": "1.1.13"
}
```

### 2. Session端点 (`/session/*`)

Session管理是OpenCode的核心功能，提供对话历史管理功能。

#### Session CRUD操作

| 方法   | 端点                  | 描述             |
| ------ | --------------------- | ---------------- |
| GET    | `/session`            | 列出所有sessions |
| POST   | `/session`            | 创建新session    |
| GET    | `/session/:sessionID` | 获取特定session  |
| PATCH  | `/session/:sessionID` | 更新session属性  |
| DELETE | `/session/:sessionID` | 删除session      |

#### Session消息操作

| 方法 | 端点                                     | 描述                    |
| ---- | ---------------------------------------- | ----------------------- |
| GET  | `/session/:sessionID/message`            | 获取所有消息            |
| POST | `/session/:sessionID/message`            | 发送消息(流式)          |
| GET  | `/session/:sessionID/message/:messageID` | 获取特定消息            |
| GET  | `/session/:sessionID/diff`               | 获取所有文件变更        |
| POST | `/session/:sessionID/summarize`          | AI压缩总结              |
| POST | `/session/:sessionID/fork`               | 复制session             |
| POST | `/session/:sessionID/share`              | 创建分享链接            |
| POST | `/session/:sessionID/init`               | 初始化session AGENTS.md |
| POST | `/session/:sessionID/abort`              | 中断处理                |

#### 消息部分操作

| 方法   | 端点                                                  | 描述         |
| ------ | ----------------------------------------------------- | ------------ |
| PATCH  | `/session/:sessionID/message/:messageID/part/:partID` | 更新消息部分 |
| DELETE | `/session/:sessionID/message/:messageID/part/:partID` | 删除消息部分 |

#### Session命令执行

| 方法 | 端点                               | 描述          |
| ---- | ---------------------------------- | ------------- |
| POST | `/session/:sessionID/command`      | 发送命令      |
| POST | `/session/:sessionID/shell`        | 执行shell命令 |
| POST | `/session/:sessionID/prompt_async` | 异步发送消息  |

#### Session版本控制

| 方法 | 端点                           | 描述     |
| ---- | ------------------------------ | -------- |
| POST | `/session/:sessionID/revert`   | 回滚消息 |
| POST | `/session/:sessionID/unrevert` | 恢复回滚 |

#### Session子项

| 方法 | 端点                           | 描述           |
| ---- | ------------------------------ | -------------- |
| GET  | `/session/:sessionID/children` | 获取子sessions |
| GET  | `/session/:sessionID/todo`     | 获取待办事项   |

### 3. PTY端点 (`/pty/*`)

伪终端管理，用于shell命令执行。

| 方法   | 端点                  | 描述            |
| ------ | --------------------- | --------------- |
| GET    | `/pty`                | 列出所有PTY会话 |
| POST   | `/pty`                | 创建PTY会话     |
| GET    | `/pty/:ptyID`         | 获取PTY会话信息 |
| PUT    | `/pty/:ptyID`         | 更新PTY会话     |
| DELETE | `/pty/:ptyID`         | 移除PTY会话     |
| GET    | `/pty/:ptyID/connect` | WebSocket连接   |

### 4. 配置端点 (`/config/*`)

| 方法  | 端点                | 描述             |
| ----- | ------------------- | ---------------- |
| GET   | `/config`           | 获取配置         |
| PATCH | `/config`           | 更新配置         |
| GET   | `/config/providers` | 获取AI提供商列表 |

### 5. 工具端点 (`/experimental/tool/*`)

| 方法 | 端点                     | 描述               |
| ---- | ------------------------ | ------------------ |
| GET  | `/experimental/tool/ids` | 列出工具ID         |
| GET  | `/experimental/tool`     | 列出工具(按提供商) |

### 6. Provider端点 (`/provider/*`)

AI提供商管理。

| 方法 | 端点                                    | 描述           |
| ---- | --------------------------------------- | -------------- |
| GET  | `/provider`                             | 列出所有提供商 |
| GET  | `/provider/auth`                        | 获取认证方法   |
| POST | `/provider/:providerID/oauth/authorize` | OAuth授权      |
| POST | `/provider/:providerID/oauth/callback`  | OAuth回调      |

### 7. 权限端点 (`/permission/*`)

| 方法 | 端点                           | 描述           |
| ---- | ------------------------------ | -------------- |
| GET  | `/permission`                  | 列出待处理权限 |
| POST | `/permission/:requestID/reply` | 回复权限请求   |

### 8. 项目端点 (`/project/*`)

项目相关操作。

### 9. 搜索端点 (`/find/*`)

| 方法 | 端点           | 描述              |
| ---- | -------------- | ----------------- |
| GET  | `/find`        | 文本搜索(ripgrep) |
| GET  | `/find/file`   | 文件搜索          |
| GET  | `/find/symbol` | 符号搜索(LSP)     |

### 10. VCS端点 (`/vcs`)

| 方法 | 端点   | 描述                |
| ---- | ------ | ------------------- |
| GET  | `/vcs` | 获取VCS信息(如分支) |

### 11. 路径端点 (`/path`)

| 方法 | 端点    | 描述         |
| ---- | ------- | ------------ |
| GET  | `/path` | 获取路径信息 |

### 12. Worktree端点 (`/experimental/worktree`)

Git worktree管理。

| 方法 | 端点                     | 描述          |
| ---- | ------------------------ | ------------- |
| POST | `/experimental/worktree` | 创建worktree  |
| GET  | `/experimental/worktree` | 列出worktrees |

### 13. 实例端点 (`/instance/*`)

| 方法 | 端点                | 描述     |
| ---- | ------------------- | -------- |
| POST | `/instance/dispose` | 清理实例 |

### 14. 命令端点 (`/command`)

| 方法 | 端点       | 描述         |
| ---- | ---------- | ------------ |
| GET  | `/command` | 列出所有命令 |

---

## 🔐 认证方式

### OAuth 2.0

- 支持多种AI提供商的OAuth认证
- 动态认证方法列表

### JWT Token

- 用于Cloudflare Worker API
- GitHub App Token交换

---

## 🌐 WebSocket端点

### PTY连接

```
ws://localhost:4096/pty/:ptyID/connect
```

### 全局事件

```
ws://localhost:4096/global/event (通过SSE)
```

### 实时分享

```
ws://<WEB_DOMAIN>/share_poll (Cloudflare Durable Objects)
```

---

## 📋 核心数据模型

### Session信息

```typescript
interface Session {
  id: string
  title: string
  time: {
    created: number
    updated: number
    archived?: number
  }
}
```

### 消息结构

```typescript
interface Message {
  id: string
  sessionID: string
  role: "user" | "assistant"
  content: string
  timestamp: number
}
```

### 文件变更

```typescript
interface FileDiff {
  path: string
  before?: string
  after?: string
  diff?: string
}
```

---

## 🔄 实时协作

### 分享API

- **创建分享**: `POST /share_create`
- **同步数据**: `POST /share_sync`
- **轮询更新**: `GET /share_poll`
- **获取数据**: `GET /share_data`
- **删除分享**: `POST /share_delete`

### WebSocket消息格式

```json
{
  "key": "session/info/abc123",
  "content": { ... }
}
```

---

## 📊 使用统计

- **总端点数**: 50+
- **主要分类**: 14个功能模块
- **API版本**: 0.0.3
- **框架**: Hono + OpenAPI

---

## 🔗 外部集成

### GitHub App Token交换

- **端点**: `POST /exchange_github_app_token`
- **用途**: GitHub Actions集成
- **认证**: OIDC + JWT

### Cloudflare Workers

- **部署**: edge.opencode.ai
- **功能**: 实时同步、分享功能
- **存储**: R2 Bucket + Durable Objects
