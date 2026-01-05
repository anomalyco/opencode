# 会话管理API

<cite>
**本文档中引用的文件**   
- [session.go](file://packages/sdk/go/session.go)
- [session.ts](file://packages/opencode/src/session/index.ts)
- [server.ts](file://packages/opencode/src/server/server.ts)
- [message-v2.ts](file://packages/opencode/src/session/message-v2.ts)
- [prompt.ts](file://packages/opencode/src/session/prompt.ts)
- [session-management.ts](file://packages/sdk/node/example/session-management.ts)
</cite>

## 目录
1. [简介](#简介)
2. [会话RESTful端点](#会话restful端点)
3. [SSE流式会话交互](#sse流式会话交互)
4. [API版本控制策略](#api版本控制策略)
5. [会话状态机与生命周期](#会话状态机与生命周期)
6. [使用示例](#使用示例)
7. [错误处理](#错误处理)

## 简介
会话管理API为opencode平台提供了完整的会话创建、管理、交互和生命周期控制功能。该API允许客户端创建和管理对话会话，发送消息，执行命令，并通过SSE流式传输实时响应。API设计遵循RESTful原则，提供清晰的端点结构和一致的JSON响应格式。

**Section sources**
- [session.ts](file://packages/opencode/src/session/index.ts#L1-L348)
- [server.ts](file://packages/opencode/src/server/server.ts#L280-L479)

## 会话RESTful端点

### 创建会话 (POST /sessions)
创建一个新的会话实例。

**HTTP方法**: POST  
**URL路径**: /session

**请求头**:
- Authorization: Bearer {token}
- Content-Type: application/json

**请求体JSON Schema**:
```json
{
  "parentID": "string (可选)",
  "title": "string (可选)"
}
```

**响应体JSON Schema**:
```json
{
  "id": "string",
  "projectID": "string",
  "directory": "string",
  "parentID": "string",
  "share": {
    "url": "string"
  },
  "title": "string",
  "version": "string",
  "time": {
    "created": "number",
    "updated": "number",
    "compacting": "number"
  },
  "revert": {
    "messageID": "string",
    "partID": "string",
    "snapshot": "string",
    "diff": "string"
  }
}
```

**Section sources**
- [server.ts](file://packages/opencode/src/server/server.ts#L280-L335)
- [session.ts](file://packages/opencode/src/session/index.ts#L1-L348)

### 获取会话列表 (GET /sessions)
获取所有会话的列表，按更新时间降序排列。

**HTTP方法**: GET  
**URL路径**: /session

**请求头**:
- Authorization: Bearer {token}

**响应体JSON Schema**:
```json
[
  {
    "id": "string",
    "projectID": "string",
    "directory": "string",
    "parentID": "string",
    "share": {
      "url": "string"
    },
    "title": "string",
    "version": "string",
    "time": {
      "created": "number",
      "updated": "number",
      "compacting": "number"
    }
  }
]
```

**Section sources**
- [server.ts](file://packages/opencode/src/server/server.ts#L280-L335)
- [session.ts](file://packages/opencode/src/session/index.ts#L1-L348)

### 获取特定会话详情 (GET /sessions/{id})
获取指定ID会话的详细信息。

**HTTP方法**: GET  
**URL路径**: /session/{id}

**请求头**:
- Authorization: Bearer {token}

**路径参数**:
- id: 会话ID (字符串)

**响应体JSON Schema**:
```json
{
  "id": "string",
  "projectID": "string",
  "directory": "string",
  "parentID": "string",
  "share": {
    "url": "string"
  },
  "title": "string",
  "version": "string",
  "time": {
    "created": "number",
    "updated": "number",
    "compacting": "number"
  },
  "revert": {
    "messageID": "string",
    "partID": "string",
    "snapshot": "string",
    "diff": "string"
  }
}
```

**Section sources**
- [server.ts](file://packages/opencode/src/server/server.ts#L280-L335)
- [session.ts](file://packages/opencode/src/session/index.ts#L1-L348)

### 更新会话 (PATCH /sessions/{id})
更新会话的属性，目前支持更新会话标题。

**HTTP方法**: PATCH  
**URL路径**: /session/{id}

**请求头**:
- Authorization: Bearer {token}
- Content-Type: application/json

**路径参数**:
- id: 会话ID (字符串)

**请求体JSON Schema**:
```json
{
  "title": "string"
}
```

**响应体JSON Schema**:
```json
{
  "id": "string",
  "projectID": "string",
  "directory": "string",
  "parentID": "string",
  "share": {
    "url": "string"
  },
  "title": "string",
  "version": "string",
  "time": {
    "created": "number",
    "updated": "number",
    "compacting": "number"
  }
}
```

**Section sources**
- [server.ts](file://packages/opencode/src/server/server.ts#L376-L440)
- [session.ts](file://packages/opencode/src/session/index.ts#L1-L348)

### 删除会话 (DELETE /sessions/{id})
删除指定ID的会话及其所有相关数据。

**HTTP方法**: DELETE  
**URL路径**: /session/{id}

**请求头**:
- Authorization: Bearer {token}

**路径参数**:
- id: 会话ID (字符串)

**响应体JSON Schema**:
```json
true
```

**Section sources**
- [server.ts](file://packages/opencode/src/server/server.ts#L376-L440)
- [session.ts](file://packages/opencode/src/session/index.ts#L1-L348)

## SSE流式会话交互

### SSE流式会话交互 (GET /sessions/{id}/stream)
通过SSE（Server-Sent Events）实现流式会话交互，实时接收会话响应。

**HTTP方法**: GET  
**URL路径**: /session/{id}/stream

**请求头**:
- Authorization: Bearer {token}
- Accept: text/event-stream

**路径参数**:
- id: 会话ID (字符串)

### 连接建立
客户端通过HTTP GET请求建立SSE连接，服务器保持连接打开并持续发送事件。

### 消息格式
SSE流包含以下事件类型：

**事件类型**:
- message: 包含助手的响应消息
- error: 包含错误信息
- completion: 表示会话完成

**数据结构**:
```json
{
  "event": "message|error|completion",
  "data": {
    "id": "string",
    "role": "assistant",
    "content": "string",
    "time": {
      "created": "number",
      "completed": "number"
    },
    "tokens": {
      "input": "number",
      "output": "number"
    }
  }
}
```

### 错误处理机制
当发生错误时，服务器发送error事件，包含详细的错误信息：
```json
{
  "event": "error",
  "data": {
    "name": "ProviderAuthError|UnknownError|MessageOutputLengthError|MessageAbortedError",
    "data": {
      "providerID": "string",
      "message": "string"
    }
  }
}
```

**Section sources**
- [prompt.ts](file://packages/opencode/src/session/prompt.ts#L0-L799)
- [message-v2.ts](file://packages/opencode/src/session/message-v2.ts#L0-L581)

## API版本控制策略
会话管理API通过URL路径进行版本控制。当前版本的API端点均位于`/session`路径下，无需额外的版本前缀。未来的API版本可能会在路径中包含版本号，如`/v1/session`。建议客户端在请求时使用最新的稳定版本路径。

**Section sources**
- [server.ts](file://packages/opencode/src/server/server.ts#L280-L479)

## 会话状态机与生命周期

### 会话状态
会话具有以下状态：
- **active**: 会话处于活动状态，可以接收新的消息和命令
- **idle**: 会话处于空闲状态，最近没有活动
- **archived**: 会话已被归档，通常通过压缩或总结操作

### 生命周期管理
会话的生命周期包括以下阶段：
1. **创建**: 通过POST /session创建新会话
2. **活动**: 会话接收消息和命令，产生响应
3. **更新**: 会话属性（如标题）被修改
4. **压缩**: 会话内容被总结和压缩以节省资源
5. **删除**: 会话及其所有数据被永久删除

会话的`time`字段记录了关键时间戳：
- created: 会话创建时间
- updated: 会话最后更新时间
- compacting: 会话开始压缩的时间

**Section sources**
- [session.ts](file://packages/opencode/src/session/index.ts#L1-L348)
- [message-v2.ts](file://packages/opencode/src/session/message-v2.ts#L0-L581)

## 使用示例

### curl命令示例
```bash
# 创建新会话
curl -X POST https://api.opencode.com/session \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "My New Session"}'

# 获取会话列表
curl -X GET https://api.opencode.com/session \
  -H "Authorization: Bearer YOUR_TOKEN"

# 更新会话标题
curl -X PATCH https://api.opencode.com/session/SESSION_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated Session Title"}'

# 删除会话
curl -X DELETE https://api.opencode.com/session/SESSION_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### TypeScript客户端调用示例
```typescript
import { createOpencodeClient } from '@opencode/sdk'

async function sessionManagementExample() {
  const client = createOpencodeClient({
    baseUrl: 'http://localhost:54321',
    debug: true
  })

  // 创建新会话
  const session = await client.session.create({
    title: 'Node.js SDK Example Session'
  })
  console.log(`创建会话: ${session.id}`)

  // 获取会话详情
  const sessionDetails = await client.session.get(session.id)
  console.log('会话详情:', sessionDetails)

  // 更新会话
  const updatedSession = await client.session.update(session.id, {
    title: 'Updated Title'
  })

  // 删除会话
  await client.session.delete(session.id)
  console.log('会话已删除')
}
```

**Section sources**
- [session-management.ts](file://packages/sdk/node/example/session-management.ts#L0-L133)
- [session.go](file://packages/sdk/go/session.go#L27-L30)

## 错误处理
API使用标准的HTTP状态码表示错误：
- 400 Bad Request: 请求参数无效
- 401 Unauthorized: 认证令牌缺失或无效
- 404 Not Found: 指定的会话ID不存在
- 500 Internal Server Error: 服务器内部错误

错误响应体包含详细的错误信息：
```json
{
  "name": "错误名称",
  "data": {
    "详细错误信息"
  }
}
```

**Section sources**
- [session.go](file://packages/sdk/go/session.go#L27-L30)
- [message-v2.ts](file://packages/opencode/src/session/message-v2.ts#L0-L581)