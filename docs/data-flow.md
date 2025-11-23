# Data Flow

This document describes how data flows through the OpenCode system, from user input to AI response and back.

## Overview

OpenCode follows a request-response pattern with real-time streaming capabilities. Data flows through multiple layers: client interfaces, server API, session management, AI providers, and tool execution.

## Core Data Flow Diagram

```
┌─────────────┐    Request     ┌─────────────┐    Process    ┌─────────────┐
│   Client    │ ─────────────► │   Server    │ ────────────► │   Session   │
│ (CLI/TUI)   │                │   (Hono)    │               │ Management  │
└─────────────┘                └─────────────┘               └─────────────┘
      ▲                                │                              │
      │                                │                              │
      │                    Response    │                              │
      │◄───────────────────────────────┘                              │
      │                                                               │
      │                     Tool Execution                            │
      │                     ┌─────────────┐                           │
      │                     │   Tools     │                           │
      │                     │ Registry    │                           │
      │                     └─────────────┘                           │
      │                              │                                │
      │                              ▼                                │
      │                     ┌─────────────┐                           │
      │                     │   AI        │                           │
      │                     │ Provider    │                           │
      │                     └─────────────┘                           │
      │                               │                               │
      └───────────────────────────────┘                               │
                                                                      ▼
                                                               ┌─────────────┐
                                                               │   Storage   │
                                                               │   Layer     │
                                                               └─────────────┘
```

## Detailed Flow Breakdown

### 1. User Input Processing

#### CLI Flow

```typescript
// packages/opencode/src/cli/cmd/run.ts
userInput → parseArguments() → createSession() → executePrompt()
```

#### TUI Flow

```typescript
// packages/opencode/src/cli/cmd/tui/
userInput → promptComponent → sdk.session.prompt() → streamResponse()
```

### 2. Server Request Handling

```typescript
// packages/opencode/src/server/server.ts
HTTP Request → middleware() → routeHandler() → SessionPrompt.prompt()
```

**Request Pipeline:**

1. **Authentication**: Verify user/session
2. **Validation**: Validate input parameters
3. **Authorization**: Check permissions
4. **Processing**: Handle business logic
5. **Response**: Return result or stream

### 3. Session Management Flow

```typescript
// packages/opencode/src/session/prompt.ts
SessionPrompt.prompt() → createUserMessage() → loop() → processAIResponse()
```

**Session Lifecycle:**

1. **Creation**: New session with unique ID
2. **Message Storage**: Store user message and parts
3. **AI Processing**: Send to AI provider
4. **Response Handling**: Process AI response and tools
5. **Persistence**: Save to storage
6. **Event Publishing**: Notify connected clients

### 4. AI Provider Integration

```typescript
// packages/opencode/src/provider/
Provider.getModel() → streamText() → toolExecution → responseStream
```

**AI Flow:**

1. **Model Selection**: Choose appropriate model
2. **Prompt Construction**: Build system + user messages
3. **Tool Registration**: Register available tools
4. **Streaming**: Stream response chunks
5. **Tool Calls**: Execute tools when requested
6. **Response Assembly**: Combine text and tool results

### 5. Tool Execution Flow

```typescript
// packages/opencode/src/tool/
ToolRegistry.tools() → tool.execute() → permissionCheck() → result
```

**Tool Execution:**

1. **Discovery**: Find tool by ID
2. **Validation**: Validate parameters
3. **Permission**: Check user permissions
4. **Execution**: Run tool logic
5. **Result**: Return structured result
6. **Logging**: Log execution for audit

## Real-time Data Flow

### WebSocket Communication

```typescript
// Server-side
Bus.subscribeAll() → streamSSE() → clientUpdates

// Client-side
eventSource.onmessage() → updateUI() → displayResponse()
```

**Event Types:**

- `message.part.updated` - Tool execution updates
- `session.error` - Error notifications
- `session.idle` - Session completion
- `permission.updated` - Permission requests

