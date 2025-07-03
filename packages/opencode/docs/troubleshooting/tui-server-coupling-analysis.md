# TUI-Server Coupling Analysis for OpenCode

## Architecture Overview

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Terminal UI (Go)  │ ←──→│  TypeScript Server   │ ←──→│  AI Providers   │
│   (Bubble Tea)      │     │      (Hono)          │     │ (Anthropic etc) │
└─────────────────────┘     └──────────────────────┘     └─────────────────┘
          ↓                           ↓                           ↓
    ┌──────────┐              ┌─────────────┐           ┌──────────────┐
    │ Go Client│              │  REST API   │           │ Tool System  │
    │   (SDK)  │              │ + SSE Events│           │ (File, Web)  │
    └──────────┘              └─────────────┘           └──────────────┘
```

## Communication Protocol

### 1. **Client-Server Connection**
- **Protocol**: HTTP/REST + Server-Sent Events (SSE)
- **Server Location**: Dynamically allocated on localhost (port 0)
- **Environment Variable**: `OPENCODE_SERVER` passed to TUI process

### 2. **API Endpoints** (from server.ts)
- `GET /event` - SSE event stream
- `GET /app` - App information
- `POST /app/init` - Initialize app
- `GET /config` - Configuration info
- `GET /session` - List sessions
- `POST /session` - Create session
- `DELETE /session/:id` - Delete session
- `POST /session/:id/init` - Initialize session
- `POST /session/:id/abort` - Abort session
- `POST /session/:id/share` - Share session
- `DELETE /session/:id/share` - Unshare session
- `POST /session/:id/summarize` - Summarize session
- `GET /session/:id/message` - List messages
- `POST /session/:id/message` - Send message
- `GET /config/providers` - List providers
- `GET /file` - Search files

### 3. **Event System**
- Uses SSE for real-time updates
- Events are published via the Bus system
- TUI subscribes to all events via `/event` endpoint
- Event types include:
  - `session.updated`
  - `session.deleted`
  - `session.idle`
  - `session.error`
  - `message.updated`
  - `installation.updated`

## Coupling Analysis

### Areas of **Loose Coupling** ✅

1. **Clean API Separation**
   - Server provides RESTful API with OpenAPI specs
   - Uses standard HTTP/SSE protocols
   - API is documented and type-safe

2. **SDK-Based Communication**
   - TUI uses `opencode-sdk-go` for API calls
   - SDK is auto-generated from OpenAPI specs
   - Clear contract between client and server

3. **Event-Driven Architecture**
   - Pub/sub model via Bus system
   - Events are well-typed with Zod schemas
   - TUI reacts to events, doesn't poll

4. **No TUI-Specific Server Logic**
   - Server endpoints are generic
   - No terminal-specific rendering in server
   - Server returns data, not UI elements

### Areas of **Tight Coupling** ⚠️

1. **Process Management**
   - TUI is spawned as subprocess by TypeScript
   - Server lifecycle tied to TUI process
   - Environment variables passed directly

2. **Local-Only Architecture**
   - Server binds to localhost only
   - No authentication/authorization layer
   - Assumes single-user, local access

3. **Shared Configuration**
   - Both components share configuration files
   - State management spread across both sides

## Web Client Feasibility

### **Positive Factors** ✅

1. **RESTful API Ready**
   - All functionality exposed via HTTP
   - OpenAPI specs available for SDK generation
   - Standard JSON payloads

2. **Event System Compatible**
   - SSE works in browsers natively
   - Events are JSON-serializable
   - No binary protocols

3. **Clean Separation of Concerns**
   - Server handles business logic
   - Client handles presentation
   - Tool execution on server side

### **Challenges** ⚠️

1. **Authentication Required**
   - Current architecture assumes local access
   - Need auth layer for web deployment
   - API key management needed

2. **Security Considerations**
   - File system access via web
   - Command execution permissions
   - Need sandboxing/restrictions

3. **State Management**
   - Currently uses local file system
   - Would need database for multi-user
   - Session isolation required

## Recommendations for Web Client

### 1. **Minimal Changes Required**
```typescript
// Add authentication middleware
app.use('/api/*', authMiddleware)

// Add CORS for web access
app.use(cors({
  origin: process.env.WEB_CLIENT_URL
}))

// Add rate limiting
app.use('/api/*', rateLimiter)
```

### 2. **Architecture Adjustments**
```
┌─────────────────┐     ┌──────────────────────┐
│   Web Client    │ ←──→│   API Gateway        │
│   (React/Vue)   │     │   + Auth Layer       │
└─────────────────┘     └──────────────────────┘
                                 ↓
                        ┌──────────────────────┐
                        │  OpenCode Server     │
                        │  (Multi-tenant)      │
                        └──────────────────────┘
```

### 3. **Implementation Path**
1. **Phase 1**: Extract server as standalone service
2. **Phase 2**: Add authentication/authorization
3. **Phase 3**: Implement web client using existing API
4. **Phase 4**: Add multi-tenancy support

## Conclusion

The OpenCode architecture shows **good separation** between TUI and server components. The server provides a **clean REST API** that could easily support a web client. The main work required would be:

1. Adding authentication/authorization
2. Implementing proper security boundaries
3. Converting from single-user to multi-user architecture
4. Building the web UI components

The existing API design and event system would work well for a web-based client with minimal modifications to the server.