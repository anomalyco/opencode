# SDK and API Documentation

**Last Updated:** 2026-01-15

This document covers the SDK architecture, API patterns, and integration approaches used in OpenWork.

## Table of Contents

- [SDK Overview](#sdk-overview)
- [Client Initialization](#client-initialization)
- [API Generation](#api-generation)
- [REST API Endpoints](#rest-api-endpoints)
- [Event Streaming](#event-streaming)
- [Provider Integration](#provider-integration)
- [MCP Integration](#mcp-integration)
- [Tool System](#tool-system)
- [Configuration](#configuration)

---

## SDK Overview

### Package Structure
```
packages/sdk/js/src/
├── client.ts               # createOpencodeClient()
├── server.ts               # createOpencodeServer()
├── index.ts                # Main exports
├── gen/                    # Auto-generated from OpenAPI
│   ├── sdk.gen.ts          # OpencodeClient class
│   ├── client/
│   │   ├── client.gen.ts   # HTTP client implementation
│   │   └── types.gen.ts    # Request/response types
│   └── types.gen.ts        # Schema types
└── v2/                     # Version 2 API
    ├── index.ts
    ├── client.ts
    └── server.ts
```

### Key Exports
```typescript
// Main SDK exports
import { createOpencodeClient } from "@opencode-ai/sdk"
import { createOpencodeServer } from "@opencode-ai/sdk/server"
import { createOpencode } from "@opencode-ai/sdk"

// V2 API
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

// Types
import type { Session, Message, Tool } from "@opencode-ai/sdk"
```

---

## Client Initialization

### V2 Client Implementation (from `packages/sdk/js/src/v2/client.ts`)

```typescript
// Actual implementation
export function createOpencodeClient(config?: Config & { directory?: string }) {
  // Disable fetch timeout
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      req.timeout = false
      return fetch(req)
    }
    config = { ...config, fetch: customFetch }
  }

  // Handle non-ASCII directory names
  if (config?.directory) {
    const isNonASCII = /[^\x00-\x7F]/.test(config.directory)
    const encodedDirectory = isNonASCII
      ? encodeURIComponent(config.directory)
      : config.directory
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodedDirectory,
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}
```

### Standalone Client
```typescript
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  directory: "/path/to/project",
  fetch: customFetch,  // Optional custom fetch
  throwOnError: true,  // Throw on HTTP errors
})

// Use the client
const sessions = await client.session.list()
const health = await client.global.health()
```

### Server + Client
```typescript
import { createOpencode } from "@opencode-ai/sdk"

const { client, server } = await createOpencode({
  port: 4096,
  hostname: "127.0.0.1",
})

// Server is running, client is connected
const sessions = await client.session.list()

// Cleanup
await server.close()
```

### Frontend Context Usage
```typescript
// packages/app/src/context/sdk.tsx
import { createOpencodeClient } from "@opencode-ai/sdk"

const sdk = createOpencodeClient({
  baseUrl: globalSDK.url,           // Dynamic server URL
  directory: props.directory,        // Project directory
  fetch: platform.fetch,             // Platform-specific fetch
  throwOnError: true,
})
```

---

## API Generation

### OpenAPI Schema
The SDK is auto-generated from an OpenAPI specification:
```
packages/sdk/openapi.json → @hey-api/openapi-ts → Generated TypeScript
```

### Generation Command
```bash
bun run --cwd packages/sdk/js generate
```

### Generated Structure
```typescript
// sdk.gen.ts - Main client class
export class OpencodeClient {
  public readonly global: GlobalService
  public readonly session: SessionService
  public readonly project: ProjectService
  public readonly mcp: McpService
  public readonly tool: ToolService
  public readonly provider: ProviderService
  public readonly file: FileService
}

// types.gen.ts - All schema types
export interface Session {
  id: string
  projectID: string
  directory: string
  title: string
  time: { created: number; updated: number }
}
```

---

## REST API Endpoints

### Global Endpoints
```
GET  /global/health         # Health check
GET  /global/event          # SSE event stream
POST /global/dispose        # Shutdown server
```

### Project Endpoints
```
GET  /project               # List all projects
GET  /project/current       # Get current project
```

### Session Endpoints
```
GET    /session/{sessionID}           # Get session details
PATCH  /session/{sessionID}           # Update session
DELETE /session/{sessionID}           # Delete session
POST   /session/{sessionID}/prompt    # Execute prompt (sync)
POST   /session/{sessionID}/prompt-async  # Execute prompt (streaming)
GET    /session/{sessionID}/messages  # List messages
GET    /session/{sessionID}/message/{messageID}  # Get message
GET    /session/{sessionID}/event     # Session-specific SSE stream
```

### MCP Endpoints
```
GET  /mcp/tools              # List available tools
GET  /mcp/resources          # List available resources
GET  /mcp/prompts            # List available prompts
POST /mcp/authenticate       # Authenticate MCP server
POST /mcp/auth-start         # Start OAuth flow
POST /mcp/auth-finish        # Complete OAuth flow
```

### Tool Endpoints
```
GET  /tool/ids               # List tool IDs
GET  /tool/list              # List all tools with details
```

### Provider Endpoints
```
GET  /provider/models        # List available models
POST /provider/auth          # Authenticate provider
GET  /provider/auth-methods  # List auth methods
```

### File Endpoints
```
GET  /file/read              # Read file contents
GET  /file/watch             # SSE stream for file changes
```

---

## Event Streaming

### Server-Sent Events (SSE)
The API uses SSE for real-time updates:

```typescript
// Subscribe to global events
const events = await client.global.event()
for await (const event of events.stream) {
  switch (event.type) {
    case "session.created":
      console.log("New session:", event.info.id)
      break
    case "session.updated":
      console.log("Session updated:", event.sessionID)
      break
    case "message.part.updated":
      console.log("Message part:", event.part)
      break
  }
}
```

### Event Types
```typescript
// Discriminated union of all events
type BusEvent =
  | { type: "session.created"; info: Session }
  | { type: "session.updated"; sessionID: string }
  | { type: "session.message.created"; sessionID: string; message: Message }
  | { type: "message.part.updated"; sessionID: string; part: MessagePart }
  | { type: "session.status"; status: SessionStatus }
  | { type: "mcp.status"; client: string; status: McpStatus }
```

### Event Coalescing
Frontend implements event coalescing to prevent duplicate updates:

```typescript
// Prevent duplicate status updates
const key = `session.status:${directory}:${sessionID}`
if (coalesced.has(key)) {
  // Skip duplicate
  return
}
coalesced.set(key, queueIndex)
```

---

## Provider Integration

### Provider Architecture
```
packages/opencode/src/provider/
├── provider.ts             # Main provider logic
├── sdk/                    # Provider-specific SDKs
│   └── openai-compatible/
└── models.ts               # Model management
```

### Bundled Providers
```typescript
const BUNDLED_PROVIDERS = {
  "@ai-sdk/anthropic": createAnthropic,
  "@ai-sdk/openai": createOpenAI,
  "@ai-sdk/google": createGoogle,
  "@ai-sdk/azure": createAzure,
  "@ai-sdk/google-vertex": createGoogleVertex,
  "@ai-sdk/amazon-bedrock": createAmazonBedrock,
  "@ai-sdk/mistral": createMistral,
  "@ai-sdk/groq": createGroq,
  "@ai-sdk/cohere": createCohere,
  "@ai-sdk/xai": createXai,
  // ... and more
}
```

### Custom Provider Loading
```typescript
const CUSTOM_LOADERS = {
  anthropic: async () => ({
    autoload: false,
    options: {
      headers: {
        "anthropic-beta": "interleaved-thinking-2025-05-14"
      }
    }
  }),
  openai: async () => ({
    autoload: false,
    async getModel(modelID) {
      // Custom model configuration
    }
  }),
}
```

### Model Management
```typescript
// Models fetched from models.dev API
const models = await fetchModels()

// Model metadata
interface Model {
  id: string
  provider: string
  cost: {
    input: number
    output: number
    cacheRead?: number
    cacheWrite?: number
  }
  capabilities: {
    attachment: boolean
    reasoning: boolean
    toolCall: boolean
  }
  tokenLimits: {
    input: number
    output: number
  }
}
```

---

## MCP Integration

### MCP Client Setup
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

// Create transport
const transport = new StdioClientTransport({
  command: "node",
  args: ["server.js"],
  env: process.env,
})

// Initialize client
const client = new Client({ name: "openwork", version: "1.0.0" })
await client.connect(transport)
```

### Transport Types
```typescript
// Local process (stdio)
const transport = new StdioClientTransport({
  command: string,
  args?: string[],
  env?: Record<string, string>,
})

// HTTP SSE
const transport = new SSEClientTransport({
  url: string,
  eventSourceInit?: EventSourceInit,
})

// Bidirectional HTTP
const transport = new StreamableHTTPClientTransport({
  url: string,
})
```

### MCP Tools
```typescript
// List available tools
const tools = await client.listTools()

// Call a tool
const result = await client.callTool(
  { name: "tool_name", arguments: { key: "value" } },
  CallToolResultSchema,
  { timeout: 30000 }
)
```

### MCP Resources
```typescript
// List resources
const resources = await client.listResources()

// Read a resource
const content = await client.readResource({ uri: "resource://path" })
```

### MCP Prompts
```typescript
// List prompts
const prompts = await client.listPrompts()

// Get prompt with arguments
const prompt = await client.getPrompt({
  name: "prompt_name",
  arguments: { key: "value" }
})
```

### MCP Status Management
```typescript
type McpStatus =
  | "connected"
  | "disabled"
  | "failed"
  | "needs_auth"
  | "needs_client_registration"
```

---

## Tool System

### Tool Registry
```
packages/opencode/src/tool/
├── registry.ts             # Tool discovery
├── bash.ts                 # Bash tool
├── edit.ts                 # Edit tool
├── glob.ts                 # Glob tool
├── grep.ts                 # Grep tool
├── read.ts                 # Read tool
├── write.ts                # Write tool
├── task.ts                 # Task tool
├── todo.ts                 # Todo tool
├── web-fetch.ts            # Web fetch tool
└── web-search.ts           # Web search tool
```

### Tool Definition
```typescript
import { Tool } from "@opencode-ai/plugin"
import { z } from "zod"

export const MyTool = Tool.define({
  id: "my_tool",
  init: async (ctx) => ({
    description: "Does something useful",
    parameters: z.object({
      input: z.string().describe("The input value"),
      options: z.object({
        flag: z.boolean().optional(),
      }).optional(),
    }),
    execute: async (args, execCtx) => {
      // Tool implementation
      const result = await doSomething(args.input)

      return {
        title: `Processed: ${args.input}`,
        output: result,
        metadata: {
          truncated: false,
        }
      }
    }
  })
})
```

### Built-in Tools

| Tool | Purpose |
|------|---------|
| `BashTool` | Execute shell commands |
| `EditTool` | Edit files with diffs |
| `WriteTool` | Create/overwrite files |
| `ReadTool` | Read file contents |
| `GlobTool` | Find files by pattern |
| `GrepTool` | Search file contents |
| `TaskTool` | Delegate subtasks |
| `TodoTool` | Manage task lists |
| `WebFetchTool` | Fetch web pages |
| `WebSearchTool` | Search the web |
| `QuestionTool` | Ask user questions |

### Tool Execution Context
```typescript
interface ToolExecuteContext {
  sessionID: string
  messageID: string
  directory: string
  abort: AbortSignal
  permission: PermissionChecker
  emit: (event: ToolEvent) => void
}
```

---

## Configuration

### Configuration Sources (Precedence)
1. **Remote/Well-known**: Organization default configs
2. **Global User**: `~/.opencode/config.jsonc`
3. **Custom Path**: `OPENCODE_CONFIG` env var
4. **Project**: `opencode.jsonc` or `opencode.json`
5. **Inline**: `OPENCODE_CONFIG_CONTENT` env var

### Configuration Schema
```typescript
interface Config {
  // Agent configurations
  agent?: Record<string, AgentConfig>

  // Custom commands
  command?: Record<string, CommandConfig>

  // MCP server configurations
  mcp?: Record<string, McpServerConfig>

  // Provider configurations
  provider?: Record<string, ProviderConfig>

  // Permission rules
  permission?: PermissionRuleset

  // Plugin paths
  plugin?: string[]

  // Custom instructions
  instructions?: string[]
}
```

### Example Configuration
```jsonc
// opencode.jsonc
{
  "mcp": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      "enabled": true
    }
  },
  "provider": {
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },
  "instructions": [
    "Always use TypeScript",
    "Follow the project's coding conventions"
  ]
}
```

### Environment Variables
```bash
# Server configuration
OPENCODE_PORT=4096
OPENCODE_HOSTNAME=127.0.0.1

# Configuration overrides
OPENCODE_CONFIG=/path/to/config.jsonc
OPENCODE_CONFIG_CONTENT='{"mcp": {...}}'

# Provider API keys
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...
```

---

## Usage Examples

### Creating a Session
```typescript
const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })

// Create session
const session = await client.session.create({
  directory: "/path/to/project",
  title: "New Session"
})

// Execute prompt
const response = await client.session.prompt({
  sessionID: session.id,
  content: "Hello, how can I help?"
})
```

### Streaming Responses
```typescript
// Subscribe to session events
const events = await client.session.event({ sessionID: session.id })

// Execute prompt asynchronously
client.session.promptAsync({
  sessionID: session.id,
  content: "Generate a report"
})

// Stream responses
for await (const event of events.stream) {
  if (event.type === "message.part.updated") {
    console.log(event.part.content)
  }
}
```

### Using MCP Tools
```typescript
// List MCP tools
const tools = await client.mcp.tools()

// Tools are available to the AI automatically
// They can be called during prompt execution
```

### File Operations
```typescript
// Read file
const content = await client.file.read({
  path: "/path/to/file.ts"
})

// Watch for changes
const watcher = await client.file.watch({
  paths: ["/path/to/dir"]
})

for await (const change of watcher.stream) {
  console.log("File changed:", change.path)
}
```

---

## Error Handling

### API Errors
```typescript
try {
  const session = await client.session.get({ sessionID: "invalid" })
} catch (error) {
  if (error.status === 404) {
    console.log("Session not found")
  } else {
    throw error
  }
}
```

### Validation Errors
```typescript
const result = await client.session.create({
  // Missing required fields
})

if (!result.success) {
  console.log("Validation errors:", result.errors)
}
```

### Connection Errors
```typescript
const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  throwOnError: false,  // Return errors instead of throwing
})

const result = await client.global.health()
if (result.error) {
  console.log("Connection failed:", result.error)
}
```
