# OpenCode Design Documentation

## Project Brief

OpenCode is an open-source AI-powered development tool designed to be the definitive coding assistant for developers. It provides an intelligent agent system that can understand codebases, execute tasks, and assist with development through multiple interfaces.

### Vision

To create a provider-agnostic, extensible, and powerful AI coding assistant that respects developers' workflows and provides flexibility through:
- **Multiple Interfaces**: CLI/TUI, desktop app, web interface, and future mobile support
- **Provider Freedom**: Works with any AI provider (Claude, OpenAI, Google, local models)
- **Extensibility**: Comprehensive plugin and tool systems
- **Terminal-First**: Advanced TUI experience built by terminal enthusiasts
- **Client-Server Architecture**: Enables remote operation and multiple clients

### Core Values

1. **Open Source**: 100% open source with MIT license
2. **Developer Control**: No vendor lock-in, full customization
3. **Performance**: Fast, efficient, and responsive
4. **Extensibility**: Plugin system for unlimited customization
5. **Community-Driven**: Built with and for the developer community

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Clients Layer                         │
├──────────────┬──────────────┬──────────────┬────────────────┤
│   CLI/TUI    │  Desktop App │   Web App    │  Mobile (Soon) │
│  (opentui)   │   (Tauri)    │  (SolidJS)   │                │
└──────┬───────┴──────┬───────┴──────┬───────┴────────┬───────┘
       │              │              │                │
       └──────────────┴──────────────┴────────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │    OpenCode Server (Hono)   │
         │  - RESTful API              │
         │  - WebSocket/SSE Streaming  │
         │  - OpenAPI Documentation    │
         └──────────────┬──────────────┘
                        │
         ┏━━━━━━━━━━━━━┻━━━━━━━━━━━━━┓
         ▼                            ▼
┌────────────────────┐      ┌────────────────────┐
│   Agent System     │      │   Session Manager  │
│  - build agent     │      │  - SQLite storage  │
│  - plan agent      │      │  - File snapshots  │
│  - general agent   │      │  - AI summarization│
│  - explore agent   │      │  - Fork/revert     │
└─────────┬──────────┘      └─────────┬──────────┘
          │                           │
          ▼                           ▼
┌────────────────────┐      ┌────────────────────┐
│   Tool System      │      │  Provider Manager  │
│  - 20+ built-in    │      │  - Multi-provider  │
│  - Custom tools    │      │  - OAuth support   │
│  - MCP tools       │      │  - Model config    │
│  - Plugin tools    │      │  - Fallbacks       │
└─────────┬──────────┘      └─────────┬──────────┘
          │                           │
          ▼                           ▼
┌────────────────────────────────────────────────┐
│            Infrastructure Layer                │
│  - File System (Git-aware)                     │
│  - LSP Integration (Multi-language)            │
│  - Config System (Hierarchical)                │
│  - Plugin System (Hook-based)                  │
└────────────────────────────────────────────────┘
```

## Core Systems Design

### 1. Agent System

The agent system is the brain of OpenCode, orchestrating AI interactions and tool usage.

#### Agent Architecture

```typescript
interface Agent {
  id: string                      // Unique identifier
  name: string                    // Display name
  description: string             // Agent purpose
  model?: string                  // Preferred model
  permissions: AgentPermissions   // Tool access control
  systemPrompt: string            // Agent instructions
  temperature?: number            // Sampling temperature
  topP?: number                   // Nucleus sampling
}

interface AgentPermissions {
  tools: {
    [toolName: string]: 'allow' | 'deny' | 'ask'
  }
  defaultPermission: 'allow' | 'deny' | 'ask'
}
```

#### Built-in Agents

1. **build** (Default Development Agent)
   - Full file system access
   - Can execute bash commands
   - All tools enabled
   - High autonomy

2. **plan** (Read-Only Planning Agent)
   - Read-only file access
   - Asks before running commands
   - Ideal for exploration
   - Safety-focused

3. **general** (Multi-Step Subagent)
   - Used internally for complex tasks
   - Research and execution
   - Spawned by main agents

4. **explore** (Fast Search Agent)
   - Codebase exploration
   - Pattern matching
   - Quick searches

#### Agent Runner Flow

```
User Message → Agent Runner
    ↓
Select Agent (build/plan)
    ↓
Build Context (files, git, config)
    ↓
Call AI Provider with Tools
    ↓
