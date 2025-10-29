# OpenCode Architecture Diagram and Component Relationships

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      User Interfaces                             │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│   CLI        │     TUI      │   Console    │   Desktop          │
│  (Yargs)     │    (Go)      │   (Webapp)   │  (Tauri)           │
└──────────────┴──────────────┴──────────────┴────────────────────┘
         │              │             │              │
         └──────────────┴─────────────┴──────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────────┐
│              Hono HTTP Server (Port 3000)                        │
│                   REST + SSE + WebSocket                         │
├──────────────────────────────────────────────────────────────────┤
│ API Routes:                                                      │
│  /session        /session/:id/message      /config              │
│  /project        /experimental/tool        /auth                │
└──────────────────────────────────────────────────────────────────┘
         │              │              │              │
         ↓              ↓              ↓              ↓
    ┌─────────────────────────────────────────────────────┐
    │         Core Business Logic (Pure Functions)       │
    ├─────────────────────────────────────────────────────┤
    │ • Session Management        • Agent System          │
    │ • SessionPrompt (Agent Loop)• Tool Registry         │
    │ • Message Handling          • Provider/Model Select │
    │ • Permission System         • Configuration Loading │
    └─────────────────────────────────────────────────────┘
         │              │              │              │
         ↓              ↓              ↓              ↓
    ┌─────────────────────────────────────────────────────┐
    │            Infrastructure & External APIs           │
    ├─────────────────────────────────────────────────────┤
    │ • File System Storage      • LLM Providers          │
    │ • Git Integration          • Language Servers (LSP) │
    │ • Event Bus (Pub/Sub)      • Code Search (Ripgrep)  │
    │ • File Watching            • Web Fetching           │
    └─────────────────────────────────────────────────────┘
```

## Detailed Component Map

### 1. API Layer (Entry Point: server.ts)
```
Hono Server
├── Middleware
│   ├── Error handling (NamedError)
│   ├── CORS
│   ├── Request logging
│   ├── Directory context provider
│   └── Authentication
├── Routes (OpenAPI documented)
│   ├── Session Management
│   │   ├── GET /session
│   │   ├── POST /session
│   │   ├── GET/PATCH/DELETE /session/:id
│   │   └── Message sub-routes
│   ├── Configuration
│   │   ├── GET /config
│   │   └── PATCH /config
│   ├── Tools
│   │   ├── GET /experimental/tool/ids
│   │   └── GET /experimental/tool (with schemas)
│   ├── Agents
│   │   └── POST /experimental/agent/:id
│   ├── Projects
│   │   ├── File operations
│   │   ├── Search functionality
│   │   └── Project info
│   └── Path info
└── Response Format
    ├── Success: {success: true, data: T}
    ├── Error: {success: false, errors: [...]}
    └── Zod-validated schemas
