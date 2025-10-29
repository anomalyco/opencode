# OpenCode CLI to Webapp Conversion Guide

## Quick Start

This guide provides a comprehensive overview of the OpenCode codebase and how to convert it from a CLI/TUI application to a web-based application.

### Key Documents

1. **CODEBASE_ANALYSIS.md** - High-level overview of project structure, technology stack, CLI architecture, and conversion strategy
2. **ARCHITECTURE_DETAILS.md** - Detailed component maps, data flows, critical data structures, and dependency relationships

## One-Page Summary

### Current State

OpenCode is a TypeScript-based AI coding agent that:
- **CLI Entry**: `opencode run "message"` command with Yargs
- **TUI Frontend**: Go-based terminal UI
- **Server Mode**: Already has `opencode serve` which exposes a Hono HTTP API
- **Architecture**: Clean separation between business logic and UI layers

### Key Insight: Most Work Is Already Done

The codebase is **architecturally ready for webapp conversion**:

1. **HTTP API exists** - `Server.ts` already implements REST endpoints
2. **Core logic is decoupled** - Session/Agent/Tool logic doesn't depend on CLI
3. **Storage is abstracted** - File-based JSON storage that works with any client
4. **Event system is in place** - Bus-based pub/sub ready for WebSocket
5. **Multi-provider support** - Anthropic, OpenAI, Google, Bedrock, Azure all supported

### Conversion Strategy

**Keep**: Core business logic (95% of code)
```
/src/session/prompt.ts      → AI interaction loop
/src/tool/registry.ts       → Tool execution
/src/agent/agent.ts         → Agent management
/src/provider/provider.ts   → LLM providers
/src/config/config.ts       → Configuration
/src/storage/storage.ts     → Data persistence
/src/server/server.ts       → HTTP API (enhance with WebSocket)
```

**Replace**: User interface layer
```
OLD: Yargs CLI + Go TUI
NEW: HTTP/WebSocket client + SolidJS/React web UI
```

**Add**: Web-specific features
```
- WebSocket for bidirectional real-time updates
- User authentication/session tokens
- Project file browser UI
- Code editor integration
- Real-time file monitoring
```

## File Organization Reference

### Core Logic (Business Domain)
```
/packages/opencode/src/
├── session/          → Session CRUD, conversation management
├── agent/            → Agent definition and configuration
├── tool/             → Tool registry and execution
├── provider/         → LLM provider abstraction
├── config/           → Configuration loading and management
├── storage/          → File-based persistence
├── project/          → Project detection and management
├── permission/       → Access control and permissions
├── mcp/              → Model Context Protocol
├── lsp/              → Language Server Protocol
└── bus/              → Event system (Pub/Sub)
```

### User Interface Layer (To Replace)
```
/packages/opencode/src/
├── index.ts          → Entry point (uses Yargs) - REPLACE
├── cli/              → CLI commands - REFACTOR to API handlers
│   ├── cmd/          → Command implementations
│   ├── ui.ts         → CLI output formatting - REMOVE
│   └── error.ts      → Error formatting - REUSE
└── server/           → Already HTTP-based - ENHANCE
    ├── server.ts     → Hono app & routes
    ├── project.ts    → Project operations
    └── tui.ts        → TUI-specific routes - ADAPT
```

### Existing Web Infrastructure
```
/packages/console/
├── app/              → SolidJS web application (existing)
├── core/             → Backend services
└── function/         → Serverless functions

/packages/desktop/    → Tauri desktop app (reference)
/packages/web/        → Landing page (Astro)
```

## Critical Files for Understanding

### Must Read First (in order)
1. `/packages/opencode/src/server/server.ts` - Understand the API structure
2. `/packages/opencode/src/session/prompt.ts` - Understand the agent loop
3. `/packages/opencode/src/session/index.ts` - Session data model
4. `/packages/opencode/src/tool/registry.ts` - Tool execution system
5. `/packages/opencode/src/agent/agent.ts` - Agent configuration

### Reference Files
- `/packages/opencode/src/provider/provider.ts` - LLM integration
- `/packages/opencode/src/config/config.ts` - Configuration system
- `/packages/opencode/src/storage/storage.ts` - Data persistence
- `/packages/opencode/src/index.ts` - CLI entry point (shows Yargs setup)

## API Endpoints Already Available

### Sessions
```
GET    /session
POST   /session
GET    /session/:id
PATCH  /session/:id
DELETE /session/:id
GET    /session/:id/message
POST   /session/:id/message
```

