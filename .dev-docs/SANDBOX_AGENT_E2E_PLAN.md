# Research: OpenCode Testing Through Sandbox-Agent

## Upstream OpenCode Test Coverage

**66 test files, ~830+ test cases** in `packages/opencode/test/`:

| Category | Files | ~Tests | Tests HTTP API? |
|----------|-------|--------|-----------------|
| session | 10 | 42 | No — direct `Session.*` calls |
| tool | 9 | 78 | No — direct tool execution |
| provider | 6 | 156 | No — config/transform logic |
| config | 3 | 105 | No — parsing/merging |
| permission | 3 | 84 | No — rule evaluation |
| snapshot | 1 | 52 | No — git tracking |
| patch | 1 | 39 | No — patch parsing |
| cli | 4 | 46 | No — URL parsing, formatting |
| agent | 1 | 24 | No — agent config |
| keybind | 1 | 46 | No — keybind parsing |
| acp | 2 | 6 | No — ACP protocol |
| question | 1 | 11 | No — ask/reply system |
| skill | 2 | 16 | No — discovery |
| util | 7 | 25 | No — format, lazy, lock |
| server | 2 | 4 | **Yes** — `Server.App()` |
| other | 13 | 96 | No — mcp, lsp, ide, etc. |

**Only 2/66 files test HTTP endpoints.** The rest test internal functions directly.

**Why?** Deliberate unit-testing-first strategy. Routes are thin adapters (Zod validation → business logic call → JSON response). Testing the underlying modules covers the same logic.

### Upstream Route → Business Logic → Test Mapping (104+ endpoints)

| Route | Business Logic | Has Test? |
|-------|---------------|-----------|
| `GET /session` | `Session.list()` | ✓ session-list.test.ts |
| `POST /session` | `Session.create()` | ✓ session-list.test.ts |
| `GET /session/:id` | `Session.get()` | ✗ |
| `DELETE /session/:id` | `Session.remove()` | ✗ |
| `PATCH /session/:id` | `Session.update()` | ✗ |
| `POST /session/:id/message` | `SessionPrompt.prompt()` | ✗ |
| `POST /session/:id/abort` | `SessionPrompt.cancel()` | ✗ |
| `POST /session/:id/fork` | `Session.fork()` | ✗ |
| `POST /session/:id/revert` | `SessionRevert.revert()` | ✗ |
| `POST /session/:id/unrevert` | `SessionRevert.unrevert()` | ✗ |
| `POST /session/:id/share` | `Session.share()` | ✗ |
| `POST /session/:id/summarize` | `SessionCompaction.create()` | ✗ |
| `GET /session/:id/todo` | `Todo.get()` | ✗ |
| `GET /session/:id/diff` | `SessionSummary.diff()` | ✗ |
| `GET /session/:id/message` | `Session.messages()` | ✗ |
| `GET /session/:id/children` | `Session.children()` | ✗ |
| `GET /session/status` | `SessionStatus.list()` | ✗ |
| `GET /permission` | `PermissionNext.list()` | ✓ permission/next.test.ts |
| `POST /permission/:id/reply` | `PermissionNext.reply()` | ✓ permission/next.test.ts |
| `GET /question` | `Question.list()` | ✓ question/question.test.ts |
| `POST /question/:id/reply` | `Question.reply()` | ✓ question/question.test.ts |
| `POST /question/:id/reject` | `Question.reject()` | ✓ question/question.test.ts |
| `GET /config` | `Config.get()` | ✓ config/config.test.ts |
| `PATCH /config` | `Config.update()` | ✓ config/config.test.ts |
| `GET /config/providers` | `Provider.list()` | ✓ provider/provider.test.ts |
| `GET /provider` | `ModelsDev.get() + Provider.list()` | ✓ provider/provider.test.ts |
| `GET /event` | `Bus.subscribeAll()` [SSE] | ✓ acp/event-subscription.test.ts |
| `GET /skill` | `Skill.all()` | ✓ skill/skill.test.ts |
| `GET /agent` | `Agent.list()` | ✓ (indirect) agent/agent.test.ts |
| `GET /find` | `Ripgrep.search()` | ✓ file/ripgrep.test.ts |
| `GET /lsp` | `LSP.status()` | ✓ lsp/client.test.ts |
| `GET /project` | `Project.list()` | ✓ project/project.test.ts |
| `GET /file` | `File.list()` | ✗ |
| `GET /file/content` | `File.read()` | ✗ |
| `GET /file/status` | `File.status()` | ✗ |
| `GET /vcs` | `Vcs.branch()` | ✗ |
| `GET /command` | `Command.list()` | ✗ |
| `GET /formatter` | `Format.status()` | ✗ |
| `GET /path` | `Global.Path.*` | ✗ |
| All `/pty/*` (6) | `Pty.*` | ✗ |
| All `/tui/*` (13) | `Bus.publish(TuiEvent.*)` | ✗ |
| All `/mcp/*` (8) | `MCP.*` | partial |
| All `/experimental/*` (7) | various | ✗ |
| `GET/PATCH /global/config` | `Config.getGlobal/updateGlobal()` | ✗ |
| `GET /global/health` | `Installation.VERSION` | ✗ |
| `GET /global/event` | `GlobalBus.subscribeAll()` [SSE] | ✗ |

