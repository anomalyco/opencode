# Plugin Development Guide

**Last Updated:** 2026-01-15

This document covers how to create custom plugins for OpenWork.

## Table of Contents

- [Overview](#overview)
- [Plugin Architecture](#plugin-architecture)
- [Creating a Plugin](#creating-a-plugin)
- [Available Hooks](#available-hooks)
- [Tool Development](#tool-development)
- [Authentication Plugins](#authentication-plugins)
- [Distribution](#distribution)
- [Examples](#examples)

---

## Overview

The OpenWork plugin system allows you to extend functionality through:

- **Custom Tools**: Add new capabilities the AI can use
- **Authentication**: Implement OAuth flows for providers
- **Chat Hooks**: Modify LLM behavior and messages
- **Permission Hooks**: Custom authorization logic
- **Event Hooks**: React to system events

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Plugin** | Async function that returns hooks |
| **Hooks** | Object with lifecycle handlers |
| **Tool** | Callable function the AI can execute |
| **Context** | Runtime information passed to plugins |

---

## Plugin Architecture

### Plugin Function Signature

```typescript
import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  // Plugin initialization
  return {
    // Hook implementations
  }
}
```

### Plugin Input Context

```typescript
type PluginInput = {
  client: OpencodeClient      // SDK client for API calls
  project: Project            // Current project info
  directory: string           // Working directory path
  worktree: string            // Git worktree path
  serverUrl: URL              // Local server URL
  $: BunShell                 // Shell execution API
}
```

### Lifecycle

1. **Loading**: Plugins are imported/installed
2. **Initialization**: Plugin function is called with `PluginInput`
3. **Registration**: Returned hooks are collected
4. **Triggering**: Hooks are called at appropriate times

---

## Creating a Plugin

### Basic Plugin

```typescript
// my-plugin.ts
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (ctx) => {
  console.log("Plugin initialized for:", ctx.directory)

  return {
    // Add hooks here
  }
}
```

### Plugin with Tools

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      greet: tool({
        description: "Greets a person by name",
        args: {
          name: tool.schema.string().describe("Person's name"),
        },
        async execute(args) {
          return `Hello, ${args.name}!`
        },
      }),

      weather: tool({
        description: "Gets weather for a location",
        args: {
          city: tool.schema.string().describe("City name"),
          units: tool.schema.enum(["celsius", "fahrenheit"]).optional(),
        },
        async execute(args, context) {
          // Can access context.sessionID, context.abort, etc.
          const response = await fetch(`https://api.weather.com/${args.city}`)
          const data = await response.json()
          return `Temperature in ${args.city}: ${data.temp}°`
        },
      }),
    },
  }
}
```

### Plugin with Multiple Hooks

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const AdvancedPlugin: Plugin = async (ctx) => {
  // Initialize shared state
  const cache = new Map<string, any>()

  return {
    // Custom tools
    tool: {
      mytool: tool({
        description: "My custom tool",
        args: { input: tool.schema.string() },
        async execute(args) {
          return `Processed: ${args.input}`
        },
      }),
    },

    // Modify LLM parameters
    chat: {
      params: async (input, output) => {
        output.temperature = 0.7
        output.topP = 0.9
      },
    },

    // Intercept tool execution
    tool: {
      execute: {
        before: async (input, output) => {
          console.log(`Executing tool: ${input.tool}`)
        },
        after: async (input, output) => {
          console.log(`Tool output: ${output.output}`)
        },
      },
    },
  }
}
```

---

## Available Hooks

### Tool Hooks

Define custom tools the AI can use:

```typescript
{
  tool: {
    [toolName: string]: ToolDefinition
  }
}
```

### Chat Hooks

Modify chat behavior:

```typescript
{
  chat: {
    // Modify LLM parameters
    params: async (input, output) => {
      output.temperature = 0.5
      output.maxTokens = 4096
    },

    // Process messages
    message: async (input, output) => {
      // React to new messages
    },
  }
}
```

### Permission Hooks

Intercept permission requests:

```typescript
{
  permission: {
    ask: async (input, output) => {
      // input: Permission object with details
      // output.status: "ask" | "deny" | "allow"

      if (input.type === "dangerous") {
        output.status = "deny"
      }
    },
  }
}
```

### Tool Execution Hooks

Hook into tool execution:

```typescript
{
  tool: {
    execute: {
      before: async (input, output) => {
        // input: { tool, sessionID, callID }
        // output: { args }
        console.log(`Before ${input.tool}`)
      },
      after: async (input, output) => {
        // output: { title, output, metadata }
        console.log(`After: ${output.title}`)
      },
    },
  }
}
```

### Authentication Hooks

Implement custom auth providers:

```typescript
{
  auth: {
    provider: "my-provider",
    methods: [
      {
        type: "oauth",
        label: "Sign in with MyProvider",
        authorize: async () => {
          return {
            url: authUrl,
            instructions: "Click to authorize",
            method: "auto",
            callback: async () => ({ type: "success", token })
          }
        }
      },
      {
        type: "api_key",
        label: "API Key",
        validate: async (key) => {
          // Validate the key
          return { valid: true }
        }
      }
    ],
    loader: (getAuth, provider) => {
      // Return custom provider configuration
    }
  }
}
```

### Experimental Hooks

Advanced customization (may change):

```typescript
{
  experimental: {
    chat: {
      messages: {
        transform: async (input, output) => {
          // Transform message history before sending to LLM
        },
      },
      system: {
        transform: async (input, output) => {
          // Modify system prompt
          output.system += "\nCustom instructions..."
        },
      },
    },
    session: {
      compacting: async (input, output) => {
        // Customize session compaction
      },
    },
    text: {
      complete: async (input, output) => {
        // Extend text completion
      },
    },
  }
}
```

---

## Tool Development

### Tool Definition

```typescript
import { tool } from "@opencode-ai/plugin"

const myTool = tool({
  description: "Clear description of what the tool does",
  args: {
    // Define arguments with Zod schemas
    required: tool.schema.string().describe("Required parameter"),
    optional: tool.schema.number().optional().describe("Optional number"),
    enumArg: tool.schema.enum(["a", "b", "c"]).describe("Choose one"),
    arrayArg: tool.schema.array(tool.schema.string()).describe("List of strings"),
    objectArg: tool.schema.object({
      nested: tool.schema.boolean(),
    }).describe("Nested object"),
  },
  async execute(args, context) {
    // args is typed based on schema
    // context provides session info and abort signal

    // Return string output
    return `Result: ${JSON.stringify(args)}`
  },
})
```

### Tool Context

```typescript
type ToolContext = {
  sessionID: string     // Current session ID
  messageID: string     // Current message ID
  agent: string         // Agent name
  abort: AbortSignal    // For cancellation
}
```

### Error Handling

```typescript
const safeTool = tool({
  description: "Tool with error handling",
  args: { input: tool.schema.string() },
  async execute(args, context) {
    try {
      const result = await riskyOperation(args.input)
      return `Success: ${result}`
    } catch (error) {
      // Return error message (shown to AI)
      return `Error: ${error.message}`
    }
  },
})
```

### Async Operations

```typescript
const asyncTool = tool({
  description: "Tool with async operations",
  args: { url: tool.schema.string().url() },
  async execute(args, context) {
    // Respect abort signal
    const response = await fetch(args.url, {
      signal: context.abort,
    })

    if (!response.ok) {
      return `Failed to fetch: ${response.status}`
    }

    const data = await response.json()
    return JSON.stringify(data, null, 2)
  },
})
```

---

## Authentication Plugins

### OAuth Implementation

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import crypto from "crypto"

export const OAuthPlugin: Plugin = async (ctx) => {
  return {
    auth: {
      provider: "my-service",
      methods: [
        {
          type: "oauth",
          label: "Sign in with MyService",
          authorize: async () => {
            // Generate PKCE challenge
            const verifier = crypto.randomBytes(32).toString("base64url")
            const challenge = crypto
              .createHash("sha256")
              .update(verifier)
              .digest("base64url")

            const authUrl = new URL("https://myservice.com/oauth/authorize")
            authUrl.searchParams.set("client_id", "my-client-id")
            authUrl.searchParams.set("redirect_uri", "http://localhost:8080/callback")
            authUrl.searchParams.set("code_challenge", challenge)
            authUrl.searchParams.set("code_challenge_method", "S256")

            return {
              url: authUrl.toString(),
              instructions: "Click to authorize OpenWork",
              method: "auto",
              callback: async () => {
                // Exchange code for token
                const tokenResponse = await fetch("https://myservice.com/oauth/token", {
                  method: "POST",
                  body: new URLSearchParams({
                    code: authCode,
                    verifier,
                  }),
                })

                const token = await tokenResponse.json()
                return {
                  type: "success",
                  accessToken: token.access_token,
                }
              },
            }
          },
        },
      ],
      loader: (getAuth, provider) => {
        // Return modified provider with auth
        return {
          ...provider,
          fetch: async (url, options) => {
            const auth = await getAuth()
            return fetch(url, {
              ...options,
              headers: {
                ...options?.headers,
                Authorization: `Bearer ${auth.accessToken}`,
              },
            })
          },
        }
      },
    },
  }
}
```

### API Key Authentication

```typescript
export const ApiKeyPlugin: Plugin = async (ctx) => {
  return {
    auth: {
      provider: "my-api",
      methods: [
        {
          type: "api_key",
          label: "Enter API Key",
          validate: async (key) => {
            // Validate the key works
            const response = await fetch("https://api.myservice.com/validate", {
              headers: { Authorization: `Bearer ${key}` },
            })
            return { valid: response.ok }
          },
        },
      ],
    },
  }
}
```

---

## Distribution

### Local Development

Place plugin files in your project:

```
project/
├── tool/
│   └── my-tool.ts      # Auto-discovered
├── tools/
│   └── another-tool.ts # Also auto-discovered
└── opencode.jsonc      # Or configure explicitly
```

### Configuration

```jsonc
// opencode.jsonc
{
  "plugin": [
    // npm packages
    "my-plugin-package@1.0.0",

    // Local files
    "file:///path/to/my-plugin.ts",

    // Built-in (from @opencode-ai)
    "@opencode-ai/my-plugin"
  ]
}
```

### Publishing to npm

1. Create package with plugin export:

```typescript
// index.ts
export { MyPlugin } from "./my-plugin"
```

2. Add to package.json:

```json
{
  "name": "my-openwork-plugin",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "@opencode-ai/plugin": "*"
  }
}
```

3. Publish:

```bash
npm publish
```

4. Users install via config:

```jsonc
{
  "plugin": ["my-openwork-plugin@1.0.0"]
}
```

---

## Examples

### File Manipulation Tool

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFile, writeFile } from "fs/promises"

export const FilePlugin: Plugin = async (ctx) => {
  return {
    tool: {
      count_lines: tool({
        description: "Count lines in a file",
        args: {
          path: tool.schema.string().describe("File path"),
        },
        async execute(args) {
          const content = await readFile(args.path, "utf-8")
          const lines = content.split("\n").length
          return `File has ${lines} lines`
        },
      }),
    },
  }
}
```

### API Integration Tool

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const GitHubPlugin: Plugin = async (ctx) => {
  const token = process.env.GITHUB_TOKEN

  return {
    tool: {
      github_issue: tool({
        description: "Create a GitHub issue",
        args: {
          repo: tool.schema.string().describe("Repository (owner/repo)"),
          title: tool.schema.string().describe("Issue title"),
          body: tool.schema.string().describe("Issue body"),
        },
        async execute(args) {
          const [owner, repo] = args.repo.split("/")
          const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/issues`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                title: args.title,
                body: args.body,
              }),
            }
          )

          if (!response.ok) {
            return `Failed to create issue: ${response.status}`
          }

          const issue = await response.json()
          return `Created issue #${issue.number}: ${issue.html_url}`
        },
      }),
    },
  }
}
```

### Logging Plugin

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const LoggingPlugin: Plugin = async (ctx) => {
  const logFile = `${ctx.directory}/.openwork/activity.log`

  return {
    tool: {
      execute: {
        before: async (input, output) => {
          const timestamp = new Date().toISOString()
          const log = `[${timestamp}] Executing: ${input.tool}\n`
          await Bun.write(logFile, log, { append: true })
        },
        after: async (input, output) => {
          const timestamp = new Date().toISOString()
          const log = `[${timestamp}] Completed: ${input.tool} - ${output.title}\n`
          await Bun.write(logFile, log, { append: true })
        },
      },
    },
  }
}
```

---

## Best Practices

### Do's

1. **Use descriptive tool descriptions** - The AI uses these to decide when to call your tool
2. **Validate inputs** - Use Zod schemas thoroughly
3. **Handle errors gracefully** - Return error messages, don't throw
4. **Respect abort signals** - Check `context.abort` for long operations
5. **Keep tools focused** - One tool, one purpose
6. **Document your plugins** - Include usage examples

### Don'ts

1. **Don't store sensitive data** - Use environment variables
2. **Don't block the event loop** - Use async operations
3. **Don't ignore context** - It provides important session info
4. **Don't create side effects silently** - Log or report significant actions
5. **Don't assume permissions** - Let the permission system work

### Security

1. **Sanitize inputs** - Especially for shell commands
2. **Validate URLs** - Don't fetch arbitrary URLs without checks
3. **Limit scope** - Only request necessary permissions
4. **Audit logs** - Track tool usage for sensitive operations
