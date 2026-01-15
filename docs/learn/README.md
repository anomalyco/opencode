# OpenCode Learning Guide

## Project Overview

OpenCode is an open-source AI-powered development tool that provides an intelligent coding assistant through multiple interfaces (CLI, desktop app, web). It's designed to be provider-agnostic, extensible, and built with a modern client-server architecture.

**Key Features:**
- Multi-provider AI support (Claude, OpenAI, Google, Groq, etc.)
- Advanced TUI (Terminal User Interface) built with SolidJS
- Client/server architecture for local or remote deployment
- Built-in agent system with specialized capabilities
- Comprehensive plugin and tool ecosystem
- LSP integration for language intelligence
- Session management with AI-powered summarization

**Technology Stack:**
- Runtime: Bun
- Language: TypeScript
- Frontend: SolidJS
- Desktop: Tauri
- Build: Turbo monorepo
- Server: Hono (HTTP framework)
- Database: SQLite (session storage)

## Reading Plan

This guide provides a structured approach to understanding the OpenCode codebase, from beginner to advanced levels.

### Phase 1: Foundation (Day 1-2)

**Goal:** Understand the project structure and basic concepts

1. **Start with Documentation**
   - Read: `README.md` - Project overview and installation
   - Read: `CONTRIBUTING.md` - Development setup and contribution guidelines
   - Read: `AGENTS.md` - Understanding the agent system
   - Read: `STYLE_GUIDE.md` - Code style conventions

2. **Understand the Monorepo Structure**
   - Explore: `package.json` - Workspace configuration
   - Explore: `turbo.json` - Build pipeline
   - Review: `/packages` directory structure

3. **Key Packages Overview**
   ```
   packages/
   ├── opencode/      # Core CLI and server
   ├── app/           # Web UI components
   ├── desktop/       # Desktop application
   ├── web/           # Landing page & docs
   ├── sdk/           # Client SDK
   ├── plugin/        # Plugin framework
   └── ui/            # Shared UI components
   ```

### Phase 2: Core Architecture (Day 3-5)

**Goal:** Understand the core server and client architecture

1. **Server Architecture**
   - Entry Point: `packages/opencode/src/index.ts`
   - Server Setup: `packages/opencode/src/server/server.ts`
   - API Routes: `packages/opencode/src/server/api/`
   - Key files to read:
     ```
     packages/opencode/src/
     ├── index.ts                    # CLI entry point
     ├── server/
     │   ├── server.ts              # HTTP server setup
     │   ├── api/                   # API route handlers
     │   │   ├── session.ts         # Session management
     │   │   ├── message.ts         # Message handling
     │   │   ├── provider.ts        # AI provider integration
     │   │   └── config.ts          # Configuration API
     │   └── stream.ts              # Real-time streaming
     ```

2. **Agent System**
   - Core: `packages/opencode/src/agent/`
   - Agent Types: `packages/opencode/src/agent/agent.ts`
   - Agent Runner: `packages/opencode/src/agent/runner.ts`
   - Subagents: `packages/opencode/src/agent/subagent/`
   - Key concepts:
     - Agent configuration and permissions
     - Tool access control
     - Message streaming and streaming parts
     - Agent context and memory

3. **Tool System**
   - Tool Registry: `packages/opencode/src/tool/`
   - Built-in Tools: `packages/opencode/src/tool/builtin/`
   - Important tools to understand:
     ```
     packages/opencode/src/tool/builtin/
     ├── read.ts              # File reading
     ├── write.ts             # File writing
     ├── edit.ts              # File editing
     ├── bash.ts              # Shell commands
     ├── task.ts              # Sub-agent tasks
     ├── glob.ts              # Pattern matching
     ├── grep.ts              # Content search
     └── lsp.ts               # LSP integration
     ```

### Phase 3: Session & Message Management (Day 6-8)

**Goal:** Understand how sessions and messages are managed

