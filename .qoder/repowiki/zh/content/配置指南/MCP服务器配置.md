# MCP服务器配置

<cite>
**本文档中引用的文件**  
- [opencode.json](file://opencode.json)
- [config.ts](file://packages/opencode/src/config/config.ts)
- [index.ts](file://packages/opencode/src/mcp/index.ts)
- [mcp.ts](file://packages/opencode/src/cli/cmd/mcp.ts)
- [04-tool-integration.md](file://doc-agent-context/04-tool-integration.md)
</cite>

## 目录
1. [MCP服务发现与连接机制](#mcp服务发现与连接机制)
2. [MCP服务器配置参数](#mcp服务器配置参数)
3. [opencode.json中的MCP工具提供者声明](#opencodejson中的mcp工具提供者声明)
4. [MCP客户端通信示例](#mcp客户端通信示例)
5. [完整的MCP服务器配置示例](#完整的mcp服务器配置示例)
6. [启用和禁用MCP工具](#启用和禁用mcp工具)

## MCP服务发现与连接机制

MCP（Model Context Protocol）服务器的发现与连接机制通过配置文件中的`mcp`字段实现，支持本地和远程两种连接类型。系统在启动时会自动读取配置并建立连接。

对于远程MCP服务器，系统会尝试通过StreamableHTTP和SSE两种传输协议进行连接，优先使用StreamableHTTP。连接时会自动携带配置中定义的HTTP头信息。对于本地MCP服务器，系统会启动指定的命令行进程，并通过标准输入输出进行通信。

```mermaid
flowchart TD
A[系统启动] --> B{读取配置文件}
B --> C[解析mcp配置]
C --> D{连接类型}
D --> |远程| E[创建StreamableHTTP/SSE传输]
D --> |本地| F[启动本地命令进程]
E --> G[建立MCP连接]
F --> G
G --> H[获取服务器工具列表]
H --> I[注册MCP工具]
```

**Diagram sources**
- [index.ts](file://packages/opencode/src/mcp/index.ts#L22-L60)
- [config.ts](file://packages/opencode/src/config/config.ts#L247-L278)

**Section sources**
- [index.ts](file://packages/opencode/src/mcp/index.ts#L22-L155)
- [config.ts](file://packages/opencode/src/config/config.ts#L247-L278)

## MCP服务器配置参数

MCP服务器的配置参数分为本地和远程两种类型，通过`type`字段区分。所有配置都位于`opencode.json`文件的`mcp`对象下。

### 本地MCP服务器配置

本地MCP服务器通过执行命令行来启动，主要配置参数包括：

- **type**: 连接类型，固定为"local"
- **command**: 启动MCP服务器的命令和参数数组
- **environment**: 运行时环境变量
- **enabled**: 是否在启动时自动启用该服务器

```json
{
  "type": "local",
  "command": ["bun", "x", "@modelcontextprotocol/server-filesystem"],
  "environment": {
    "NODE_ENV": "production",
    "LOG_LEVEL": "info"
  },
  "enabled": true
}
```

### 远程MCP服务器配置

远程MCP服务器通过HTTP连接，主要配置参数包括：

- **type**: 连接类型，固定为"remote"
- **url**: 远程MCP服务器的URL
- **headers**: 发送请求时携带的HTTP头
- **enabled**: 是否在启动时自动启用该服务器

```json
{
  "type": "remote",
  "url": "https://mcp.example.com/api",
  "headers": {
    "Authorization": "Bearer your-api-token",
    "Content-Type": "application/json"
  },
  "enabled": true
}
```

**Section sources**
- [config.ts](file://packages/opencode/src/config/config.ts#L247-L278)
- [index.ts](file://packages/opencode/src/mcp/index.ts#L22-L60)

## opencode.json中的MCP工具提供者声明

在`opencode.json`文件中，MCP工具提供者通过`mcp`字段进行声明。每个MCP服务器都有一个唯一的键名，用于标识该服务器。

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "filesystem-server": {
      "type": "local",
      "command": ["bun", "x", "@modelcontextprotocol/server-filesystem"],
      "enabled": true
    },
    "code-analysis-server": {
      "type": "remote",
      "url": "https://api.mcp-services.com/v1",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      },
      "enabled": true
    }
  }
}
```

当系统读取配置文件时，会自动发现所有声明的MCP服务器，并根据配置建立连接。连接成功后，系统会自动获取服务器提供的所有工具，并将其注册到工具管理系统中。

```mermaid
classDiagram
class MCPClientManager {
+clients : Map[string, MCPClient]
+tools : Map[string, MCPTool]
+connectToServer(config : MCPConfig) : Promise~void~
+getTools() : Promise~Record~string, Tool.Info~~
}
class MCPTool {
-name : string
-tool : MCPToolDefinition
-client : MCPClient
+toToolInfo() : Promise~Tool.Info~
}
class Config {
+mcp : Record~string, Mcp~
}
MCPClientManager --> Config : "读取"
MCPClientManager --> MCPTool : "创建"
Config --> MCPClientManager : "提供配置"
```

**Diagram sources**
- [04-tool-integration.md](file://doc-agent-context/04-tool-integration.md#L223-L333)
- [index.ts](file://packages/opencode/src/mcp/index.ts#L145-L155)

**Section sources**
- [opencode.json](file://opencode.json)
- [config.ts](file://packages/opencode/src/config/config.ts#L459-L491)

## MCP客户端通信示例

以下是一个完整的MCP客户端通信示例，展示了如何与MCP服务器进行交互：

```typescript
import { experimental_createMCPClient } from "ai"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

// 连接到远程MCP服务器
async function connectToRemoteServer() {
  const transport = new StreamableHTTPClientTransport(
    new URL("https://mcp.example.com/api"),
    {
      requestInit: {
        headers: {
          "Authorization": "Bearer YOUR_TOKEN"
        }
      }
    }
  )
  
  const client = await experimental_createMCPClient({
    name: "opencode",
    transport
  })
  
  // 获取服务器提供的工具
  const tools = await client.tools()
  console.log("Available tools:", Object.keys(tools))
  
  // 调用特定工具
  const result = await client.callTool("readFile", {
    path: "/project/src/index.ts"
  })
  
  return result
}

// 启动本地MCP服务器
async function startLocalServer() {
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["x", "@modelcontextprotocol/server-filesystem"],
    env: {
      ...process.env,
      "MCP_LOG_LEVEL": "info"
    }
  })
  
  const client = await experimental_createMCPClient({
    name: "opencode",
    transport
  })
  
  return client
}
```

系统还提供了命令行工具来添加MCP服务器配置：

```bash
# 添加MCP服务器
opencode mcp add

# 系统会提示输入服务器名称、类型、URL或命令等信息
```

**Section sources**
- [index.ts](file://packages/opencode/src/mcp/index.ts#L22-L155)
- [mcp.ts](file://packages/opencode/src/cli/cmd/mcp.ts#L0-L80)

## 完整的MCP服务器配置示例

以下是一个完整的`opencode.json`配置文件示例，包含了多个MCP服务器的配置：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "local-filesystem": {
      "type": "local",
      "command": [
        "bun", 
        "x", 
        "@modelcontextprotocol/server-filesystem",
        "--root",
        "/project/root"
      ],
      "environment": {
        "NODE_ENV": "development",
        "DEBUG": "mcp:*"
      },
      "enabled": true
    },
    "remote-code-analysis": {
      "type": "remote",
      "url": "https://api.code-analysis-service.com/mcp/v1",
      "headers": {
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx",
        "X-Client-Version": "1.0.0"
      },
      "enabled": true
    },
    "local-testing": {
      "type": "local",
      "command": ["npm", "start", "--prefix", "./mcp-test-server"],
      "enabled": false
    }
  },
  "agent": {
    "default": {
      "tools": {
        "local-filesystem_readFile": true,
        "local-filesystem_writeFile": true,
        "remote-code-analysis_analyzeCode": true
      }
    }
  }
}
```

此配置定义了三个MCP服务器：
- `local-filesystem`：本地文件系统服务器，已启用
- `remote-code-analysis`：远程代码分析服务器，已启用
- `local-testing`：本地测试服务器，已禁用

**Section sources**
- [opencode.json](file://opencode.json)
- [04-tool-integration.md](file://doc-agent-context/04-tool-integration.md#L799-L882)

## 启用和禁用MCP工具

MCP工具的启用和禁用可以通过两种方式实现：服务器级别的启用/禁用和工具级别的启用/禁用。

### 服务器级别启用/禁用

通过设置MCP服务器配置中的`enabled`字段来控制整个服务器的启用状态：

```json
{
  "mcp": {
    "active-server": {
      "type": "remote",
      "url": "https://active.example.com",
      "enabled": true
    },
    "inactive-server": {
      "type": "local",
      "command": ["bun", "x", "inactive-server"],
      "enabled": false
    }
  }
}
```

当`enabled`设置为`false`时，系统启动时不会尝试连接该服务器。

### 工具级别启用/禁用

即使服务器已连接，也可以通过代理（agent）配置来控制特定工具的可用性：

```json
{
  "agent": {
    "developer": {
      "tools": {
        "filesystem-readFile": true,
        "filesystem-writeFile": false,
        "code-analysis-*": true,
        "testing-*": false
      }
    }
  }
}
```

在工具配置中：
- 可以使用通配符`*`来匹配一组工具
- 设置为`true`表示启用该工具
- 设置为`false`表示禁用该工具
- 未指定的工具将使用系统默认策略

系统在执行工具调用前会检查权限配置，确保只有授权的工具才能被执行。

```mermaid
flowchart TD
A[用户请求执行工具] --> B{工具是否存在}
B --> |否| C[返回错误]
B --> |是| D{服务器是否启用}
D --> |否| C
D --> |是| E{代理配置是否允许}
E --> |否| C
E --> |是| F[执行工具]
F --> G[返回结果]
```

**Diagram sources**
- [04-tool-integration.md](file://doc-agent-context/04-tool-integration.md#L572-L616)
- [index.ts](file://packages/opencode/src/mcp/index.ts#L145-L155)

**Section sources**
- [config.ts](file://packages/opencode/src/config/config.ts#L247-L278)
- [04-tool-integration.md](file://doc-agent-context/04-tool-integration.md#L799-L882)