# Architecture Overview

## System Design

OpenCode follows a modular architecture with clear boundaries between components.

```
┌─────────────────────────────────────────────────┐
│                    CLI / TUI                     │
│              (SolidJS + OpenTUI)                 │
├─────────────────────────────────────────────────┤
│                   HTTP Server                    │
│                    (Hono)                        │
├──────────┬──────────┬──────────┬────────────────┤
│  Agent   │ Session  │   MCP    │   Provider     │
│  Loop    │ Manager  │  Client  │   Adapters     │
├──────────┴──────────┴──────────┴────────────────┤
│              Permission System                   │
├─────────────────────────────────────────────────┤
│                 Tool Registry                    │
│  (bash, read, write, edit, grep, ls, ...)       │
├─────────────────────────────────────────────────┤
│          Storage / Config / State                │
└─────────────────────────────────────────────────┘
```

## Core Modules

### Agent (`src/agent/`)
The main AI conversation loop. Manages the cycle of:
1. Receive user input
2. Build prompt with context
3. Send to LLM provider
4. Process tool calls
5. Return results

### Session (`src/session/`)
Manages conversation state, message history, and LLM interactions.
- `prompt.ts` — Prompt construction (system, tools, context)
- `llm.ts` — LLM API calls and token management
- `compaction.ts` — Context window compression

### Provider (`src/provider/`)
Adapter layer for 20+ LLM providers. Each provider implements the AI SDK interface.
- Anthropic, OpenAI, Google, Bedrock, Azure, xAI, Groq, Mistral, etc.
- Custom providers via `@ai-sdk/openai-compatible`

### MCP (`src/mcp/`)
Model Context Protocol client for connecting to external tool servers.
- OAuth authentication with PKCE
- Response sanitization (prompt injection prevention)
- Configurable timeouts

### Tool (`src/tool/`)
Built-in tools available to the AI agent:
| Tool | Purpose |
|------|---------|
| `bash` | Shell command execution |
| `read` | File reading with line numbers |
| `write` | File creation/overwriting |
| `edit` | Precise file editing |
| `multiedit` | Multi-file editing |
| `grep` | Content search (ripgrep) |
| `glob` | File pattern matching |
| `ls` | Directory listing |
| `codesearch` | AST-aware code search |
| `webfetch` | URL content fetching |
| `websearch` | Web search |
| `task` | Sub-agent spawning |
| `batch` | Parallel tool execution |
| `lsp` | Language Server Protocol |
| `plan` | Plan mode toggle |
| `todo` | Task management |

### Permission (`src/permission/`)
Controls what the AI can do. Every tool action requires user approval.
- Rule-based matching with wildcard patterns
- "Always allow" rules for repeated operations
- Path traversal protection

### Server (`src/server/`)
Hono-based HTTP server for web UI mode.
- REST API for session/config/PTY management
- WebSocket for real-time terminal access
- Rate limiting and CORS protection
- SSE for session events

## Data Flow

```
User Prompt
    │
    ▼
Agent Loop ──► Session Manager ──► Provider Adapter ──► LLM API
    │                                    │
    │                                    ▼
    │                              Tool Calls
    │                                    │
    │              ┌─────────────────────┤
    │              ▼                     ▼
    │         Permission            MCP Client
    │         Check                      │
    │              │                     ▼
    │              ▼              External Tools
    │         Tool Execution
    │              │
    │              ▼
    │         Result + Output Sanitization
    │              │
    └──────────────┘ (loop until done)
```

## Key Design Decisions

1. **Namespace-based modules** instead of classes — lighter, tree-shakeable
2. **Zod schemas everywhere** — runtime type safety at boundaries
3. **Permission-first** — every action requires explicit approval
4. **Provider-agnostic** — AI SDK abstraction layer for all providers
5. **Bun-native** — leverages Bun's speed and built-in APIs
