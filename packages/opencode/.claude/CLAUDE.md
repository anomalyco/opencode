# OpenCode Core Package Guide

> **Package**: `packages/opencode`
> **Purpose**: Core CLI application and server implementation
> **Entry Point**: `src/index.ts`

## Overview

This is the heart of OpenCode - a complete AI-powered development assistant that includes:
- CLI with multiple commands
- HTTP server with REST API and streaming
- Agent system for AI orchestration
- Tool system for environment interaction
- Session management with persistence
- Multi-provider AI support
- LSP integration
- Git integration
- Plugin system

## Directory Structure

```
packages/opencode/
├── bin/
│   └── opencode           # Executable entry script
├── script/
│   └── build.ts           # Build script for standalone binary
├── src/
│   ├── index.ts           # Main CLI entry point
│   │
│   ├── server/            # HTTP Server
│   │   ├── server.ts      # Hono server setup & OpenAPI
│   │   ├── api/           # REST API routes
│   │   └── stream.ts      # WebSocket/SSE streaming
│   │
│   ├── agent/             # Agent System
│   │   ├── agent.ts       # Agent types & registry
│   │   ├── runner.ts      # Agent execution engine
│   │   ├── builtin/       # Built-in agents
│   │   └── subagent/      # Subagents (general, explore)
│   │
│   ├── tool/              # Tool System
│   │   ├── tool.ts        # Tool registry & types
│   │   ├── builtin/       # 20+ built-in tools
│   │   └── permission.ts  # Permission checking
│   │
│   ├── session/           # Session Management
│   │   ├── store.ts       # SQLite storage
│   │   ├── session.ts     # Session state
│   │   └── snapshot.ts    # File snapshots
│   │
│   ├── provider/          # AI Provider System
│   │   ├── provider.ts    # Provider abstraction
│   │   ├── model.ts       # Model management
│   │   └── oauth/         # OAuth flows
│   │
│   ├── cli/               # CLI Commands
│   │   └── cmd/
│   │       ├── tui/       # Terminal UI (SolidJS)
│   │       ├── serve.ts   # Server mode
│   │       ├── auth.ts    # Auth commands
│   │       └── ...        # Other commands
│   │
│   ├── config/            # Configuration System
│   ├── lsp/               # Language Server Protocol
│   ├── git/               # Git integration
│   ├── fs/                # File system operations
│   ├── plugin/            # Plugin loading
│   └── message/           # Message handling
│
├── test/                  # Test files
└── package.json
```

## Key Components

### 1. CLI Entry Point (`src/index.ts`)

Main command structure using yargs:

```typescript
// Main commands
opencode                   // Interactive TUI
opencode run               // Interactive TUI (explicit)
opencode serve             // Headless server mode
opencode attach <url>      // Connect to remote server
opencode auth <provider>   // Authenticate AI provider
opencode models            // List/manage models
opencode config            // View/edit configuration
opencode session           // Manage sessions
```

**Key Functions:**
- CLI argument parsing
- Command routing
- Environment setup
- Error handling

### 2. Server (`src/server/server.ts`)

Hono-based HTTP server with:
- RESTful API endpoints
- OpenAPI documentation
- WebSocket/SSE streaming
- CORS support
- Error middleware

**API Routes** (`src/server/api/`):
- `session.ts`: Session CRUD operations
- `message.ts`: Message handling & streaming
- `provider.ts`: AI provider management
- `config.ts`: Configuration API
- `file.ts`: File operations
- `git.ts`: Git operations
- `event.ts`: Real-time event stream

### 3. Agent System (`src/agent/`)

#### Agent Runner (`runner.ts`)
Core execution engine that:
1. Loads session context
2. Builds system prompts
3. Prepares tool definitions
4. Calls AI provider
5. Streams response parts
6. Executes tools
7. Manages permissions

#### Built-in Agents (`builtin/`)
- **build**: Full-access development agent
- **plan**: Read-only analysis agent

#### Subagents (`subagent/`)
- **general**: Multi-step task execution
- **explore**: Fast codebase exploration

**Agent Configuration**:
```typescript
interface Agent {
  id: string
  name: string
  model?: string
  permissions: {
    tools: { [name: string]: 'allow' | 'deny' | 'ask' }
    defaultPermission: 'allow' | 'deny' | 'ask'
  }
  systemPrompt: string
  temperature?: number
  topP?: number
}
```

