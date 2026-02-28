# OpenCode VS Code Extension - ACP Implementation Plan

## Overview

Building a first-class VS Code chat participant using ACP (Agent Client Protocol) with Microsoft storage patterns and comprehensive testing.

## Key Decisions

- **Protocol**: ACP (JSON-RPC over stdio) - not HTTP
- **Storage**: Microsoft pattern (JSON files in storageUri, workspaceState for metadata)
- **API**: Stable Chat Participant API (no proposed APIs)
- **Activation**: On-demand (user selects @opencode in chat UI)
- **Testing**: @vscode/test-cli + Mocha, 80% coverage gate

## Architecture

```
src/
├── acp/                       # ACP protocol layer
│   ├── process.ts             # Spawn opencode acp
│   ├── connection.ts          # JSON-RPC communication
│   ├── client.ts              # High-level client
│   └── protocol.ts            # Type definitions
├── vscode/                    # VS Code integration
│   ├── participant.ts         # ChatParticipant handler
│   ├── storage.ts             # Microsoft-style storage
│   └── activation.ts          # On-demand activation
└── extension.ts               # Entry point
```

## Phase 1: ACP Foundation [CURRENT]

### 1.1 ACP Process Management

- Spawn `opencode acp` subprocess
- stdio communication (newline-delimited JSON)
- Process lifecycle: start, stop, restart on crash
- Health check via `initialize` method

### 1.2 ACP JSON-RPC Communication

- Request/response matching with id correlation
- Handle notifications (streaming, tool calls)
- Error handling and timeouts

### 1.3 ACP Protocol Methods

- `initialize` - Negotiate capabilities
- `session/new` - Create session
- `session/load` - Load existing
- `session/prompt` - Send message
- `session/update` - Handle streaming
- `session/cancel` - Cancel request

## Phase 2: VS Code Chat Integration

### 2.1 Chat Participant Registration

- Register `@opencode` in package.json
- Icon, description, isSticky
- Slash commands: /new, /clear

### 2.2 Request Handler

- ChatRequestHandler implementation
- Build prompt from context.history
- Stream responses via ChatResponseStream

### 2.3 Session Management

- Map VS Code sessions to ACP sessions
- Load history from OpenCode (CLI sessions too)
- Metadata in workspaceState

### 2.4 On-Demand Activation

- Extension loads, process doesn't start
- Process starts on @opencode mention
- Stops when last session closed

## Phase 3: Microsoft-Style Storage

### Storage Structure

```
{workspaceStorage}/.opencode/
├── index.json                 # Session metadata
├── transcripts/
│   ├── {id-1}.json
│   └── {id-2}.json
└── attachments/
```

### Implementation

- workspaceState for metadata (SQLite-backed)
- storageUri/transcripts/ for conversations
- Auto-save on shutdown
- Max 50 sessions (configurable)

## Success Criteria

- [ ] @opencode in chat dropdown
- [ ] Process starts/stops correctly
- [ ] Streaming responses
- [ ] Session persistence
- [ ] CLI sessions accessible
- [ ] Tool execution
- [ ] Tests pass (Linux + Windows)
- [ ] Coverage ≥80%
- [ ] Terminal fallback works

---

**Status**: Phase 1.1 in progress
**Branch**: feature/vscode-acp-chat-participant
**Next**: Implement ACP process management
