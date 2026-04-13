# Agent Communication Plugin — Implementation Plan

> TDD (Test-Driven Development) plan cho `opencode-agent-comms` plugin.

---

## Tổng quan

Plugin là một npm package riêng (`opencode-agent-comms`), install qua `opencode.json`:

```json
{
  "plugin": [["opencode-agent-comms", { "max_depth": 5, "max_retry": 2 }]]
}
```

---

## Thứ tự implement (TDD cycles)

Mỗi phase: **Viết test → Implement → Refactor**. Test chạy được trước khi implement.

---

### Phase 1: Database Layer (`src/db.ts`)

**File:** `test/db.test.ts` → `src/db.ts`

#### 1.1 Init & Schema

```ts
// test/db.test.ts
describe("db.initDb", () => {
  it("creates database with correct schema")
  it("sets WAL mode and read_uncommitted")
  it("creates all required tables: messages, registry, conversations")
  it("creates all required indexes")
  it("is idempotent — calling twice does not error")
})
```

#### 1.2 Registry CRUD

```ts
describe("db registry", () => {
  it("upsertRegistry inserts new entry")
  it("upsertRegistry updates existing entry")
  it("getRegistry returns entry by session_id")
  it("getRegistry returns undefined for missing session")
  it("deleteRegistry removes entry")
  it("isSubSession returns true when is_subsession=1")
  it("isSubSession returns false when is_subsession=0")
  it("updateLastAgent updates last_agent field")
  it("syncSubSessionFlags batch updates is_subsession")
})
```

#### 1.3 Messages CRUD

```ts
describe("db messages", () => {
  it("insertMessage inserts a message record")
  it("insertMessages batch inserts in transaction")
  it("getMessages returns filtered messages")
  it("getMessages filters by to_session")
  it("getMessages filters by from_session")
  it("getMessages filters by unread_only")
  it("getMessages filters by conversation_id")
  it("getMessages filters by type")
  it("getMessages filters by status (excludes orphaned)")
  it("getMessages respects limit and ordering")
  it("markRead marks messages as read")
  it("markOrphaned marks all messages for a session as orphaned")
  it("getUnreadCount returns count of unread messages")
  it("getUnreadSummary groups unread by sender + conversation")
  it("getPendingMessages returns messages with status='pending'")
  it("incrementRetryCount increments retry_count for a message")
})
```

#### 1.4 Conversations CRUD

```ts
describe("db conversations", () => {
  it("upsertConversation inserts new conversation")
  it("upsertConversation updates existing conversation")
  it("getConversation returns conversation by id")
  it("getConversation returns undefined for missing id")
})
```

#### 1.5 Cleanup

```ts
describe("db cleanup", () => {
  it("purgeExpired removes messages past TTL")
  it("getBroadcastCount counts broadcasts within time window")
  it("getBroadcastCount returns 0 when no broadcasts in window")
})
```

---

### Phase 2: Config Parser (`src/config.ts`)

**File:** `test/config.test.ts` → `src/config.ts`

```ts
describe("parseConfig", () => {
  it("returns defaults when options is undefined")
  it("merges user options with defaults")
  it("validates max_depth is positive integer")
  it("validates max_retry is non-negative integer")
  it("validates sync_timeout_ms is positive")
  it("validates broadcast_max_recipients is positive")
  it("validates broadcast_rate_limit_per_minute is positive")
  it("validates include_thinking is boolean")
  it("validates message_ttl_ms is positive")
  it("resolves db_path relative to project directory")
  it("throws on invalid types")
})
```

Config defaults:

```ts
const DEFAULTS = {
  max_depth: 5,
  max_retry: 2,
  sync_timeout_ms: 60000,
  broadcast_max_recipients: 10,
  broadcast_rate_limit_per_minute: 5,
  include_thinking: false,
  message_ttl_ms: 86400000,
  db_path: ".opencode/agent-comms.db",
}
```

---

### Phase 3: Helpers & Utilities (`src/helpers.ts`)

**File:** `test/helpers.test.ts` → `src/helpers.ts`

#### 3.1 Permission Summary