### Messages & Tools
```
GET    /session/:id/message/:msgId
GET    /session/:id/message/:msgId/part (streaming)
POST   /session/:id/message/:msgId/part
DELETE /session/:id/message/:msgId
```

### Configuration & Metadata
```
GET    /config
PATCH  /config
GET    /path
GET    /experimental/tool/ids
GET    /experimental/tool
```

### Projects & Files
```
GET    /project
GET    /project/file
POST   /project/file
DELETE /project/file
GET    /project/search
```

## Technology Stack to Leverage

**Keep Using:**
- TypeScript (already monorepo standard)
- Hono (lightweight, well-designed)
- Zod (schema validation)
- Vercel AI SDK (provider abstraction)
- Bun (runtime)

**For Webapp:**
- SolidJS (already in console, performant)
- Solid Start (fullstack framework)
- Tailwind CSS (already used)
- Kobalte (a11y components)
- WebSocket library (e.g., ws, socket.io)

## Implementation Phases

### Phase 1: API Enhancement
- Add WebSocket support to server.ts
- Add auth/token-based access control
- Enhance streaming for large responses
- Add event subscriptions endpoint

### Phase 2: Basic Web UI
- Create SolidJS frontend shell
- Implement session list view
- Implement message history display
- Hook up REST API client

### Phase 3: Interaction & Tools
- Real-time message streaming
- Tool execution visualization
- File browser component
- Code editor integration

### Phase 4: Advanced Features
- User authentication
- Project workspace management
- Custom agent configuration UI
- Sharing and collaboration

## No-Rewrite Zones

These modules should NOT be rewritten:
1. **SessionPrompt.ts** - The agentic loop is perfect as-is
2. **ToolRegistry** - Tool execution system is excellent
3. **Provider** - Multi-provider support is well-abstracted
4. **Storage** - File-based approach works fine for webapp
5. **Config** - Configuration system is extensible

## Dependencies to Watch

### Required for Core Function
- `ai` (Vercel) - LLM integration
- `hono` - Web server
- `zod` - Validation
- `@parcel/watcher` - File monitoring
- `tree-sitter` - Code parsing
- `remeda` - Functional utilities

### Can Remove or Replace
- `yargs` - Only needed for CLI
- TUI-specific code - Replace with web UI

### New Additions
- WebSocket library
- OAuth/auth library
- Web component library

## Expected Codebase Size After Conversion

**Before**: ~113 TypeScript files in opencode package
- CLI/TUI: ~15 files (remove/refactor)
- Core logic: ~70 files (keep unchanged)
- Server/API: ~28 files (enhance)

**After**: ~110 TypeScript files
- Core logic: ~70 files (unchanged)
- Server/API: ~30 files (enhanced with WebSocket, auth)
- Removed: CLI files (no longer needed)
- Added: Web routes (~10 files)

## Quick Reference: File Sizes

| Module | Purpose | Size | Keep? |
|--------|---------|------|-------|
| SessionPrompt.ts | Agent loop | 1500 LOC | Keep |
| Server.ts | API routes | 800 LOC | Enhance |
| Config.ts | Configuration | 800 LOC | Keep |
| Session.ts | Session CRUD | 500 LOC | Keep |
| Provider.ts | LLM support | 600 LOC | Keep |
| ToolRegistry.ts | Tool management | 130 LOC | Keep |
| EditTool.ts | File editing | 500 LOC | Keep |
| BashTool.ts | Command exec | 300 LOC | Keep |
| index.ts | CLI entry | 140 LOC | Replace |
| run.ts | CLI run cmd | 300 LOC | Refactor |

## Success Criteria

The conversion is successful when:

1. [ ] API server runs without Yargs
2. [ ] Web UI can create sessions via REST
3. [ ] Web UI can send messages and see streamed responses
4. [ ] Tool execution works from webapp
5. [ ] Session history persists and loads
6. [ ] Real-time streaming works via WebSocket
7. [ ] File operations work (read/write/edit)
8. [ ] Configuration can be managed via API
9. [ ] All tools execute correctly from web client
10. [ ] Webapp can switch between models/agents

## Support Files

- CODEBASE_ANALYSIS.md - Comprehensive analysis
- ARCHITECTURE_DETAILS.md - Component diagrams and data flows
- /packages/opencode/src/ - Source code reference

---

**Next Steps:**
1. Read CODEBASE_ANALYSIS.md for detailed overview
2. Study ARCHITECTURE_DETAILS.md for component relationships
3. Review server.ts and session/prompt.ts in code
4. Start building WebSocket bridge in server
5. Create SolidJS frontend component skeleton
