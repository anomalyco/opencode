# API Compatibility Analysis

This document compares the Haskell server rewrite against the original TypeScript server API.

## Overview

- **Haskell Server**: Implements core API surface (~40 endpoints)
- **TypeScript Server**: Full API with ~140+ endpoints
- **Coverage**: ~29% of TypeScript endpoints implemented in Haskell

## Implemented Endpoints (Haskell)

### Core Routes

| Method | Path              | Status |
| ------ | ----------------- | ------ |
| GET    | /global/health    | ✅     |
| GET    | /path             | ✅     |
| GET    | /global/config    | ✅     |
| GET    | /project          | ✅     |
| GET    | /project/current  | ✅     |
| GET    | /config/providers | ✅     |
| GET    | /provider/auth    | ✅     |
| GET    | /agent            | ✅     |
| GET    | /config           | ✅     |
| GET    | /command          | ✅     |

### Session Routes

| Method | Path                         | Status |
| ------ | ---------------------------- | ------ |
| GET    | /session/status              | ✅     |
| GET    | /session                     | ✅     |
| POST   | /session                     | ✅     |
| GET    | /session/{sessionID}/message | ✅     |
| POST   | /session/{sessionID}/message | ✅     |

### File Routes

| Method | Path          | Status |
| ------ | ------------- | ------ |
| GET    | /file         | ✅     |
| GET    | /file/content | ✅     |

### PTY Routes (Sandboxed Terminals)

| Method | Path                 | Status |
| ------ | -------------------- | ------ |
| GET    | /pty                 | ✅     |
| POST   | /pty                 | ✅     |
| GET    | /pty/{ptyID}         | ✅     |
| PUT    | /pty/{ptyID}         | ✅     |
| DELETE | /pty/{ptyID}         | ✅     |
| GET    | /pty/{ptyID}/connect | ✅     |
| POST   | /pty/{ptyID}/commit  | ✅     |
| GET    | /pty/{ptyID}/changes | ✅     |

### Other Routes

| Method | Path          | Status |
| ------ | ------------- | ------ |
| GET    | /lsp          | ✅     |
| GET    | /vcs          | ✅     |
| GET    | /permission   | ✅     |
| GET    | /question     | ✅     |
| GET    | /global/event | ✅     |
| POST   | /chat         | ✅     |

## Missing Endpoints (TypeScript Only)

### Auth Routes

- POST /auth/{providerID}
- DELETE /auth/{providerID}
- PUT /auth/{providerID}

### Session Detail Routes

- GET /session/{sessionID} - Get specific session
- DELETE /session/{sessionID} - Delete session
- PATCH /session/{sessionID} - Update session

### Session Child Routes

- GET /session/{sessionID}/children

### Session Todo Routes

- GET /session/{sessionID}/todo

### Session Init Routes

- POST /session/{sessionID}/init

### Session Fork Routes

- POST /session/{sessionID}/fork

### Session Abort Routes

- POST /session/{sessionID}/abort

### Session Share Routes

- POST /session/{sessionID}/share
- DELETE /session/{sessionID}/share

### Session Diff Routes

- GET /session/{sessionID}/diff

### Session Summarize Routes

- POST /session/{sessionID}/summarize

### Session Command Routes

- POST /session/{sessionID}/command

### Session Shell Routes

- POST /session/{sessionID}/shell

### Session Revert Routes

- POST /session/{sessionID}/revert
- POST /session/{sessionID}/unrevert

### Session Permissions Routes

- POST /session/{sessionID}/permissions/{permissionID}

### Message Detail Routes

- GET /session/{sessionID}/message/{messageID}

### Part Routes

- DELETE /session/{sessionID}/message/{messageID}/part/{partID}
- PATCH /session/{sessionID}/message/{messageID}/part/{partID}

### Prompt Async Routes

- POST /session/{sessionID}/prompt_async

### Question Routes

- POST /question/{requestID}/reply
- POST /question/{requestID}/reject

### Permission Routes

- POST /permission/{requestID}/reply

### Provider Routes

- GET /provider
- POST /provider/{providerID}/oauth/authorize
- POST /provider/{providerID}/oauth/callback

### Project Routes

- GET /project/{projectID}

### Find Routes

- GET /find
- GET /find/file
- GET /find/symbol

### File Status Routes

- GET /file/status

### TUI Routes

- POST /tui/append-prompt
- POST /tui/open-help
- POST /tui/open-sessions
- POST /tui/open-themes
- POST /tui/open-models
- POST /tui/submit-prompt
- POST /tui/clear-prompt
- POST /tui/execute-command
- POST /tui/show-toast
- POST /tui/publish
- POST /tui/select-session
- POST /tui/control/next
- POST /tui/control/response

### Instance Routes

- POST /instance/dispose

### Log Routes

- POST /log

### Skill Routes

- GET /skill

### Formatter Routes

- GET /formatter

## Testing Tools

### 1. Property-Based Testing with Schemathesis

```bash
# Install schemathesis
pip install schemathesis

# Run property-based tests
./scripts/property-test-openapi.sh 8080 60
```

### 2. Manual Endpoint Comparison

```bash
# Compare endpoints between servers
./scripts/api-compat-test.sh 8080 4096
```

### 3. Haskell Test Suite

```bash
# Run API compatibility tests
cabal test --test-option=--api-compat
```

## Recommendations

### Priority 1: Core Session API

- [ ] GET /session/{sessionID} - Essential for session management
- [ ] DELETE /session/{sessionID} - Required for cleanup
- [ ] PATCH /session/{sessionID} - For updating session metadata

### Priority 2: Message Operations

- [ ] GET /session/{sessionID}/message/{messageID} - Individual message retrieval
- [ ] DELETE /session/{sessionID}/message/{messageID}/part/{partID} - Part deletion
- [ ] PATCH /session/{sessionID}/message/{messageID}/part/{partID} - Part updates

### Priority 3: Session Lifecycle

- [ ] POST /session/{sessionID}/fork - Session forking
- [ ] POST /session/{sessionID}/abort - Abort operations
- [ ] POST /session/{sessionID}/revert - Revert functionality

## Notes

- The Haskell server implements the core API surface (~40 endpoints)
- TypeScript server has ~140+ endpoints with many advanced features
- Current coverage: ~29% of TypeScript endpoints
- Focus on core session/message/file operations for parity