Stream Response Parts:
    - Text content
    - Tool calls
    - Thinking process
    ↓
Execute Tools (with permissions)
    ↓
Append Tool Results
    ↓
Continue until completion
    ↓
Save to Session
```

### 2. Tool System

Tools are the hands of OpenCode, enabling the AI to interact with the development environment.

#### Tool Architecture

```typescript
interface Tool {
  name: string
  description: string
  parameters: JSONSchema
  execute: (input: unknown) => Promise<ToolResult>
  requiresPermission?: boolean
  category?: 'file' | 'shell' | 'search' | 'ai' | 'custom'
}

interface ToolResult {
  content: string
  error?: string
  metadata?: Record<string, unknown>
}
```

#### Built-in Tool Categories

1. **File Operations**
   - `read`: Read file contents
   - `write`: Create/overwrite files
   - `edit`: Patch existing files
   - `list`: Directory listing
   - `glob`: Pattern matching
   - `grep`: Content search

2. **Development Tools**
   - `bash`: Execute shell commands
   - `lsp`: Language server operations
   - `multiedit`: Batch file editing

3. **AI-Powered Tools**
   - `task`: Spawn subagent tasks
   - `websearch`: Web search
   - `codesearch`: GitHub code search
   - `todowrite`/`todoread`: Task management

4. **Integration Tools**
   - Custom plugin tools
   - MCP (Model Context Protocol) tools
   - Project-specific tools

#### Tool Permission System

```
Tool Call → Check Permissions
    ↓
Permission Type:
    - 'allow': Execute immediately
    - 'deny': Reject with error
    - 'ask': Prompt user for approval
    ↓
Execute Tool → Return Result
```

### 3. Session Management

Sessions maintain conversation context and state across interactions.

#### Session Architecture

```typescript
interface Session {
  id: string                    // ULID identifier
  agentId: string              // Current agent
  messages: Message[]          // Conversation history
  files: FileSnapshot[]        // Tracked file states
  config: SessionConfig        // Per-session settings
  createdAt: Date
  updatedAt: Date
  parentId?: string            // For forked sessions
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: MessageContent[]    // Multi-part messages
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: Date
}
```

#### Session Lifecycle

```
Create Session
    ↓
User Interaction Loop:
    - Add message
    - Agent processing
    - Tool execution
    - Stream response
    ↓
Background Operations:
    - Save messages to SQLite
    - Track file changes
    - Update snapshots
    ↓
Compaction (when needed):
    - AI summarizes old messages
    - Compress history
    - Maintain context limit
    ↓
Session Operations:
    - Fork: Create branch
    - Revert: Restore files
    - Share: Export session
    - Summarize: Generate summary
```

#### File Snapshot System

```typescript
interface FileSnapshot {
  path: string
  content: string              // File content at snapshot time
  hash: string                 // Content hash for diffing
  timestamp: Date
}
```

Snapshots enable:
- Undo/redo operations
- Session forking
- Diff visualization
- File state restoration

### 4. Provider System

Multi-provider support allows using any AI service.

#### Provider Architecture

```typescript
interface Provider {
  id: string                    // Provider identifier
  name: string                  // Display name
  models: Model[]              // Available models
  authenticate: () => Promise<void>
  listModels: () => Promise<Model[]>
  streamCompletion: (params) => AsyncGenerator<CompletionChunk>
}

interface Model {
  id: string
  name: string
  contextWindow: number
  inputCost: number            // Per million tokens
  outputCost: number
  supportsTools: boolean
  supportsStreaming: boolean
}
```

#### Supported Providers

- **Claude (Anthropic)**: Via Anthropic API
- **OpenAI**: GPT models
- **Google**: Gemini models
- **Groq**: Fast inference
- **Cerebras**: Ultra-fast models
- **OpenRouter**: Multi-provider gateway
- **OpenCode Zen**: Managed service (recommended)
- **Local Models**: Via OpenAI-compatible endpoints

#### OAuth Integration

```
User Initiates Auth
    ↓
Generate OAuth URL
    ↓
Open Browser → Provider Login
    ↓
Callback to Local Server
    ↓
Exchange Code for Token
    ↓
Store Token Securely
    ↓