**~20 endpoints have upstream business logic tests. ~84 have none.**

## Sandbox-Agent Architecture

### Two API Layers

| Layer | Path | Purpose | Endpoints |
|-------|------|---------|-----------|
| **Universal** | `/v1/...` | Lowest common denominator across all agents | 22 |
| **OpenCode Compat** | `/opencode/...` | Full OpenCode API surface for any backing agent | 80+ |

### How Sandbox-Agent Talks to OpenCode

OpenCode is a **persistent HTTP server** (unlike Claude/Amp which are subprocess-per-turn):

```
sandbox-agent daemon
  └─ spawns: `opencode serve --port {4200-4300}`
     └─ communicates via HTTP:
        POST /session          — create session
        POST /session/{id}/prompt  — send message
        GET  /event/subscribe      — SSE event stream
        POST /question/reply       — answer HITL question
        POST /permission/reply     — grant/deny permission
```

### Universal API (`/v1/*`) — 22 endpoints

```
GET  /v1/health
GET  /v1/agents
POST /v1/agents/:agent/install
GET  /v1/agents/:agent/modes
GET  /v1/agents/:agent/models
GET  /v1/sessions
POST /v1/sessions/:id
POST /v1/sessions/:id/messages
POST /v1/sessions/:id/messages/stream
POST /v1/sessions/:id/terminate
GET  /v1/sessions/:id/events
GET  /v1/sessions/:id/events/sse
POST /v1/sessions/:id/questions/:qid/reply
POST /v1/sessions/:id/questions/:qid/reject
POST /v1/sessions/:id/permissions/:pid/reply
GET  /v1/fs/entries
GET  /v1/fs/file
PUT  /v1/fs/file
DELETE /v1/fs/entry
POST /v1/fs/mkdir
POST /v1/fs/move
GET  /v1/fs/stat
POST /v1/fs/upload-batch
```

### OpenCode Compat Layer (`/opencode/*`) — Status Map

**Functional (real logic):**
- `GET /event` — SSE stream with replay + heartbeats
- `GET /global/event` — same, wrapped in GlobalEvent format
- `GET/POST /session` — in-memory session store
- `GET/PATCH/DELETE /session/{id}` — session CRUD
- `GET/POST /session/{id}/message` — message send + retrieval
- `POST /session/{id}/prompt_async` — async prompt
- `GET /permission`, `POST /permission/{id}/reply`
- `GET /question`, `POST /question/{id}/reply`, `POST /question/{id}/reject`
- `GET /provider`, `GET /config/providers` — model/provider discovery across ALL agents
- `GET /session/status` — busy/idle
- `GET /agent` — agent metadata
- `GET /global/health`

