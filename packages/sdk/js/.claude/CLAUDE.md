# OpenCode SDK Package Guide

> **Package**: `packages/sdk/js`
> **Purpose**: TypeScript SDK for OpenCode clients
> **Type**: Library
> **Generated**: Partially auto-generated from API schema

## Overview

The OpenCode SDK provides a type-safe TypeScript client for interacting with the OpenCode server. It's used by:
- Web application (`packages/app`)
- Desktop application (`packages/desktop`)
- Custom integrations
- Third-party tools

The SDK is partially generated from the OpenAPI schema defined in the server, ensuring type safety and API compatibility.

## Directory Structure

```
packages/sdk/js/
├── script/
│   └── build.ts          # SDK generation script
├── src/
│   ├── client.ts         # Main client implementation
│   ├── types.ts          # Generated type definitions
│   ├── api.ts            # API method definitions
│   └── ...
├── package.json
└── tsconfig.json
```

## Main Components

### 1. Client Creation (`src/client.ts`)

Create an OpenCode client:

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk'

// Basic client (connects to localhost:4096 by default)
const client = createOpencodeClient()

// Custom configuration
const client = createOpencodeClient({
  baseUrl: 'https://api.opencode.ai',
  fetch: customFetch,  // Optional custom fetch implementation
  headers: {
    'Authorization': 'Bearer token'
  }
})
```

### 2. Session Management

```typescript
// Create a new session
const session = await client.session.create({
  agentId: 'build'
})

// List all sessions
const sessions = await client.session.list()

// Get a specific session
const session = await client.session.get('session-id')

// Delete a session
await client.session.delete('session-id')

// Fork a session
const forked = await client.session.fork('session-id')

// Summarize a session
await client.session.summarize('session-id')
```

### 3. Message Handling

```typescript
// Send a message (streaming)
for await (const chunk of client.message.stream('session-id', {
  content: 'Write a function to calculate factorial'
})) {
  if (chunk.type === 'text') {
    console.log(chunk.content)
  } else if (chunk.type === 'tool_use') {
    console.log('Tool:', chunk.tool, chunk.input)
  } else if (chunk.type === 'tool_result') {
    console.log('Result:', chunk.result)
  }
}

// Get message history
const messages = await client.message.list('session-id')
```

### 4. Provider Management

```typescript
// List available providers
const providers = await client.provider.list()

// Authenticate with a provider
await client.provider.auth('anthropic')

// List models for a provider
const models = await client.provider.models('anthropic')
```

### 5. Configuration

```typescript
// Get current config
const config = await client.config.get()

// Update config
await client.config.update({
  agent: {
    default: 'plan'
  },
  provider: {
    default: 'anthropic'
  }
})
```

### 6. File Operations

```typescript
// List files in workspace
const files = await client.file.list()

// Read a file
const content = await client.file.read('path/to/file.ts')

// Write a file
await client.file.write('path/to/file.ts', 'content')

// Delete a file
await client.file.delete('path/to/file.ts')
```

### 7. Git Operations

```typescript
// Get git status
const status = await client.git.status()

// Get current branch
const branch = await client.git.branch()

// Get diff
const diff = await client.git.diff('HEAD~1')
```

## Type Definitions

The SDK includes comprehensive TypeScript types:

```typescript
// Session types
interface Session {
  id: string
  agentId: string
  createdAt: string
  updatedAt: string
  messages: Message[]
}

// Message types
interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: MessageContent[]
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: string
}

// Streaming message parts
type MessageChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; tool: string; input: unknown }
  | { type: 'tool_result'; result: unknown }
  | { type: 'thinking'; content: string }
  | { type: 'done' }

// Config types
interface Config {
  agent?: AgentConfig
  provider?: ProviderConfig
  tools?: ToolConfig
  // ...
}
```

## Advanced Usage

### Custom Fetch

Use a custom fetch implementation:

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk'

const client = createOpencodeClient({
  fetch: async (url, init) => {
    // Add custom headers, logging, etc.
    console.log('Fetching:', url)
    return fetch(url, init)
  }
})
```

### Error Handling

```typescript
try {
  const session = await client.session.create()
} catch (error) {
  if (error instanceof OpencodeError) {
    console.error('API Error:', error.message)
    console.error('Status:', error.status)
    console.error('Details:', error.details)
  }
}
```

### Streaming with Abort

```typescript
const controller = new AbortController()

// Start streaming
const stream = client.message.stream('session-id', {
  content: 'message'
}, {
  signal: controller.signal
})

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000)

try {
  for await (const chunk of stream) {
    console.log(chunk)
  }
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Streaming cancelled')
  }
}
```

### Event Streaming (SSE)

```typescript
// Listen to server events
const events = client.event.stream()

for await (const event of events) {
  if (event.type === 'session.updated') {
    console.log('Session updated:', event.data)
  } else if (event.type === 'file.changed') {
    console.log('File changed:', event.data)
  }
}
```

## Building Custom Clients

### Basic Client Example

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk'

class MyOpenCodeApp {
  private client: ReturnType<typeof createOpencodeClient>