### 4. Tool System (`src/tool/`)

#### Tool Registry (`tool.ts`)
Central registry for all tools:
- Registration and discovery
- Parameter validation (Zod schemas)
- Permission checking
- Execution orchestration

#### Built-in Tools (`builtin/`)

**File Operations:**
- `read.ts`: Read file contents
- `write.ts`: Create/overwrite files
- `edit.ts`: Patch existing files
- `list.ts`: Directory listing
- `glob.ts`: Pattern matching
- `grep.ts`: Content search

**Development Tools:**
- `bash.ts`: Shell command execution
- `lsp.ts`: Language server operations
- `multiedit.ts`: Batch file editing

**AI-Powered:**
- `task.ts`: Spawn subagent for complex tasks
- `websearch.ts`: Web search integration
- `codesearch.ts`: GitHub code search
- `todowrite.ts` / `todoread.ts`: Task management

**Tool Interface**:
```typescript
interface Tool {
  name: string
  description: string
  parameters: z.ZodSchema
  execute: (input: unknown) => Promise<ToolResult>
  requiresPermission?: boolean
}
```

### 5. Session Management (`src/session/`)

#### Store (`store.ts`)
SQLite-based persistence:
- Message storage
- Metadata management
- Query optimization
- Migration handling

#### Session State (`session.ts`)
In-memory session state:
- Current agent
- Message history
- File snapshots
- Configuration overrides

#### Snapshots (`snapshot.ts`)
File state tracking:
- Content snapshots
- Hash-based diffing
- Restore operations
- Fork support

**Session Operations:**
- Create: New session
- Resume: Load existing
- Fork: Branch from existing
- Summarize: AI-powered compaction
- Revert: Restore file states

### 6. Provider System (`src/provider/`)

#### Provider Abstraction (`provider.ts`)
Unified interface for all AI providers:
- Model listing
- Authentication
- Completion streaming
- Error handling

#### OAuth Integration (`oauth/`)
Streamlined provider authentication:
- OAuth flow management
- Token storage
- Token refresh
- Callback handling

**Supported Providers:**
- Anthropic (Claude)
- OpenAI (GPT)
- Google (Gemini)
- Groq
- Cerebras
- OpenRouter
- OpenCode Zen (recommended)
- Local models (OpenAI-compatible)

### 7. TUI (`src/cli/cmd/tui/`)

Terminal UI built with SolidJS and opentui:

**Components:**
- Message display with streaming
- File tree with git status
- Status bar with metrics
- Input area with completions
- Multi-pane layout

**Features:**
- Real-time streaming
- Syntax highlighting
- Keyboard navigation
- File browsing
- Session management

**State Management:**
- Reactive updates with Solid
- WebSocket connection
- Local state sync
- Error handling

### 8. LSP Integration (`src/lsp/`)

Language Server Protocol client:
- Multi-language support
- Automatic LSP discovery
- Symbol search
- Diagnostics
- Code actions
- Formatting

**LSP Features:**
- Workspace symbols
- Document symbols
- Go to definition
- Find references
- Hover information
- Code completion

### 9. Git Integration (`src/git/`)

Git operations and awareness:
- Repository detection
- Status tracking
- Branch information
- Worktree support
- Diff generation
- Commit operations

### 10. Plugin System (`src/plugin/`)

Plugin loading and management:
- Plugin discovery (.opencode/, node_modules)
- Hook registration
- Lifecycle management
- Error isolation

**Plugin Hooks:**
- `server.start` / `server.stop`
- `event`: Generic event handler
- `tool`: Custom tool registration
- `chat.message`: Message interception
- `permission.ask`: Permission requests
- `config`: Configuration modification
- `auth`: Custom auth providers

## Data Flow

### Message Processing Flow

```
User Input
    ↓
Create User Message
    ↓
Save to Session Store
    ↓
Agent Runner:
    1. Load context
    2. Build prompt
    3. Call provider
    ↓
Stream Response:
    - text parts → display
    - tool_use → execute tool
    - tool_result → append
    ↓
Save Assistant Message
    ↓
Update UI
```

### Tool Execution Flow

```
Tool Call from AI
    ↓
Parse Parameters
    ↓
Validate Schema
    ↓
Check Permissions:
    - allow → execute
    - deny → error
    - ask → prompt user
    ↓
Execute Tool Function
    ↓
Handle Result/Error
    ↓
Return to AI
```

### Session Lifecycle