```ts
describe("permissionSummary", () => {
  it("returns 'full permissions' for build agent")
  it("returns 'plan mode, no edits' for plan agent")
  it("returns 'subagent, read-only' for explore agent")
  it("returns custom summary for custom agents")
  it("handles unknown agents gracefully")
})
```

#### 3.2 Agent info extraction

```ts
describe("getAgentInfo", () => {
  it("extracts last agent from session messages")
  it("returns 'unknown' when no messages exist")
  it("returns 'unknown' when last message has no agent field")
})
```

#### 3.3 Response extraction

```ts
describe("extractResponse", () => {
  it("extracts last text part content")
  it("includes thinking when include_thinking=true")
  it("wraps thinking in <thinking> tags")
  it("handles empty response gracefully")
  it("handles response with only thinking parts")
})
```

#### 3.4 Prompt formatting

```ts
describe("formatPrompt", () => {
  it("formats outgoing prompt with all fields")
  it("includes permission summary for target agent")
  it("includes depth info")
  it("includes conversation_id")
  it("includes instructions block")
})
```

#### 3.5 System prompt inject formatting

```ts
describe("formatSystemInject", () => {
  it("formats unread messages notification")
  it("formats crash alert with retry info")
  it("formats crash alert with undo/respawn suggestions")
  it("returns empty string when no messages and no crashes")
})
```

---

### Phase 4: Tool — `agent_list` (`src/tools/agent-list.ts`)

**File:** `test/tools/agent-list.test.ts` → `src/tools/agent-list.ts`

```ts
describe("agent_list tool", () => {
  it("returns list of non-hidden agents")
  it("excludes hidden agents (compaction, title, summary)")
  it("includes permission summary for each agent")
  it("includes agent mode (primary/subagent)")
  it("includes agent description")
  it("merges config overrides with built-in defaults")
  it("includes custom agents from config")
  it("handles missing config gracefully (defaults only)")
})
```

**Implementation notes:**

- Hardcode built-in agents: build, plan, explore, general
- Cache agent list from `config` hook in plugin-level variable
- Config only contains overrides (not full definitions) — merge with built-in defaults
- Hidden agents excluded: compaction, title, summary

---

### Phase 5: Tool — `session_list` (`src/tools/session-list.ts`)

**File:** `test/tools/session-list.test.ts` → `src/tools/session-list.ts`

```ts
describe("session_list tool", () => {
  it("returns list of primary sessions")
  it("filters out sub-sessions (parentID != null)")
  it("filters out hidden-agent sessions")
  it("filters by status when provided")
  it("filters by conversation_id when provided")
  it("includes last agent name for each session")
  it("includes permission summary for each session")
  it("includes depth from registry")
  it("includes unread count from messages table")
  it("marks crashed sessions with warning")
  it("handles empty session list")
  it("handles SDK error gracefully")
})
```

**Implementation notes:**

- Gọi `client.session.list()`
- Filter client-side (SDK không filter parentID)
- Cross-reference với registry để lấy depth, last_agent, unread count

---

### Phase 6: Tool — `session_send` (`src/tools/session-send.ts`)

**File:** `test/tools/session-send.test.ts` → `src/tools/session-send.ts`

Đây là tool phức tạp nhất. Test theo từng scenario.

#### 6.1 Pre-flight checks

```ts
describe("session_send pre-flight", () => {
  it("rejects self-send")
  it("rejects sub-session target")
  it("rejects when max depth reached")
  it("rejects when target not found")
  it("rejects hidden-agent target")
  it("rejects busy target in sync mode (calls status API)")
  it("allows busy target in async mode")
  it("validates agent type exists, fallback to build")
  it("ignores session_id when new_session=true")
})
```

#### 6.2 New session flow

```ts
describe("session_send new_session=true", () => {
  it("creates new session via client.session.create()")
  it("sends message via client.session.prompt() after create")
  it("uses specified agent type")
  it("falls back to build agent when agent not specified")
  it("falls back to build agent when agent not found")
  it("auto-generates conversation_id")
  it("uses provided conversation_id")
  it("returns session_id and conversation_id in response")
  it("records message in SQLite after SDK success")
  it("updates registry after SDK success")
  it("creates conversation record")
  it("does NOT record in SQLite if SDK call fails")
  it("handles timeout in sync mode")
  it("handles abort signal")
})
```