  constructor() {
    this.client = createOpencodeClient({
      baseUrl: process.env.OPENCODE_URL
    })
  }

  async chat(message: string) {
    // Create or resume session
    const sessions = await this.client.session.list()
    const session = sessions[0] || await this.client.session.create()

    // Send message and handle response
    for await (const chunk of this.client.message.stream(session.id, {
      content: message
    })) {
      this.handleChunk(chunk)
    }
  }

  private handleChunk(chunk: MessageChunk) {
    // Process streaming chunks
    if (chunk.type === 'text') {
      console.log(chunk.content)
    }
  }
}
```

### CLI Client Example

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk'
import readline from 'readline'

const client = createOpencodeClient()
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

async function repl() {
  const session = await client.session.create({ agentId: 'build' })

  rl.on('line', async (input) => {
    for await (const chunk of client.message.stream(session.id, {
      content: input
    })) {
      if (chunk.type === 'text') {
        process.stdout.write(chunk.content)
      }
    }
    console.log()
  })
}

repl()
```

## Generation & Building

### Regenerating the SDK

When the API changes, regenerate the SDK:

```bash
# From repo root
./script/generate.ts

# Or directly
./packages/sdk/js/script/build.ts
```

This will:
1. Extract OpenAPI schema from server
2. Generate TypeScript types
3. Update API method definitions
4. Build the package

### Build Process

```bash
# Build SDK
bun run --cwd packages/sdk/js build

# Type check
bun run --cwd packages/sdk/js typecheck

# Test
bun run --cwd packages/sdk/js test
```

## Integration Patterns

### React/SolidJS Hook

```typescript
import { createSignal, createEffect } from 'solid-js'
import { createOpencodeClient } from '@opencode-ai/sdk'

function useOpenCode() {
  const client = createOpencodeClient()
  const [sessions, setSessions] = createSignal([])

  createEffect(async () => {
    const list = await client.session.list()
    setSessions(list)
  })

  const sendMessage = async (sessionId: string, content: string) => {
    const chunks = []
    for await (const chunk of client.message.stream(sessionId, { content })) {
      chunks.push(chunk)
    }
    return chunks
  }

  return { sessions, sendMessage, client }
}
```

### Node.js Script

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk'

async function analyzeCode(filePath: string) {
  const client = createOpencodeClient()
  const session = await client.session.create()

  // Read file
  const content = await client.file.read(filePath)

  // Ask AI to analyze
  const response = []
  for await (const chunk of client.message.stream(session.id, {
    content: `Analyze this code:\n\n${content}`
  })) {
    if (chunk.type === 'text') {
      response.push(chunk.content)
    }
  }

  return response.join('')
}

// Usage
const analysis = await analyzeCode('src/index.ts')
console.log(analysis)
```

## API Reference

### Client Methods

```typescript
client.session.create(options)
client.session.list()
client.session.get(id)
client.session.delete(id)
client.session.fork(id)
client.session.summarize(id)

client.message.stream(sessionId, message, options)
client.message.list(sessionId)

client.provider.list()
client.provider.auth(providerId)
client.provider.models(providerId)

client.config.get()
client.config.update(config)

client.file.list(path)
client.file.read(path)
client.file.write(path, content)
client.file.delete(path)

client.git.status()
client.git.branch()
client.git.diff(ref)

client.event.stream()
```

## Testing

### Unit Tests

```typescript
import { test, expect } from 'bun:test'
import { createOpencodeClient } from './client'

test('creates client with default options', () => {
  const client = createOpencodeClient()
  expect(client).toBeDefined()
})

test('creates session', async () => {
  const client = createOpencodeClient()
  const session = await client.session.create()
  expect(session.id).toBeDefined()
})
```

### Integration Tests

```typescript
import { test, expect } from 'bun:test'
import { createOpencodeClient } from './client'

test('full message flow', async () => {
  const client = createOpencodeClient()

  // Create session
  const session = await client.session.create()

  // Send message
  const chunks = []
  for await (const chunk of client.message.stream(session.id, {
    content: 'Hello'
  })) {
    chunks.push(chunk)
  }

  // Verify response
  expect(chunks.length).toBeGreaterThan(0)
  expect(chunks[chunks.length - 1].type).toBe('done')
})
```

## Dependencies

- No runtime dependencies (minimal bundle size)
- TypeScript for type definitions
- Compatible with Node.js, Bun, Deno, browsers

## Versioning

The SDK version matches the OpenCode server version:
- Same major.minor version = compatible
- Patch versions may differ
- Breaking changes increment major version

## Common Issues

### CORS Errors
- Ensure server allows your origin
- Check CORS configuration in server

### Type Mismatches
- Regenerate SDK after server changes
- Ensure SDK and server versions match

### Streaming Issues
- Check browser/runtime supports async iterators
- Verify fetch implementation supports streaming

## Related Documentation

- Root guide: `../../../CLAUDE.md`
- Server API: `../../opencode/src/server/`
- App integration: `../../app/src/lib/api.ts`
- Desktop integration: `../../desktop/src/`

---

The SDK is the primary way to interact with OpenCode programmatically. Keep it in sync with the server API by regenerating after API changes.
