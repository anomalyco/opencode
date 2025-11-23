# Server Component

The Server component is the core of OpenCode's architecture, providing HTTP API, WebSocket communication, and coordinating all system interactions.

## Architecture Overview

```
┌─────────────────┐    HTTP/WS     ┌─────────────────┐
│   Clients       │ ◄─────────────►│   Server API    │
│ (CLI/TUI/Web)   │                │   (Hono)        │
└─────────────────┘                └─────────────────┘
                                           │
                              ┌────────────┴────────────┐
                              │                         │
                              ▼                         ▼
                      ┌─────────────────┐    ┌─────────────────┐
                      │   Session       │    │   Event Bus     │
                      │ Management      │    │                 │
                      └─────────────────┘    └─────────────────┘
                              │                       │
                              ▼                       ▼
                      ┌─────────────────┐    ┌─────────────────┐
                      │   Storage       │    │   AI Providers  │
                      │   Layer         │    │                 │
                      └─────────────────┘    └─────────────────┘
```

## Core Files

### Main Server (`packages/opencode/src/server/server.ts`)

- **Framework**: Hono.js for HTTP routing and middleware
- **Features**: REST API, WebSocket streaming, CORS, error handling
- **Size**: ~2000+ lines of comprehensive API implementation

### Key Components

- **`server.ts`** - Main HTTP server with all routes
- **`tui.ts`** - TUI-specific routes and controls
- **`project.ts`** - Project management endpoints

## API Structure

### Core Routes

#### Session Management

```typescript
GET    /session              // List all sessions
POST   /session              // Create new session
GET    /session/:id          // Get session details
DELETE /session/:id          // Delete session
POST   /session/:id/prompt   // Send message to session
POST   /session/:id/command  // Execute command in session
```

#### Message Handling

```typescript
GET    /session/:id/message     // Get session messages
GET    /session/:id/message/:id // Get specific message
POST   /session/:id/message     // Create new message
```

#### Real-time Events

```typescript
GET / event // Server-sent events stream
GET / global / event // Global event stream
POST / tui / publish // Publish TUI events
```

#### Configuration

```typescript
GET / config // Get configuration
PATCH / config // Update configuration
GET / config / providers // List AI providers
```

### Tool and Integration Routes

#### Tool System

```typescript
GET / experimental / tool / ids // List all tool IDs
GET / experimental / tool // List tools with schemas
```

#### File Operations

```typescript
GET / file // List files
GET / file / content // Read file content
GET / file / status // Get file status
GET / find // Search text in files
GET / find / file // Find files by pattern
```

#### LSP Integration

```typescript
GET / lsp // Get LSP server status
GET / find / symbol // Find workspace symbols
```

## Middleware Stack

### Request Processing Pipeline

```typescript
app.use(cors()) // CORS handling
app.use(validator()) // Input validation
app.use(instanceMiddleware()) // Project context
app.use(loggingMiddleware()) // Request logging
app.use(errorHandler()) // Error handling
```

### Instance Middleware

```typescript
// Provides project-specific context
app.use(async (c, next) => {
  const directory = c.req.query("directory") ?? process.cwd()
  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: () => next(),
  })
})
```

## WebSocket and Streaming

### Server-Sent Events (SSE)

```typescript
// Real-time event streaming
return streamSSE(c, async (stream) => {
  const unsub = Bus.subscribeAll(async (event) => {
    await stream.writeSSE({
      data: JSON.stringify(event),
    })
  })

  stream.onAbort(() => {
    unsub()
  })
})
```

### Response Streaming

```typescript
// Stream AI responses
return stream(c, async (stream) => {
  const msg = await SessionPrompt.prompt({ ... })
  stream.write(JSON.stringify(msg))
})
```

## Error Handling

### Global Error Handler

```typescript
app.onError((err, c) => {
  log.error("failed", { error: err })

  if (err instanceof NamedError) {
    const status = getErrorStatus(err)
    return c.json(err.toObject(), { status })
  }

  return c.json(new NamedError.Unknown({ message: err.toString() }).toObject(), { status: 500 })
})
```

### Error Types

- **Storage.NotFoundError** (404)
- **Provider.ModelNotFoundError** (400)
- **NamedError** (500)
- **Validation Errors** (400)

## Authentication & Security

### Authentication Methods

```typescript
PUT /auth/:id  // Set provider credentials
```

### Permission System

```typescript
POST /session/:id/permissions/:permissionID
// Response: { response: "once" | "always" | "reject" }
```

### Security Headers

```typescript
// CORS configuration
app.use(
  cors({
    origin: ["http://localhost:*", "https://*.opencode.ai"],
    credentials: true,
  }),
)
```

## OpenAPI Documentation

### Auto-generated Docs

```typescript
// OpenAPI route handler
app.get(
  "/doc",
  openAPIRouteHandler(app, {
    documentation: {
      title: "opencode",
      version: "0.0.3",
      description: "opencode api",
    },
    openapi: "3.1.1",
  }),
)
```

### Schema Validation

```typescript
// Zod-based validation
validator("json", Session.Info.schema)
validator("param", z.object({ id: z.string() }))
```

## Performance Features

### Connection Management

- **Connection pooling** for AI providers
- **Streaming responses** for real-time updates
- **Lazy loading** of heavy components

### Caching

- **Model caching** for AI providers
- **Tool registration** caching
- **Configuration** caching

### Resource Management

```typescript
// Instance disposal
POST / instance / dispose
// Cleanup resources and connections
```

## TUI Integration

### TUI-specific Routes

```typescript
// TUI control endpoints
POST / tui / append - prompt // Add to prompt
POST / tui / submit - prompt // Submit prompt
POST / tui / clear - prompt // Clear prompt
POST / tui / execute - command // Execute TUI command
POST / tui / show - toast // Show notification
```

### TUI Event System

```typescript
// Event publishing to TUI
await Bus.publish(TuiEvent.CommandExecute, {
  command: "session.list",
})
```

## Plugin System Integration

### Plugin Hooks

```typescript
// Tool execution hooks
await Plugin.trigger("tool.execute.before", { tool, sessionID }, { args })
await Plugin.trigger("tool.execute.after", { tool, sessionID }, result)

// Chat parameter hooks
const params = await Plugin.trigger("chat.params", context, defaultParams)
```

## Monitoring & Logging

### Request Logging

```typescript
app.use(async (c, next) => {
  const timer = log.time("request", {
    method: c.req.method,
    path: c.req.path,
  })

  await next()

  timer.stop()
})
```

### Health Checks

```typescript
// Server health endpoint
GET / health // Returns server status
```

## Configuration Management

### Dynamic Configuration

```typescript
GET / config // Get current config
PATCH / config // Update config
```

### Provider Configuration

```typescript
GET /provider/auth           // Get auth methods
POST /provider/:id/oauth    // OAuth flow
```

## Deployment Considerations

### Environment Variables

- `PORT` - Server port (default: random)
- `HOSTNAME` - Bind address (default: 127.0.0.1)
- `LOG_LEVEL` - Logging verbosity

### Cloudflare Workers Integration

- **Durable Objects** for session state
- **KV Storage** for configuration
- **Workers** for serverless deployment

## Development Tools

### API Testing

```bash
# Start local server
opencode spawn --port 4096

# Test endpoints
curl http://localhost:4096/session
curl http://localhost:4096/config
```

### Debug Mode

```bash
opencode --log-level DEBUG run "test"
```

The Server component is the heart of OpenCode, providing a robust, scalable API that coordinates all system components while maintaining security and performance.