1. **Session Management**
   - Session Store: `packages/opencode/src/session/store.ts`
   - Session State: `packages/opencode/src/session/session.ts`
   - File Snapshots: `packages/opencode/src/session/snapshot.ts`
   - Key concepts:
     - Session lifecycle (create, resume, fork, summarize)
     - Message persistence
     - File state tracking
     - Session compaction

2. **Message Flow**
   - Message Types: `packages/opencode/src/message/`
   - Message Parts: Streaming, tool calls, tool results
   - Message Processing: `packages/opencode/src/agent/runner.ts`
   - Real-time Updates: WebSocket/SSE streaming

3. **AI Provider Integration**
   - Provider System: `packages/opencode/src/provider/`
   - OAuth Support: `packages/opencode/src/provider/oauth/`
   - Model Configuration: `packages/opencode/src/provider/model.ts`
   - Multi-provider support with fallbacks

### Phase 4: Frontend & TUI (Day 9-12)

**Goal:** Understand the user interfaces

1. **TUI Implementation**
   - TUI Entry: `packages/opencode/src/cli/cmd/tui/`
   - Components: Built with SolidJS and opentui
   - Layout: Multi-pane interface
   - Key files:
     ```
     packages/opencode/src/cli/cmd/tui/
     ├── index.tsx              # TUI entry point
     ├── components/            # TUI components
     ├── state.ts               # TUI state management
     └── keybindings.ts         # Keyboard shortcuts
     ```

2. **Web Application**
   - App Package: `packages/app/src/`
   - Main Components:
     ```
     packages/app/src/
     ├── index.tsx              # App entry
     ├── components/            # Reusable UI components
     ├── page/                  # Pages/views
     └── lib/                   # Utilities and hooks
     ```

3. **Desktop Application**
   - Desktop Package: `packages/desktop/`
   - Tauri Integration: `packages/desktop/src-tauri/`
   - Native Features: File dialogs, notifications, system integration

### Phase 5: Advanced Features (Day 13-15)

**Goal:** Deep dive into advanced functionality

1. **Plugin System**
   - Plugin Framework: `packages/plugin/src/`
   - Plugin Hooks: Event system, custom tools, auth
   - Plugin Loading: `packages/opencode/src/plugin/`
   - Example Plugins: `.opencode/tool/` and `.opencode/agent/`

2. **LSP Integration**
   - LSP Client: `packages/opencode/src/lsp/`
   - Language Support: Multiple language servers
   - Features: Diagnostics, completions, symbols, formatting
   - Configuration: Per-project LSP setup

3. **Configuration System**
   - Config Loading: `packages/opencode/src/config/`
   - Config Schema: Hierarchical configuration
   - Remote Config: `.well-known/opencode` support
   - Environment Variables: Runtime configuration

4. **File Management**
   - File System: `packages/opencode/src/fs/`
   - Git Integration: `packages/opencode/src/git/`
   - File Watching: Real-time change detection
   - Worktree Support: Multiple git worktrees

### Phase 6: SDK & Integration (Day 16-17)

**Goal:** Understand how to build on OpenCode

1. **SDK Architecture**
   - SDK Package: `packages/sdk/js/`
   - Client Creation: `packages/sdk/js/src/client.ts`
   - Type Definitions: Auto-generated from API schema
   - Usage Examples: Building custom clients

2. **API Design**
   - OpenAPI Schema: Auto-generated documentation
   - RESTful Endpoints: Standard HTTP methods
   - WebSocket/SSE: Real-time communication
   - Authentication: Token-based auth

3. **Building Extensions**
   - Custom Agents: `.opencode/agent/`
   - Custom Tools: `.opencode/tool/`
   - Custom Commands: `.opencode/command/`
   - Skills: `.opencode/skill/`

### Phase 7: Enterprise & Deployment (Day 18-20)

**Goal:** Understand enterprise features and deployment options

1. **Console & Cloud**
   - Console Package: `packages/console/`
   - Enterprise Features: `packages/enterprise/`
   - Identity & Auth: `packages/identity/`
   - Slack Integration: `packages/slack/`

2. **Infrastructure**
   - Infrastructure: `infra/` directory
   - SST Configuration: `sst.config.ts`
   - Deployment Scripts: `script/` directory
   - CI/CD: `.github/workflows/`