```
Create Session
    ↓
Initialize:
    - Set agent
    - Load config
    - Start file watching
    ↓
Message Loop:
    - Receive message
    - Process with agent
    - Save to DB
    ↓
Background:
    - Track file changes
    - Update snapshots
    - Check compaction
    ↓
Compaction (if needed):
    - AI summarizes old messages
    - Replace with summary
    - Free up context
    ↓
End Session:
    - Save final state
    - Close watchers
```

## Configuration

### Config Files
- Global: `~/.config/opencode/config.jsonc`
- Project: `.opencode/opencode.jsonc`
- Remote: `.well-known/opencode`

### Config Schema
```typescript
{
  agent?: {
    default?: string
    [agentId: string]: AgentConfig
  }
  provider?: {
    default?: string
    [providerId: string]: ProviderConfig
  }
  tools?: {
    [toolName: string]: ToolConfig
  }
  session?: SessionConfig
  ui?: UIConfig
  lsp?: LSPConfig
  git?: GitConfig
}
```

## Building & Testing

### Development
```bash
# Run in current directory
bun dev

# Run in specific directory
bun dev <path>

# Type check
bun typecheck

# Run tests
bun test
```

### Building
```bash
# Build standalone binary
./script/build.ts --single

# Output: dist/opencode-<platform>/bin/opencode
```

### Debugging
```bash
# With inspector
bun run --inspect=ws://localhost:6499/ src/index.ts

# Server mode
bun run src/index.ts serve --port 4096

# TUI mode
bun run --conditions=browser src/index.ts
```

## Common Tasks

### Adding a New Command

1. Create command file in `src/cli/cmd/my-command.ts`
2. Implement command handler
3. Register in `src/index.ts` yargs setup

### Adding a New API Route

1. Create route file in `src/server/api/my-route.ts`
2. Implement Hono route handlers
3. Register in `src/server/server.ts`
4. Run `./script/generate.ts` to update SDK

### Adding a New Tool

1. Create `src/tool/builtin/my-tool.ts`
2. Define tool with Zod schema
3. Implement execute function
4. Register in `src/tool/builtin/index.ts`

### Modifying Agent Behavior

1. Edit agent config in `src/agent/builtin/`
2. Update system prompt
3. Adjust permissions
4. Test with `bun dev`

## Testing

Test files located alongside source files with `.test.ts` extension.

```bash
# Run all tests
bun test

# Run specific test
bun test src/tool/builtin/read.test.ts

# Watch mode
bun test --watch
```

## Dependencies

Key dependencies:
- **hono**: HTTP server framework
- **ai**: Vercel AI SDK for provider integration
- **@parcel/watcher**: File watching
- **yargs**: CLI argument parsing
- **zod**: Schema validation
- **solid-js**: Reactive UI framework
- **@opentui/core**: Terminal UI components
- **bun-pty**: PTY support for shells

## Performance Considerations

1. **Lazy Loading**: Load tools/plugins on demand
2. **Streaming**: Stream all AI responses
3. **Caching**: Cache LSP responses, git status
4. **Debouncing**: Debounce file watchers
5. **Connection Pooling**: Reuse LSP connections
6. **Compaction**: Manage session context size

## Security

1. **Permission System**: Agent-level and tool-level
2. **File Access**: Respect .gitignore
3. **Command Execution**: Prompt in plan mode
4. **Token Storage**: Secure credential storage
5. **Input Validation**: Zod schemas for all inputs

## Debugging Tips

1. Set breakpoints in VSCode (see CONTRIBUTING.md)
2. Use `console.log` for quick debugging
3. Check `~/.opencode/logs/` for error logs
4. Use `--verbose` flag for detailed output
5. Test in isolation with `bun test`

## Common Pitfalls

1. **Async Operations**: Always await async calls
2. **Error Handling**: Use `.catch()` not try/catch
3. **Type Safety**: Avoid `any` types
4. **Immutability**: Use const, not let
5. **Tool Permissions**: Check before executing
6. **Session State**: Always save after modifications

## Related Documentation

- Root guide: `../../CLAUDE.md`
- Learning guide: `../../doc/learn/README.md`
- Design docs: `../../doc/design/README.md`
- Contributing: `../../CONTRIBUTING.md`
- Style guide: `../../STYLE_GUIDE.md`

---

This package is the core of OpenCode. Most development work happens here. Understanding this package is crucial for contributing to OpenCode.