**Proxied (to native OpenCode via `OPENCODE_COMPAT_PROXY_URL`):**
- `GET /command`
- `GET/PATCH /config`
- `GET/PATCH /global/config`
- All `/tui/*` (13 endpoints)

**Stubbed (returns empty/mock):**
- Session ops: abort, fork, diff, summarize, revert, unrevert, share, todo, init, children, command, shell
- Files: /file, /file/content, /file/status, /path
- Search: /find, /find/file, /find/symbol
- VCS: /vcs
- LSP/Formatter: /lsp, /formatter
- PTY: all CRUD + connect (in-memory records, no real PTY)
- MCP: all CRUD + auth
- Experimental: tool, resource, worktree
- Project: all endpoints
- Skills: /skill
- Auth: /auth/{provider}, /provider/auth, OAuth flows

### Event Bridge (Universal → OpenCode format)

`apply_universal_event()` converts each `UniversalEvent` to OpenCode events:
- `ItemStarted/Completed` → `message.updated` + `message.part.updated`
- `ItemDelta` → `message.part.updated` with `delta` field
- `TurnStarted` → `session.status` (busy)
- `TurnEnded` → `session.status` (idle) + `session.idle`
- `PermissionRequested/Resolved` → `permission.asked`/`permission.replied`
- `QuestionRequested/Resolved` → `question.asked`/`question.replied`
- `Error` → `session.error`

### Agent Resolution (model → backing agent)

`resolve_session_agent()` maps OpenCode provider/model IDs to backing agents:
- "Anthropic/claude-sonnet-4" → `AgentId::Claude`
- "OpenAI/gpt-4o" → `AgentId::Codex`
- Default/opencode models → `AgentId::Opencode`

This means selecting a model in the frontend determines which agent processes the request.

### Why Endpoints Are Stubbed — Research Specs