3. **Build & Release**
   - Build Scripts: `packages/opencode/script/build.ts`
   - Packaging: Platform-specific builds
   - Distribution: npm, Homebrew, Scoop, etc.
   - Desktop Builds: Tauri bundling

## Learning Resources

### Interactive Exploration

1. **Run the Dev Environment**
   ```bash
   bun install
   bun dev
   ```

2. **Experiment with the TUI**
   - Try different commands
   - Explore the file tree
   - Test tool usage
   - Switch between agents

3. **Build a Custom Tool**
   - Create `.opencode/tool/my-tool.ts`
   - Follow plugin examples
   - Test integration

### Code Reading Tips

1. **Follow the Data Flow**
   - Start from user input (TUI/CLI)
   - Trace through message handling
   - Follow agent execution
   - See tool invocation
   - Observe response streaming

2. **Use the Type System**
   - TypeScript types are comprehensive
   - Follow type definitions
   - Understand interfaces
   - Explore schema definitions

3. **Debug with Breakpoints**
   - Set up VSCode debugging (see CONTRIBUTING.md)
   - Step through agent execution
   - Inspect message flow
   - Understand tool calls

## Key Concepts to Master

### 1. Agent System
- Multiple agent types (build, plan, general, explore)
- Agent configuration and permissions
- Tool access control
- Context management

### 2. Tool System
- Tool registry and registration
- Tool parameters and schemas
- Tool execution and permissions
- Custom tool development

### 3. Session Management
- Session lifecycle
- Message persistence
- File snapshots
- Session compaction with AI

### 4. Real-time Communication
- WebSocket/SSE streaming
- Message parts
- Event system
- Real-time updates

### 5. Multi-Provider Support
- Provider abstraction
- OAuth integration
- Model configuration
- Fallback strategies

## Common Patterns

### 1. Error Handling
```typescript
// Prefer .catch() over try/catch
result = await operation().catch(handleError)
```

### 2. Immutable State
```typescript
// Avoid let, prefer const
const newState = { ...oldState, updated: true }
```

### 3. Type Safety
```typescript
// Avoid any, use precise types
function process(data: SpecificType): ResultType
```

### 4. Async Operations
```typescript
// Use async/await consistently
const result = await asyncOperation()
```

## Next Steps

1. **Pick a Feature Area**
   - Choose based on interest (TUI, agents, tools, etc.)
   - Focus on one package at a time
   - Read related code thoroughly

2. **Make Small Contributions**
   - Fix typos or docs
   - Add tests
   - Fix small bugs
   - Improve error messages

3. **Build Something**
   - Custom tool
   - Custom agent
   - Plugin integration
   - Client application

4. **Join the Community**
   - Discord: https://opencode.ai/discord
   - GitHub Issues: Bug reports and features
   - Discussions: Design conversations

## Troubleshooting Learning

### "I'm Lost in the Code"
- Start smaller: Pick one file and understand it completely
- Draw diagrams: Visualize the architecture
- Add console.logs: See the execution flow
- Ask questions: Discord community is helpful

### "Too Much to Learn"
- Focus on one package at a time
- Skip enterprise features initially
- Master the core before advanced features
- Refer back to this guide

### "Code Doesn't Make Sense"
- Check TypeScript types for documentation
- Look for tests that show usage
- Find similar patterns in the codebase
- Read commit history for context

## Recommended Reading Order

**For CLI/TUI Developers:**
1. Phase 1 → Phase 2 → Phase 4 → Phase 3 → Phase 5

**For Backend Developers:**
1. Phase 1 → Phase 2 → Phase 3 → Phase 5 → Phase 6

**For Frontend Developers:**
1. Phase 1 → Phase 4 → Phase 6 → Phase 2 → Phase 3

**For Plugin Developers:**
1. Phase 1 → Phase 2 (Tools only) → Phase 5 (Plugin System) → Phase 6

**For Contributors:**
1. Follow the complete sequence: Phase 1 → Phase 7

Good luck with your OpenCode learning journey!