#### 6.3 Existing session flow

```ts
describe("session_send new_session=false", () => {
  it("sends message to existing session")
  it("requires session_id")
  it("reuses conversation_id from previous message in thread")
  it("auto-generates conversation_id for new thread")
  it("records in SQLite after SDK success")
  it("updates depth in registry")
  it("handles sync timeout")
  it("handles async mode")
  it("handles abort signal")
})
```

#### 6.4 Retry logic (crash recovery)

```ts
describe("session_send retry", () => {
  it("retries on session crash when retry_count < max_retry")
  it("increments retry_count on each retry")
  it("returns crash notification when max_retry reached")
  it("updates registry status to 'crashed' on max retry")
  it("includes undo/respawn suggestions in crash notification")
  it("does not retry in async mode")
})
```

**Implementation notes for mock:**

- Mock `client.session.prompt()` to simulate success/crash/timeout
- Mock `client.session.get()` to return session info with/without parentID
- Mock `client.session.promptAsync()` for async tests
- Use in-memory SQLite (`":memory:"`) for DB tests

---

### Phase 7: Tool — `session_read` (`src/tools/session-read.ts`)

**File:** `test/tools/session-read.test.ts` → `src/tools/session-read.ts`

```ts
describe("session_read tool", () => {
  it("returns unread messages for current session")
  it("filters by from_session")
  it("filters by conversation_id")
  it("filters by type")
  it("respects limit")
  it("marks messages as read after fetching")
  it("excludes orphaned messages")
  it("excludes expired messages")
  it("returns formatted output with sender info")
  it("returns 'No unread messages' when empty")
  it("includes agent name and depth for each message")
  it("orders by timestamp DESC")
})
```

---

### Phase 8: Tool — `agent_broadcast` (`src/tools/agent-broadcast.ts`)

**File:** `test/tools/agent-broadcast.test.ts` → `src/tools/agent-broadcast.ts`

```ts
describe("agent_broadcast tool", () => {
  it("sends to existing sessions via session_ids")
  it("spawns new sessions via new_agent_types")
  it("combines existing + new sessions")
  it("filters out sub-sessions from session_ids")
  it("filters out hidden-agent sessions from session_ids")
  it("validates agent types, fallback to build")
  it("respects broadcast_max_recipients limit")
  it("respects broadcast_rate_limit_per_minute")
  it("sends sequential, not parallel")
  it("records all messages in SQLite after all SDK calls succeed")
  it("does NOT record if any SDK call fails (all-or-nothing)")
  it("returns summary with success/failure counts")
  it("auto-generates shared conversation_id")
  it("excludes self when exclude_self=true (default)")
  it("handles empty recipients gracefully")
})
```

**Revision on all-or-nothing:** Partial success is acceptable for broadcast. Record successful sends, skip failed ones. Update spec accordingly.

```ts
// Revised: record successes, report failures
it("records successful sends even when some fail")
it("reports failed sends in summary")
```

---

### Phase 9: Hook — `event` (`src/hooks/event.ts`)

**File:** `test/hooks/event.test.ts` → `src/hooks/event.ts`

```ts
describe("event hook", () => {
  it("handles session.created — inserts registry")
  it("handles session.created — sets is_subsession from parentID")
  it("handles session.idle — updates status, resets depth")
  it("handles session.idle — updates last_agent")
  it("handles session.updated — updates last_agent")
  it("handles session.updated — updates is_subsession if parentID changed")
  it("handles session.error — updates status to error")
  it("handles session.error — checks pending messages for retry")
  it("handles session.error — triggers retry when retry_count < max_retry")
  it("handles session.error — marks crashed when max_retry reached")
  it("handles session.deleted — marks messages orphaned")
  it("handles session.deleted — removes from registry")
  it("ignores events for sub-sessions")
  it("handles unknown event types gracefully")
})
```