| Feature | Spec File | Blocker |
|---------|-----------|---------|
| fork, revert, share | `session-persistence.md` | In-memory sessions (no persistence) |
| command, shell | `command-shell-exec.md` | Needs proxy impl (Issue #142) |
| abort | (no spec) | Issue #136 — straightforward |
| summarize, todo | `summarize-todo.md` | Needs LLM integration (Issue #134) |
| PTY | `pty-management.md` | Needs real PTY processes |
| file, find, path | `filesystem-integration.md` | Needs workspace fs service |
| vcs, diff, revert | `vcs-integration.md` | Needs git integration |
| provider auth, OAuth | `provider-auth.md` | Needs credential store |
| search, symbols | `search-symbol-indexing.md` | Needs ripgrep backend |
| formatter, LSP | `formatter-lsp.md` | Needs process management |
| MCP | `mcp-integration.md` | Needs registry + auth |
| project, worktree | `project-worktree.md` | Needs VCS integration |

**Root cause**: In-memory `HashMap<String, SessionState>` — no disk persistence. This single architectural gap blocks fork/share/revert/todo/summarize.

## API Schema Contracts

### Upstream OpenCode (Zod-based, auto-generated OpenAPI at `/doc`)

Key response shapes:
- **Session.Info**: `{ id, slug, projectID, directory, title, version, time: { created, updated, compacting?, archived? }, parentID?, share?, summary?, permission?, revert? }`
- **MessageV2.WithParts**: `{ info: MessageV2.Info, parts: MessageV2.Part[] }`
- **MessageV2.Part**: discriminated union on `type` — text, reasoning, file, tool, agent, snapshot, patch, subtask, retry, step-start, step-finish, compaction
- **ToolPart.state**: `pending | running | completed | error`
- **PermissionNext.Request**: `{ id, sessionID, permission, patterns, metadata, always, tool? }`
- **Question.Request**: `{ id, sessionID, questions: [{ question, header, options, multiple?, custom? }], tool? }`
- **SessionStatus.Info**: `{ type: "idle" } | { type: "busy" } | { type: "retry", attempt, message, next }`
- **File.Node**: `{ name, path, absolute, type: "file"|"directory", ignored }`
- **File.Content**: `{ type: "text"|"binary", content, diff?, patch?, encoding?, mimeType? }`
- **Config.Info**: large config object with theme, keybinds, tui, server, agent, provider, mcp, etc.

### Sandbox-Agent SDK (TypeScript, from index.d.ts)

Key response shapes:
- **SessionInfo**: `{ sessionId, agent, agentMode, createdAt, updatedAt, eventCount, ended, directory?, model?, nativeSessionId?, permissionMode, title? }`
- **UniversalEvent**: `{ event_id, session_id, sequence, time, type, source, synthetic, data }` — 13 event types
- **ContentPart**: `text | json | tool_call | tool_result | file_ref | reasoning | image | status`
- **AgentInfo**: `{ id, installed, credentialsAvailable, version?, capabilities: { commandExecution, permissions, questions, reasoning, toolCalls, ... } }`
- **FsEntry**: `{ path, name, entryType, size, modified? }`
- **ProblemDetails**: `{ status, title, type, detail? }` (RFC 7807)

### Shape Differences (OpenCode → Sandbox-Agent translation)

| Field | OpenCode | Sandbox-Agent |
|-------|----------|---------------|
| Session ID | `id` (server-generated) | `sessionId` (client-provided) |
| Timestamps | `time.created` (unix number) | `createdAt` (int64) |
| Messages | `MessageV2.Part[]` (12 types) | `ContentPart[]` (8 types) |
| Tool state | `pending/running/completed/error` | via `ItemStatus: in_progress/completed/failed` |
| Events | `BusEvent` (flat) | `UniversalEvent` (structured, 13 types) |
| Errors | `NamedError` subclasses | `ProblemDetails` (RFC 7807) |

## Testing Strategy

### Three test layers:

**Layer 1: Thin Adapter Tests (~12 endpoints)**
For endpoints where upstream has business logic tests, write a test that:
1. Hits sandbox-agent compat endpoint
2. Verifies same behavioral assertions as upstream test
3. Maps: `sandbox-agent /opencode/session → opencode GET /session → Session.list()`

Endpoints: session list/create, permission list/reply, question list/reply/reject, provider list, config get, event stream, skill list

**Layer 2: Contract/Schema Tests (~20 functional endpoints)**
For ALL functional compat endpoints, verify:
1. Response status code is correct (200, 204, etc.)
2. Response shape matches expected schema (has required fields, correct types)
3. Error responses use ProblemDetails format
4. No crashes or 500s on valid requests

Uses sandbox-agent SDK types as the contract — if `createSession()` returns, it should have `sessionId`, `agent`, `createdAt`, etc.

**Layer 3: Stub Verification (~50 stubbed endpoints)**
For stubbed endpoints, verify:
1. Returns sensible defaults (empty arrays, empty objects — not 500/crash)
2. Status code is 200 or 204 (not 404 or 500)
3. Response is valid JSON

### Integration test structure:

```
beforeAll: SandboxAgent.start() — spawn real process
afterAll: client.dispose() — kill process

describe("Layer 1: Upstream Behavior Parity")
  // Maps to upstream test assertions through sandbox-agent

describe("Layer 2: API Contract Verification")
  // Verifies response shapes match SDK types

describe("Layer 3: Stub Stability")
  // Verifies stubbed endpoints don't crash
```

## Summary

1. Upstream has 830+ tests but only 4 test HTTP endpoints — the rest test internal functions
2. Upstream routes are thin adapters (Zod validation → business logic call → JSON response)
3. Sandbox-agent has two layers: universal (22 endpoints) and OpenCode compat (80+ endpoints)
4. The compat layer is ~40% functional, ~10% proxied, ~50% stubbed
5. All stubs have research specs but none are implemented yet
6. Both sides have well-defined schemas (Zod upstream, TypeScript SDK downstream)
7. Testing gap: nobody tests the translation layer between sandbox-agent and opencode
8. Three-layer test strategy: behavior parity → contract verification → stub stability