```

### 2. Session Management Layer

```
Session Module (index.ts)
├── Session Info Schema
│   ├── id, projectID, directory
│   ├── title, version
│   ├── time (created, updated, compacting)
│   ├── parentID (for child sessions)
│   └── share/revert metadata
├── Session CRUD
│   ├── create() → new session with ID
│   ├── createNext() → with auto-share
│   ├── fork() → branch from message
│   ├── touch() → update timestamp
│   ├── read() → from storage
│   ├── update() → modify session
│   ├── delete() → remove session
│   └── list() → all sessions
├── Events
│   ├── Session.Created
│   ├── Session.Updated
│   ├── Session.Deleted
│   └── Session.Error
└── Storage Integration
    └── Persists to: ~/.opencode/storage/session/{projectID}/*.json
```

### 3. Agent Loop (SessionPrompt.ts - CRITICAL)

```
SessionPrompt.prompt(input: PromptInput)
├── Input Validation
│   ├── sessionID
│   ├── messageID (optional, for continuation)
│   ├── model selection (provider/modelID)
│   ├── agent selection
│   └── system prompt override
├── System Context Building
│   ├── Load agent configuration
│   ├── Load permission rules
│   ├── Build system prompt
│   ├── Get available tools
│   └── Format conversation history
├── LLM Call (Vercel AI SDK)
│   ├── streamText() or generateText()
│   ├── Tool definitions from ToolRegistry
│   ├── Stream response handling
│   └── Token counting
├── Tool Execution Loop
│   ├── Intercept tool_use events
│   ├── Execute tool with sandbox isolation
│   ├── Get tool result
│   ├── Build assistant message
│   └── Continue if needed
├── Message Storage
│   ├── Save assistant messages
│   ├── Save tool execution results
│   ├── Save message parts
│   └── Update session timestamp
└── Response
    └── Stream parts: text chunks, tool results, completion
```

### 4. Tool Registry & Execution

```
ToolRegistry (registry.ts)
├── Built-in Tools (always available)
│   ├── bash (BashTool)
│   │   └── Execute shell commands
│   ├── edit (EditTool)
│   │   └── Structured file edits
│   ├── read (ReadTool)
│   │   └── File content reading
│   ├── write (WriteTool)
│   │   └── File creation/overwrite
│   ├── glob (GlobTool)
│   │   └── File pattern matching
│   ├── grep (GrepTool)
│   │   └── Code searching
│   ├── ls (ListTool)
│   │   └── Directory listing
│   ├── patch (PatchTool)
│   │   └── Diff application
│   ├── webfetch (WebFetchTool)
│   │   └── Web content retrieval
│   ├── todo (TodoWrite/TodoRead)
│   │   └── Todo management
│   └── task (TaskTool)
│       └── Background task execution
├── Custom Tools (dynamic loading)
│   ├── From /tool/ directories
│   ├── From plugins
│   └── Runtime registration
├── Tool Interface
│   ├── Schema (Zod)
│   ├── Description
│   ├── execute(args, context)
│   └── Result format
└── Tool Filtering
    ├── By agent permissions
    ├── By enabled/disabled
    └── By provider/model support
```

### 5. Provider System (Multi-LLM Support)

```
Provider.ts
├── Supported Providers
│   ├── Anthropic (Claude)
│   ├── OpenAI (GPT-4, etc.)
│   ├── Google (Gemini)
│   ├── AWS Bedrock
│   ├── Azure OpenAI
│   └── OpenCode (proprietary)
├── Model Registry
│   ├── Model ID
│   ├── Provider ID
│   ├── Capabilities (vision, function_calling, etc.)
│   ├── Cost (input/output per token)
│   └── Context window
├── Provider Loading
│   ├── Check environment variables
│   ├── Check auth config
│   ├── Custom loaders per provider
│   └── Autoload if credentials present
├── Model Selection
│   ├── From config (default model)
│   ├── From agent config (agent-specific)
│   ├── From CLI flag (override)
│   └── From request (explicit)
└── Integration
    └── Via Vercel AI SDK (provider-agnostic)
```

### 6. Configuration System

```
Config.ts
├── Config Sources (merged in order)
│   ├── Global config (~/.opencode/config.json)
│   ├── Project config (opencode.json/jsonc)
│   ├── Environment variables
│   ├── .opencode/ directory
│   ├── Flag overrides
│   └── CLI config content
├── Config Schema
│   ├── Agents
│   │   ├── name
│   │   ├── description
│   │   ├── model {providerID, modelID}
│   │   ├── system prompt
│   │   ├── tools {name: bool}
│   │   ├── permission rules
│   │   └── options (temperature, etc.)
│   ├── Tools
│   │   └── Per-tool enable/disable
│   ├── Permissions
│   │   ├── edit: allow/deny/ask
│   │   ├── bash: pattern rules
│   │   └── webfetch: allow/deny/ask
│   ├── Plugins
│   │   └── List of plugin locations
│   └── Other settings
│       ├── Username
│       ├── Model defaults
│       ├── Share settings
│       └── Keybindings (TUI)
└── Storage
    └── ~/.opencode/config/ directory
```

### 7. Storage Layer

```
Storage.ts (File-based)
├── Directories
│   ├── ~/. opencode/storage/session/{projectID}/
│   │   └── {sessionID}.json
│   ├── ~/. opencode/storage/message/{sessionID}/
│   │   └── {messageID}.json
│   ├── ~/. opencode/storage/part/{messageID}/
│   │   └── {partID}.json
│   └── ~/. opencode/storage/project/
│       └── {projectID}.json (metadata)
├── Operations
│   ├── read(key[]) → parsed JSON
│   ├── write(key[], data) → JSON file
│   ├── update(key[], fn) → read-modify-write
│   ├── remove(key[]) → delete
│   └── list(key[]) → directory listing
├── Migrations
│   └── Upgrade old storage formats
└── Locking
    └── File-level locks for concurrent access
```

### 8. Event System (Bus)

```
Bus.ts (Pub/Sub)
├── Event Publishers
│   ├── Session.Created/Updated/Deleted
│   ├── Session.Error
│   ├── Session.Idle
│   ├── Server.Connected
│   └── Custom events
├── Event Schema
│   ├── Type name
│   ├── Zod schema for data
│   └── Validation on publish/subscribe
├── Subscribers
│   ├── TUI event listeners
│   ├── Server event handlers
│   └── Logging system
└── Usage
    └── Decouples components (TUI, Server, etc.)
```

## Data Flow for Main Use Case: "Run Agent with Message"

```
1. CLI/Webapp User Input
   │
   ↓
2. opencode run "describe this file"
   │
   ↓
3. Yargs/API Router (index.ts or server.ts)
   ├── Validate input
   ├── Parse arguments
   └── Route to command handler
   │
   ↓
4. Command Handler (run.ts)
   ├── Create or get session
   ├── Call SessionPrompt.prompt({sessionID, message, model, agent})
   └── Handle streaming response
   │
   ↓
5. SessionPrompt.prompt()
   ├── Load session from storage
   ├── Get agent config
   ├── Load system prompt
   ├── Get available tools
   ├── Format context (recent messages, files)
   │
   ↓
6. AI SDK StreamText (Vercel)
   ├── POST to LLM API
   ├── Stream response with tool_use events
   │
   ↓
7. Tool Execution Loop
   ├── Receive tool_use event
   │  └── Tool: read, bash, edit, etc.
   │
   ├── Execute tool in sandbox
   │  └── ToolRegistry finds and runs tool
   │
   ├── Capture tool result
   │  ├── Text output
   │  ├── Stderr
   │  ├── Exit code
   │  └── Metadata
   │
   ├── Add to message history
   │
   └── Send result back to LLM
   │
   ↓
8. Message Persistence
   ├── Save assistant message
   ├── Save message parts (text chunks)
   ├── Save tool execution results
   └── Update session.time.updated
   │
   ↓
9. Stream Response to Client
   ├── JSON events for each part
   ├── Tool execution results
   ├── Final completion
   │
   ↓
10. TUI/Webapp Display
    ├── Render messages
    ├── Show tool execution
    └── Update UI state
```

## Files Size and Dependency Map

```
Top 10 Largest Modules (by feature):
1. SessionPrompt.ts (~1500 lines) - Agent loop
2. Server.ts (~800 lines) - API routes
3. Config.ts (~800 lines) - Configuration
4. Session.ts (~500 lines) - Session CRUD
5. Agent.ts (~250 lines) - Agent configuration
6. EditTool.ts (~500 lines) - File editing
7. BashTool.ts (~300 lines) - Command execution
8. Provider.ts (~600 lines) - LLM providers
9. ToolRegistry.ts (~130 lines) - Tool management
10. Storage.ts (~200 lines) - Persistence

Key Dependencies:
- SessionPrompt → Provider, ToolRegistry, Session, Agent, Bus
- Server → Session, SessionPrompt, ToolRegistry, Config, Provider
- Agent → Config, Provider
- Provider → Config, Auth
- ToolRegistry → Config, Plugin
- Storage → Global, Filesystem utilities
- Config → Auth, Plugin, Filesystem utilities
```

## Critical Data Structures

```typescript
// Session represents a conversation thread
Session.Info = {
  id: string,              // session_xxxxx
  projectID: string,       // git root hash
  directory: string,       // working directory
  title: string,           // user-facing name
  version: string,         // opencode version
  time: {
    created: number,       // timestamp
    updated: number,       // last activity
    compacting?: number    // during compaction
  },
  parentID?: string,       // for child sessions
  share?: {url: string},   // sharing link
  summary?: {
    diffs: FileDiff[]      // high-level changes
  }
}

// Message represents one turn in conversation
MessageV2.Base = {
  id: string,              // message_xxxxx
  sessionID: string,
  role: "user" | "assistant",
  time: number,
  source: "chat" | "inference"
}

// Assistant message with tool execution
MessageV2.Assistant = {
  ...Base,
  role: "assistant",
  parts: Part[],           // text/tool_use/tool_result
  usage?: {
    input: number,
    output: number,
    cache_read?: number,
    cache_creation?: number
  },
  error?: Error
}

// Message Part is atomic unit of response
MessageV2.Part = 
  | {type: "text", text: string}
  | {type: "tool_use", id: string, name: string, input: unknown}
  | {type: "tool_result", tool_use_id: string, result: unknown}
```

## Key Insight for Webapp Conversion

**The entire core logic is independent of UI:**
- All business logic in `Session`, `SessionPrompt`, `Agent`, `Tool*`, `Provider`
- Storage layer is file-based and portable
- Event system can emit to WebSocket instead of TUI
- API is already HTTP-based
- Only `cli/`, `ui.ts`, and TUI-specific code needs to change

**What stays the same:**
- Session model
- Agent configuration
- Tool registry
- Provider system
- Storage format
- Session/message schemas

**What changes:**
- Input parsing (Yargs → HTTP)
- Output rendering (CLI/TUI → HTML/JSON)
- Real-time communication (process → WebSocket/SSE)
- Authentication mechanism (env vars → web tokens)