---

### Phase 10: Hook — `system.transform` (`src/hooks/system-inject.ts`)

**File:** `test/hooks/system-inject.test.ts` → `src/hooks/system-inject.ts`

```ts
describe("system.transform hook", () => {
  it("injects unread messages notification")
  it("includes sender session info with agent names")
  it("includes active conversations list")
  it("does NOT inject when no unread messages")
  it("does NOT inject for sub-sessions")
  it("injects crash alert for crashed sessions")
  it("includes undo/respawn suggestions in crash alert")
  it("formats notification section correctly")
  it("handles multiple crashed sessions")
  it("handles both unread + crash alerts simultaneously")
})
```

---

### Phase 11: Plugin Entry Point (`src/index.ts`)

**File:** `test/index.test.ts` → `src/index.ts`

```ts
describe("plugin entry", () => {
  it("exports default object with server function")
  it("parses config options")
  it("initializes SQLite database")
  it("registers all 5 tools")
  it("registers event hook")
  it("registers system.transform hook")
  it("runs cleanup job on init")
  it("cleanup purges expired messages")
  it("cleanup syncs registry with actual sessions")
  it("cleanup marks orphaned for missing sessions")
  it("handles missing config gracefully (uses defaults)")
})
```

---

### Phase 12: Integration Tests (`test/integration.test.ts`)

Full workflow tests with mocked SDK.

```ts
describe("integration: spawn and communicate", () => {
  it("agent A spawns session B and gets response")
  it("agent A sends follow-up to session B")
  it("agent A reads response from session B")
  it("agent A spawns multiple sessions via broadcast")
  it("agent B replies to agent A via session_send")
  it("conversation_id persists across multiple exchanges")
})

describe("integration: error recovery", () => {
  it("agent A gets crash notification and retries")
  it("agent A gets crash notification and spawns replacement")
  it("depth limit prevents infinite delegation")
  it("timeout handled gracefully")
})

describe("integration: sub-session isolation", () => {
  it("session_list excludes sub-sessions")
  it("session_send rejects sub-session target")
  it("agent_broadcast skips sub-sessions")
})

describe("integration: lifecycle", () => {
  it("session.idle resets depth")
  it("session.deleted marks messages orphaned")
  it("system prompt inject shows unread messages")
  it("system prompt inject disappears after reading")
})
```

---

## File Structure Final

```
packages/agent-comms-plugin/
├── package.json
├── tsconfig.json
├── SPEC.md                        # Detailed specification
├── PLAN.md                        # This file
├── src/
│   ├── index.ts                   # Plugin entry point
│   ├── config.ts                  # Config parser + defaults
│   ├── db.ts                      # SQLite init + CRUD
│   ├── helpers.ts                 # Utility functions
│   ├── tools/
│   │   ├── agent-list.ts          # agent_list tool
│   │   ├── session-list.ts        # session_list tool
│   │   ├── session-send.ts        # session_send tool
│   │   ├── session-read.ts        # session_read tool
│   │   └── agent-broadcast.ts     # agent_broadcast tool
│   └── hooks/
│       ├── event.ts               # event hook
│       └── system-inject.ts       # experimental.chat.system.transform hook
└── test/
    ├── db.test.ts
    ├── config.test.ts
    ├── helpers.test.ts
    ├── index.test.ts
    ├── tools/
    │   ├── agent-list.test.ts
    │   ├── session-list.test.ts
    │   ├── session-send.test.ts
    │   ├── session-read.test.ts
    │   └── agent-broadcast.test.ts
    ├── hooks/
    │   ├── event.test.ts
    │   └── system-inject.test.ts
    └── integration.test.ts
```

---

## Test Infrastructure

### Mock strategy

```ts
// test/helpers/mock.ts

// Mock OpencodeClient
export function createMockClient(overrides?: Partial<MockClient>): MockClient

// Mock SQLite — use in-memory DB
export function createTestDb(): Promise<Database>

// Mock PluginInput
export function createMockInput(overrides?: Partial<PluginInput>): PluginInput

// Mock ToolContext
export function createMockContext(overrides?: Partial<ToolContext>): ToolContext
```