Ready to Use
```

### 5. TUI Implementation

The Terminal User Interface is built with SolidJS and opentui.

#### TUI Architecture

```
┌─────────────────────────────────────────────────┐
│                  Status Bar                     │
│  Agent | Model | Session | Tokens | Status      │
├─────────────────────────────────────────────────┤
│                                        │ File   │
│                                        │ Tree   │
│         Message Area                   │        │
│         - User messages                │ ├─src  │
│         - AI responses                 │ ├─pkg  │
│         - Tool executions              │ └─doc  │
│         - Streaming content            │        │
│                                        │        │
├─────────────────────────────────────────────────┤
│              Input / Command Area               │
│  > Your message here...                         │
└─────────────────────────────────────────────────┘
```

#### Key TUI Features

1. **Real-time Streaming**: Live AI response rendering
2. **Syntax Highlighting**: Code blocks with language detection
3. **Keyboard Navigation**: Vim-inspired keybindings
4. **File Tree**: Git-aware file browser
5. **Multi-pane Layout**: Flexible panel system
6. **Status Indicators**: Real-time status updates

### 6. Plugin System

Plugins extend OpenCode functionality through hooks.

#### Plugin Architecture

```typescript
interface Plugin {
  name: string
  version: string
  hooks: {
    // Lifecycle hooks
    'server.start'?: () => Promise<void>
    'server.stop'?: () => Promise<void>

    // Event hooks
    'event'?: (event: Event) => Promise<void>

    // Tool hooks
    'tool'?: { [name: string]: ToolDefinition }

    // Message hooks
    'chat.message'?: (input, output) => Promise<void>

    // Permission hooks
    'permission.ask'?: (input, output) => Promise<void>

    // Config hooks
    'config'?: (config: Config) => Promise<void>

    // Auth hooks
    'auth'?: AuthHook
  }
}
```

#### Plugin Loading

```
Application Start
    ↓
Discover Plugins:
    - .opencode/ directory
    - node_modules/@opencode-ai/plugin-*
    - Global plugins
    ↓
Load Plugin Modules
    ↓
Register Hooks
    ↓
Initialize Plugins
    ↓
Plugin Ready
```

## Data Flow

### Message Flow

```
User Input (TUI/API)
    ↓
Create User Message
    ↓
Add to Session
    ↓
Agent Runner:
    1. Load session context
    2. Build system prompt
    3. Prepare tool definitions
    4. Call AI provider
    ↓
Stream Response Parts:
    - text: Display immediately
    - tool_use: Queue tool execution
    - thinking: Optional internal reasoning
    ↓
For Each Tool Call:
    1. Check permissions
    2. Execute tool
    3. Get result
    4. Append to message
    5. Continue streaming
    ↓
Message Complete
    ↓
Save to Session
    ↓
Update UI
```

### Tool Execution Flow

```
Tool Call Received
    ↓
Parse Tool Parameters
    ↓
Validate Against Schema
    ↓
Check Agent Permissions
    ↓
Permission Type:
    - allow: Execute
    - deny: Return error
    - ask: Prompt user → Execute/Deny
    ↓
Execute Tool Function
    ↓
Handle Errors (try/catch)
    ↓
Return Tool Result
    ↓
Stream to Client
```

## Configuration System

### Configuration Hierarchy

```
1. Default Config (Built-in)
    ↓
2. Global Config (~/.config/opencode/config.jsonc)
    ↓
3. Remote Config (.well-known/opencode)
    ↓
4. Project Config (.opencode/opencode.jsonc)
    ↓
5. Environment Variables
    ↓
6. CLI Arguments
    ↓
Final Merged Config
```

### Configuration Schema

```typescript
interface Config {
  agent?: {
    default?: string
    [agentId: string]: AgentConfig
  }
  provider?: {
    default?: string
    [providerId: string]: ProviderConfig
  }
  session?: SessionConfig
  tools?: {
    [toolName: string]: ToolConfig
  }
  ui?: UIConfig
  lsp?: LSPConfig
  git?: GitConfig
  plugins?: string[]
}
```

## API Design

### RESTful API

```
POST   /session                    # Create session
GET    /session/:id                # Get session
DELETE /session/:id                # Delete session
POST   /session/:id/message        # Send message (streaming)
POST   /session/:id/fork           # Fork session
POST   /session/:id/summarize      # Summarize session

GET    /provider                   # List providers
POST   /provider/:id/auth          # Authenticate provider
GET    /provider/:id/models        # List models

GET    /config                     # Get config
PUT    /config                     # Update config

GET    /file                       # List files
GET    /file/:path                 # Read file
PUT    /file/:path                 # Write file