### Streaming Response Flow

```
AI Provider → Stream Chunks → Tool Execution → Event Bus → Client Display
```

1. **Token Streaming**: AI response tokens arrive
2. **Tool Detection**: Identify tool calls in stream
3. **Parallel Execution**: Run tools concurrently
4. **Result Integration**: Merge tool results into response
5. **UI Updates**: Update client in real-time

## Data Structures

### Message Flow

```typescript
// User Message
{
  id: string,
  role: "user",
  sessionID: string,
  parts: [
    { type: "text", text: "..." },
    { type: "file", url: "file://...", filename: "..." }
  ]
}

// Assistant Response
{
  id: string,
  role: "assistant",
  sessionID: string,
  parts: [
    { type: "text", text: "..." },
    { type: "tool", tool: "bash", state: {...} }
  ]
}
```

### Tool Execution Flow

```typescript
// Tool Call
{
  id: string,
  tool: "read",
  state: {
    status: "running",
    input: { filePath: "..." },
    time: { start: timestamp }
  }
}

// Tool Result
{
  id: string,
  tool: "read",
  state: {
    status: "completed",
    output: "file content",
    time: { end: timestamp }
  }
}
```

## Storage Flow

### Data Persistence

```
Session Data → Storage Layer → File System / Cloud Storage
```

**Storage Hierarchy:**

```
project/
├── .opencode/
│   ├── session/
│   │   └── {sessionID}/
│   │       ├── info.json
│   │       ├── message/
│   │       │   └── {messageID}.json
│   │       └── part/
│   │           └── {partID}.json
│   └── config.json
```

### Session State Management

```typescript
// packages/opencode/src/session/index.ts
Session.create() → Storage.write() → Bus.publish(Event.Created)
Session.update() → Storage.update() → Bus.publish(Event.Updated)
Session.get() → Storage.read() → return session data
```

## Error Handling Flow

### Error Propagation

```
Tool Error → Session Error → Client Notification → User Display
```

**Error Types:**

1. **Tool Errors**: Invalid parameters, execution failures
2. **Provider Errors**: API failures, rate limits
3. **Permission Errors**: Access denied, confirmation required
4. **System Errors**: Storage issues, network problems

### Error Recovery

```typescript
try {
  await tool.execute(args)
} catch (error) {
  // Log error
  Log.error("tool.execution", { error, tool, args })

  // Publish error event
  Bus.publish(Session.Event.Error, { sessionID, error })

  // Return error response
  return { status: "error", message: error.message }
}
```

## Performance Optimizations

### 1. Streaming

- Real-time response display
- Parallel tool execution
- Chunked data transfer

### 2. Caching

- Model response caching
- File content caching
- Tool result caching

### 3. Lazy Loading

- Tool initialization on demand
- Provider connection pooling
- Session data pagination

### 4. Compaction

- Session history compaction
- Message summarization
- Storage cleanup

## Security Flow

### Permission Checking

```
User Request → Permission Check → Tool Execution → Result
```

**Permission Levels:**

- **allow**: Automatic execution
- **ask**: User confirmation required
- **deny**: Execution blocked

### Data Sanitization

```typescript
// Input validation
tool.parameters.parse(args)

// Path sanitization
filePath = path.resolve(Instance.directory, filePath)

// Command sanitization
if (!allowedCommands.includes(command)) {
  throw new PermissionError("Command not allowed")
}
```

## Monitoring and Observability

### Logging Flow

```
Component Action → Log Entry → Structured Storage → Analysis
```

**Log Categories:**

- `session`: Session lifecycle events
- `tool`: Tool execution
- `server`: HTTP requests
- `provider`: AI provider interactions

### Metrics Collection

```typescript
// Usage tracking
Session.getUsage() → cost calculation → storage

// Performance monitoring
timer = Log.time("operation") → timer.stop() → metrics
```

This data flow design enables OpenCode to provide responsive, real-time AI assistance while maintaining security, reliability, and extensibility.