### Test config

```ts
// test/helpers/config.ts
export const TEST_CONFIG = {
  max_depth: 3, // Low for faster testing
  max_retry: 1, // Low for faster testing
  sync_timeout_ms: 5000, // Short timeout
  broadcast_max_recipients: 5,
  broadcast_rate_limit_per_minute: 10,
  include_thinking: false,
  message_ttl_ms: 3600000, // 1 hour
  db_path: ":memory:",
}
```

---

## Execution Order

| Phase     | Description             | Depends on    | Est. tests     |
| --------- | ----------------------- | ------------- | -------------- |
| 1         | Database layer          | —             | ~30            |
| 2         | Config parser           | —             | ~10            |
| 3         | Helpers                 | —             | ~15            |
| 4         | `agent_list` tool       | Phase 3       | ~6             |
| 5         | `session_list` tool     | Phase 1, 3    | ~12            |
| 6         | `session_send` tool     | Phase 1, 2, 3 | ~25            |
| 7         | `session_read` tool     | Phase 1       | ~12            |
| 8         | `agent_broadcast` tool  | Phase 1, 2, 3 | ~16            |
| 9         | `event` hook            | Phase 1       | ~14            |
| 10        | `system.transform` hook | Phase 1, 3    | ~10            |
| 11        | Plugin entry            | Phase 1-10    | ~10            |
| 12        | Integration             | Phase 11      | ~12            |
| **Total** |                         |               | **~172 tests** |

---

## Resolved Open Questions

### Q1: Agent list access — Option A: `config` hook ✅

**Verified:** Plugin hook `config(input)` nhận `Config` object có field `agent`:

```ts
config?: {
  agent?: {
    plan?: AgentConfig
    build?: AgentConfig
    general?: AgentConfig
    explore?: AgentConfig
    title?: AgentConfig
    summary?: AgentConfig
    compaction?: AgentConfig
    [key: string]: AgentConfig | undefined  // custom agents
  }
}
```

**Strategy:**

- Hardcode built-in agent defaults (build, plan, explore, general) with known permissions
- Use `config` hook to receive overrides + custom agents
- Merge: built-in defaults ← config overrides = final agent list
- Hidden agents (compaction, title, summary) excluded from tool output

### Q2: Session creation — Option A: `create()` + `prompt()` ✅

**Verified:** SDK has separate methods:

- `client.session.create({ title, permission })` → returns session with ID
- `client.session.prompt({ sessionID, parts, agent })` → sends message

**Flow:** create() first → get sessionID → prompt() with sessionID.

### Q3: Session busy check — Option A: Status API ✅

**Verified:** SDK has `client.session.status()` → returns `Record<sessionID, { type: "idle" | "busy" | "retry" }>`.

**Strategy:** Call `status()` during pre-flight check in `session_send`. No local caching needed — single API call, fast enough.

### Q4: Message agent field — Option B: Track via event hook ✅

**Verified:** Events `session.updated` and `message.updated` provide enough info.

**Strategy:** Track `last_agent` in registry via event hook. When `message.updated` fires with `role: "user"`, extract `agent` field and update registry. No messages API call needed for `session_list`.

---

## Open Questions (resolve before Phase 4)

~~1. **Agent list access:**~~ ✅ Resolved — config hook + hardcoded defaults

~~2. **Session creation:**~~ ✅ Resolved — create() + prompt()

~~3. **Session status:**~~ ✅ Resolved — status() API call

~~4. **Message agent field:**~~ ✅ Resolved — event hook tracking

---

## Build & Publish

```bash
# Install dependencies
bun install

# Run tests
bun test

# Typecheck
bun run typecheck

# Build (transpile to dist/)
bun run build

# Publish to npm
npm publish --access public
```

### Usage in opencode.json

```json
{
  "plugin": [
    [
      "opencode-agent-comms",
      {
        "max_depth": 5,
        "max_retry": 2,
        "sync_timeout_ms": 60000
      }
    ]
  ]
}
```