GET    /event                      # Event stream (SSE)
```

### WebSocket/SSE Streaming

```typescript
// Message streaming
POST /session/:id/message
→ Stream response chunks:
    { type: 'text', content: '...' }
    { type: 'tool_use', tool: '...', input: {...} }
    { type: 'tool_result', result: {...} }
    { type: 'done' }

// Event stream
GET /event
→ Server-Sent Events:
    event: session.created
    event: session.updated
    event: tool.executed
    event: file.changed
```

## Security & Permissions

### Permission Model

1. **Agent-Level Permissions**: Define what each agent can do
2. **Tool-Level Permissions**: Control access to specific tools
3. **User Confirmation**: Interactive approval for sensitive operations
4. **Audit Trail**: Log all tool executions
5. **Sandboxing**: Isolate tool execution (future)

### Security Considerations

- **API Authentication**: Token-based auth for remote access
- **File Access Control**: Respect .gitignore and config excludes
- **Command Execution**: Prompt for bash commands in plan agent
- **Secret Detection**: Warn about committing sensitive data
- **Provider Tokens**: Secure storage of API keys

## Performance Considerations

### Optimization Strategies

1. **Lazy Loading**: Load modules and plugins on demand
2. **Caching**: Cache LSP responses, file metadata, git status
3. **Streaming**: Stream responses for immediate feedback
4. **Parallel Execution**: Execute independent tools concurrently
5. **Compaction**: AI-powered session summarization for context management
6. **Incremental Updates**: Only recompute changed state

### Resource Management

- **Memory**: Limit session history, use snapshots sparingly
- **CPU**: Debounce file watchers, throttle LSP requests
- **Network**: Batch API calls, use HTTP/2 multiplexing
- **Disk**: Compress old sessions, prune snapshots

## Testing Strategy

### Test Levels

1. **Unit Tests**: Individual functions and components
2. **Integration Tests**: API endpoints, tool execution
3. **E2E Tests**: Complete user workflows
4. **Performance Tests**: Benchmark critical paths
5. **Manual Testing**: TUI interaction, edge cases

### Testing Tools

- **Bun Test**: Fast test runner
- **Happy DOM**: Browser environment for UI tests
- **MSW**: Mock Service Worker for API mocking
- **Test Fixtures**: Reusable test data and scenarios

## Deployment Architecture

### Distribution Methods

1. **npm Package**: `npm install -g opencode-ai`
2. **Homebrew**: `brew install opencode`
3. **Scoop**: `scoop install opencode` (Windows)
4. **Direct Download**: Platform-specific binaries
5. **Nix**: `nix run nixpkgs#opencode`
6. **Desktop Apps**: DMG (macOS), EXE (Windows), AppImage (Linux)

### Build Process

```
Development
    ↓
Bun Build (Compile + Bundle)
    ↓
Platform-Specific Packaging:
    - macOS: Single binary + DMG
    - Linux: Binary + AppImage/deb/rpm
    - Windows: EXE + installer
    ↓
Sign & Notarize (macOS)
    ↓
Upload to Release
    ↓
Update Package Managers
    ↓
Distribution
```

## Future Considerations

### Planned Features

1. **Mobile App**: iOS and Android clients
2. **Collaborative Sessions**: Multi-user sessions
3. **Voice Interface**: Speech-to-text integration
4. **Custom Agents**: User-defined agent templates
5. **Agent Marketplace**: Share custom agents and tools
6. **Browser Extension**: Web-based code assistance
7. **IDE Plugins**: VS Code, JetBrains integration
8. **Team Features**: Shared sessions, analytics

### Scalability

- **Horizontal Scaling**: Multiple server instances
- **Load Balancing**: Distribute sessions across servers
- **Database Sharding**: Partition sessions by user
- **CDN**: Static asset distribution
- **Caching Layer**: Redis for session state

## Design Principles

1. **Simplicity**: Keep the core simple and extensible
2. **Performance**: Fast response times, efficient resource usage
3. **Reliability**: Robust error handling, graceful degradation
4. **Extensibility**: Plugin system for unlimited customization
5. **User Control**: Developers maintain full control
6. **Provider Agnostic**: No vendor lock-in
7. **Community-First**: Open development, public roadmap
8. **Terminal Excellence**: Best-in-class terminal experience

---

This design documentation provides a comprehensive overview of OpenCode's architecture and design decisions. For implementation details, refer to the source code and learning guide.
