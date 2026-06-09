# Memory Handoff Architecture

## Status
- This is the current final architecture for project memory and GPT5.4/GPT5.5 handoff.
- It keeps opencode core untouched.
- It explicitly allows MCP and other external tools when they are the better fit.
- Final principle: MCP/service first, thin plugin bridge, SQLite canonical, Qdrant optional, Redis deferred.
- Phase 1 through Phase 4 are implemented in the current branch.

## Goal
- Switching between GPT5.4 and GPT5.5 with `/models` must not lose critical project memory.
- The next model must automatically receive active decisions, active risks, pinned notes, final plans, and current code caveats.
- Memory logic must be reusable outside opencode through MCP or a local service interface.
- opencode itself must remain unmodified.

## Reality Boundary
The system cannot transfer:
- hidden reasoning
- provider-native metadata
- signed thinking state
- every historical token verbatim after compaction

The system must transfer:
- critical active decisions
- active risks and rejected options
- current final plans
- current implementation next step
- safety NO-GO rules
- pinned memory notes
- recent visible session summary

This is called `critical project memory handoff`, not total hidden-state transfer.

## Final Architecture

```text
opencode
  -> thin project plugin: trade-handoff-bridge.ts
       -> observes model switch events
       -> calls local trade-memory-service for handoff context
       -> injects returned handoff block into system context
       -> adds critical memory to compaction context
       -> never owns heavy memory logic

  -> existing/custom tools from plugin or MCP
       -> remain available for manual memory operations

local external service: trade-memory-service
  -> owns sync, search, notes, pins, handoff context generation
  -> exposes local HTTP API for thin plugin bridge
  -> exposes MCP tools for opencode agents and external clients
  -> reads opencode.db readonly
  -> writes canonical SQLite memory DB
  -> optionally writes Qdrant semantic index
  -> optionally uses Redis for locks/queues/freshness only

SQLite memory.sqlite3
  -> canonical durable memory store
  -> exact FTS search
  -> notes, pins, handoff state, sync metrics

optional Qdrant
  -> semantic search secondary index
  -> rebuildable from SQLite

optional Redis
  -> queue/lock/freshness/cache only
  -> never canonical memory
```

## Architecture Decision

### MCP/Service First
- The memory system body should live outside opencode as `trade-memory-service`.
- The service owns DB access, search, sync, pins, handoff assembly, and optional Qdrant/Redis integration.
- The service exposes MCP tools so other agents and tools can use memory without plugin coupling.
- The service may also expose a local HTTP API because plugin hooks need deterministic direct access to handoff context.

### Thin Plugin Bridge
- A plugin is still needed only where opencode hooks are required.
- The plugin detects model switch events.
- The plugin injects handoff text with `experimental.chat.system.transform`.
- The plugin contributes critical memory during `experimental.session.compacting`.
- The plugin should not contain heavy DB/search/vector logic.

### SQLite Canonical
- SQLite remains the canonical durable store.
- Existing `memory.sqlite3` remains the migration target.
- SQLite is mandatory even when MCP, Qdrant, or Redis are added.
- Qdrant and Redis must be rebuildable or recoverable from SQLite state.

### Qdrant Optional
- Qdrant is useful for fuzzy recall, research similarity, and old conversation discovery.
- Qdrant is not required for model handoff.
- Qdrant must never override pinned decisions or active risk notes.

### Redis Deferred
- Redis is not needed for the first working implementation.
- Redis may be added for distributed locks, async indexing queues, freshness pubsub, or MCP result cache.
- Redis must never become the source of truth for decisions.

## Why MCP Alone Is Still Not Enough

MCP is excellent for tools. It is not enough for mandatory handoff.

| Requirement | MCP/service | Thin plugin |
|---|---:|---:|
| Exact memory search | yes | not ideal |
| Semantic memory search | yes | no |
| Note and pin management | yes | not ideal |
| Qdrant/Redis integration | yes | no |
| Other clients can use memory | yes | no |
| Detect opencode model switch event | no | yes |
| Inject system context before next LLM turn | no | yes |
| Add memory to compaction context | no | yes |
| Force memory without model choosing a tool | no | yes |

Decision:
- Use MCP/service as the memory system body.
- Use plugin only as the opencode event/system/compaction bridge.

## Component Responsibilities

### `trade-memory-service`
Owns:
- source DB detection
- sync from `opencode.db`
- SQLite migrations
- FTS exact search
- note CRUD
- pin management
- handoff context generation
- sync and handoff health checks
- optional Qdrant indexing and semantic search
- optional Redis queue/lock/cache

Does not own:
- opencode system prompt injection
- opencode model switch hook registration
- opencode compaction hook registration

### `trade-handoff-bridge.ts`
Owns:
- `event` hook for `session.next.model.switched`
- `experimental.chat.system.transform`
- `experimental.session.compacting`
- local service health check
- fallback warning injection if service is unavailable

Does not own:
- SQLite schema
- vector search
- note ranking
- sync implementation
- long-running indexing jobs

### MCP Tools
Expose service operations as tools:
- `trade_memory_sync`
- `trade_memory_search_exact`
- `trade_memory_search_semantic`
- `trade_memory_list_active_decisions`
- `trade_memory_store_note`
- `trade_memory_update_note_status`
- `trade_memory_pin_note`
- `trade_memory_unpin_note`
- `trade_memory_list_pins`
- `trade_memory_get_handoff_context`
- `trade_memory_health`
- `trade_memory_rebuild_semantic_index`

### Existing Plugin Tools
The existing seven plugin tools may remain during migration:
- `sync_trade_memory`
- `search_trade_conversations`
- `open_trade_conversation_source`
- `store_trade_memory_note`
- `update_trade_memory_note_status`
- `search_trade_memory_notes`
- `render_trade_oracle_note`

After MCP/service is stable, these can become thin wrappers around the service or remain for compatibility.

## File Layout

Do not put helper modules directly under `.opencode/plugins/`; opencode auto-loads direct children matching `{plugin,plugins}/*.{ts,js}`.

Use this layout:

```text
.opencode/plugins/trade-memory.ts
.opencode/plugins/trade-handoff-bridge.ts

.opencode/trade-memory-core/db.ts
.opencode/trade-memory-core/schema.ts
.opencode/trade-memory-core/sync.ts
.opencode/trade-memory-core/search.ts
.opencode/trade-memory-core/notes.ts
.opencode/trade-memory-core/pins.ts
.opencode/trade-memory-core/handoff.ts
.opencode/trade-memory-core/render.ts
.opencode/trade-memory-core/redaction.ts
.opencode/trade-memory-core/types.ts

.opencode/mcp/trade-memory-server.ts
.opencode/mcp/service.ts
.opencode/mcp/http.ts
```

## Service Interfaces

## Service Lifecycle

The handoff bridge needs deterministic access to `trade-memory-service`. MCP alone does not guarantee the service is running before a system transform, so lifecycle is explicit.

Startup modes:
- `standalone`: user or supervisor runs `bun .opencode/mcp/trade-memory-server.ts --http`.
- `bridge-autostart`: thin plugin checks `/health` and starts the local service if unavailable.
- `mcp-managed`: opencode starts the MCP server when MCP is enabled; the same process also serves local HTTP.

Default for Phase 4:
- enable `bridge-autostart` for local project use.
- keep MCP disabled until manual test passes.

Bridge autostart constraints:
- start only local project script under `.opencode/mcp/trade-memory-server.ts`.
- never run fetched or remote code.
- log service stderr, never stdout if the process is in MCP stdio mode.
- use `OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART=false` to disable.
- use `OPENCODE_TRADE_MEMORY_SERVICE_COMMAND` only for explicit local override.
- if service still fails, inject a short warning and continue chat.

The bridge may supervise process lifecycle, but it must not implement DB/search logic.

### Local HTTP API
The thin plugin should call a deterministic local API instead of trying to call MCP tools from inside plugin hooks.

Default endpoint:
- `http://127.0.0.1:19787`

Environment overrides:
- `OPENCODE_TRADE_MEMORY_SERVICE_URL`
- `OPENCODE_TRADE_MEMORY_SERVICE_TIMEOUT_MS`
- `OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART`
- `OPENCODE_TRADE_MEMORY_SERVICE_COMMAND`

Required endpoints:
- `GET /health`
- `POST /sync`
- `POST /handoff/context`
- `POST /handoff/model-switched`
- `POST /notes`
- `POST /notes/search`
- `POST /pins`
- `DELETE /pins/:id`
- `POST /semantic/search`

### MCP Server
The MCP server exposes the same service operations as tools.

Future config:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "trade_memory": {
      "type": "local",
      "command": ["bun", ".opencode/mcp/trade-memory-server.ts"],
      "enabled": true,
      "timeout": 5000
    }
  }
}
```

Do not enable this by default until the service and bridge pass manual tests.

## Handoff Flow

```text
1. User switches /models from GPT5.4 to GPT5.5.
2. opencode publishes `session.next.model.switched`.
3. thin plugin bridge receives the event.
4. bridge calls `POST /handoff/model-switched` on trade-memory-service.
5. service records pending handoff state in SQLite.
6. next provider turn starts.
7. bridge receives `experimental.chat.system.transform`.
8. bridge calls `POST /handoff/context` with sessionID/model.
9. service builds bounded critical handoff block.
10. bridge appends the block to `output.system`.
11. service records `handoff_log`.
12. GPT5.5 receives critical project memory before responding.
```

Same flow applies GPT5.5 -> GPT5.4.

## Handoff Context Selection

Priority order:
1. Active pinned notes.
2. Active notes with `importance >= 4`.
3. Active `decision`, `risk`, `unresolved`, `rejection`, `handoff` notes.
4. Current final docs summaries.
5. Current worktree caveats.
6. Recent same-session visible user/assistant text.
7. Exact search results for current task terms.
8. Optional Qdrant semantic recall.

Deprecated notes are excluded unless diagnostic mode is explicitly requested.

## Mandatory Handoff Content

The system should make these appear when active or pinned:
- `Safety Gate first. Strategy second. ML last.`
- `Live trading remains NO-GO until Critical gates pass.`
- `Next implementation task is RiskManager Safety Hardening.`
- `B6 Blind Continuous Learning remains rejected.`
- `MCP/service is the memory body; plugin is the thin handoff bridge.`
- `SQLite is canonical memory; Qdrant is optional secondary.`
- `Redis is deferred and never canonical.`
- `src/Include/TradeLogic.mqh has an uncommitted one-bar-confirmation candidate` when still true.

## Handoff Block Format

```md
# Trade Memory Handoff

This block is generated by trade-memory-service and injected by the project-local thin plugin bridge.
Treat it as authoritative project memory unless the user explicitly overrides it.

## Current Non-Negotiable Decisions
- ...

## Active Risks
- ...

## Current Final Plan
- ...

## Current Code Caveats
- ...

## Recent Session Context
- ...

## Retrieval Hints
- Use MCP `trade_memory_search_exact` for exact history.
- Use MCP `trade_memory_search_semantic` only if Qdrant is enabled.

## Memory Warnings
- ...
```

## Character Budget

Defaults:
- max handoff block: `6000` chars
- max pinned notes: `12`
- max critical notes: `10`
- max recent messages: `8`
- max doc summaries: `4`
- max semantic recalls: `5`

Environment overrides:
- `OPENCODE_TRADE_HANDOFF_MAX_CHARS`
- `OPENCODE_TRADE_HANDOFF_MAX_PINNED_NOTES`
- `OPENCODE_TRADE_HANDOFF_MAX_CRITICAL_NOTES`
- `OPENCODE_TRADE_HANDOFF_RECENT_MESSAGES`
- `OPENCODE_TRADE_HANDOFF_ENABLE_QDRANT`

Truncation rules:
- Never truncate section headings.
- Never truncate pinned note titles.
- Drop semantic recall before exact critical notes.
- Drop recent conversation before pinned decisions.
- Keep memory warnings even when truncated.

## SQLite Schema

Existing canonical tables remain:
- `schema_meta`
- `conversation_index`
- `conversation_fts`
- `memory_note`
- `memory_note_fts`

### Path Argument Normalization

All optional database path arguments must be normalized before opening SQLite.

Required helper behavior:

```ts
const indexDbPath = args.index_db_path?.trim() || DEFAULT_MEMORY_DB
```

Rules:
- missing, `null`, empty, or whitespace-only `index_db_path` uses `DEFAULT_MEMORY_DB`.
- explicit paths are allowed only after trimming.
- log the resolved path in tool/service responses.
- never let `""` reach `new Database(...)`.

Reason:
- SQLite can treat an empty filename as a transient database.
- Writes can appear successful but disappear after close.
- Status updates can report `not found` for IDs that exist in the canonical DB.

Regression tests:
- omitted `index_db_path` writes to `DEFAULT_MEMORY_DB`.
- `index_db_path: ""` writes to `DEFAULT_MEMORY_DB`.
- `index_db_path: "   "` writes to `DEFAULT_MEMORY_DB`.
- explicit valid path writes to that path.
- tool output includes the resolved non-empty `index_db` path.

Add schema versioning:

```sql
insert into schema_meta (key, value, updated_at)
values ('memory_schema_version', '2', strftime('%s','now') * 1000)
on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at;
```

Add sync metrics:

```sql
create table if not exists sync_run (
  id text primary key,
  started_at integer not null,
  finished_at integer,
  source_db_path text not null,
  index_db_path text not null,
  mode text not null,
  source_mode text,
  count integer not null default 0,
  error text
);
```

Add pinned memory:

```sql
create table if not exists memory_pin (
  id text primary key,
  note_id text not null,
  priority integer not null,
  always_include integer not null default 1,
  reason text not null,
  created_at integer not null,
  updated_at integer not null
);
```

Add handoff state:

```sql
create table if not exists handoff_state (
  session_id text primary key,
  last_provider_id text,
  last_model_id text,
  pending_provider_id text,
  pending_model_id text,
  pending_since integer,
  last_injected_at integer,
  last_event_type text,
  updated_at integer not null
);
```

Add handoff logs:

```sql
create table if not exists handoff_log (
  id text primary key,
  session_id text not null,
  provider_id text not null,
  model_id text not null,
  injected_at integer not null,
  note_count integer not null,
  recent_message_count integer not null,
  doc_count integer not null,
  warnings text not null,
  checksum text not null
);
```

Add optional semantic index tracking:

```sql
create table if not exists semantic_index_state (
  id text primary key,
  backend text not null,
  collection text not null,
  last_indexed_at integer,
  last_conversation_id integer,
  last_note_updated_at integer,
  error text,
  updated_at integer not null
);
```

## Search Improvements

Required before handoff bridge is enabled:
- Escape `%`, `_`, and `\` in LIKE fallback.
- Rename warning from `FTS unavailable` to `FTS query failed, using LIKE fallback`.
- Record search mode: `fts`, `like`, or `none`.
- Keep FTS and LIKE results redacted.

## Redaction Rules

Existing secret redaction remains mandatory.

Add project-specific redaction candidates:
- broker account numbers when clearly labeled
- API keys and token-like values
- SSH private key blocks
- RDP passwords
- OAuth tokens
- `.secrets/*` file contents

Do not redact ordinary file paths, commit IDs, strategy names, model IDs, or public tool names.

## Qdrant Plan

### When To Add
Add Qdrant only after:
- SQLite migrations are stable.
- MCP/service tools pass tests.
- thin plugin handoff works without Qdrant.

### What To Index
- `conversation_index.text`
- active `memory_note.title + body`
- final plan summaries
- research hypothesis cards after they exist

### What Not To Index
- hidden reasoning
- raw tool outputs containing secrets
- deprecated memory unless diagnostic mode is enabled
- source DB raw JSON

### Collections
- `opencode_trade_conversations`
- `opencode_trade_notes`

### Rebuild Rule
SQLite is canonical. Qdrant can be dropped and rebuilt at any time.

## Redis Plan

### Current Decision
Do not use Redis in the first implementation.

### Allowed Future Uses
- cross-process sync lock
- service queue
- Qdrant indexing queue
- freshness pubsub
- MCP result cache

### Forbidden Uses
- canonical memory body storage
- critical decision storage without SQLite copy
- replacing SQLite sync cursor

## Implementation Phases

## Phase 0: Architecture Update

Goal:
- Freeze this final service-first architecture.

Tasks:
1. Keep `PHASE1_MEMORY_ORACLE.md` as the Phase 1 historical memory plan.
2. Use this document as the Phase 2+ memory handoff architecture.
3. Do not touch unrelated EA changes.

Acceptance:
- This document exists.
- No code behavior changed.

## Phase 1: Extract Shared Memory Core

Goal:
- Move logic out of the monolithic plugin without behavior change.

Files:
- `.opencode/plugins/trade-memory.ts`
- `.opencode/trade-memory-core/db.ts`
- `.opencode/trade-memory-core/schema.ts`
- `.opencode/trade-memory-core/sync.ts`
- `.opencode/trade-memory-core/search.ts`
- `.opencode/trade-memory-core/notes.ts`
- `.opencode/trade-memory-core/redaction.ts`
- `.opencode/trade-memory-core/types.ts`

Tasks:
1. Move DB open/close to `db.ts`.
2. Move schema and migration to `schema.ts`.
3. Move source extraction and sync to `sync.ts`.
4. Move FTS/LIKE search to `search.ts`.
5. Move note CRUD to `notes.ts`.
6. Move redaction to `redaction.ts`.
7. Keep existing seven tool names unchanged.

Acceptance:
- Existing seven tools still work.
- No helper module is auto-loaded as a plugin.
- Behavior changes only where explicitly listed as bug fixes later.

## Phase 2: Harden SQLite Memory Store

Goal:
- Make the canonical store reliable enough for service and handoff.

Tasks:
1. Add schema versioning.
2. Add `sync_run`.
3. Add `memory_pin`.
4. Add `handoff_state`.
5. Add `handoff_log`.
6. Implement LIKE escaping.
7. Split FTS query error from missing FTS.
8. Add sync diagnostics.
9. Normalize optional DB path arguments before opening SQLite.
10. Add regression coverage for empty and whitespace-only `index_db_path`.

Acceptance:
- Existing DB migrates without data loss.
- Full resync still works.
- Incremental sync still works.
- Failed sync is recorded and does not crash chat.
- Empty or whitespace-only `index_db_path` cannot create a transient SQLite DB.
- Note store/search/update all report the same resolved canonical DB path by default.

## Phase 3: Build `trade-memory-service`

Goal:
- Move memory operations into an external local service.

Files:
- `.opencode/mcp/service.ts`
- `.opencode/mcp/http.ts`
- `.opencode/mcp/trade-memory-server.ts`

Tasks:
1. Implement service object using shared core modules.
2. Implement local HTTP endpoints.
3. Implement MCP tools around the same service object.
4. Add health endpoint.
5. Keep service local-only by default.

Acceptance:
- Service starts locally.
- `GET /health` succeeds.
- MCP tools can read SQLite memory.
- HTTP `POST /handoff/context` returns a bounded handoff block.

## Phase 4: Add Thin Handoff Bridge Plugin

Goal:
- Connect opencode lifecycle hooks to the service.

Files:
- `.opencode/plugins/trade-handoff-bridge.ts`

Tasks:
1. Check service `/health` on plugin startup.
2. Autostart local service when enabled and unavailable.
3. Detect `session.next.model.switched` in `event` hook.
4. Call `POST /handoff/model-switched`.
5. On `experimental.chat.system.transform`, call `POST /handoff/context`.
6. Append returned block to `output.system`.
7. On `experimental.session.compacting`, request compact critical memory from service.
8. If service is down, inject a short warning instead of throwing.

Acceptance:
- Bridge autostarts the service in local mode or reports service unavailable.
- GPT5.4 -> GPT5.5 injects critical memory on the next turn.
- GPT5.5 -> GPT5.4 does the same.
- Plugin remains thin.
- Plugin failure does not crash chat.

## Phase 5: Add Pins and Handoff Tools

Goal:
- Let agents and user inspect/manage critical memory.

Status:
- implemented during Phase 3 service/MCP work.

MCP tools:
- `trade_memory_get_handoff_context`
- `trade_memory_pin_note`
- `trade_memory_unpin_note`
- `trade_memory_list_pins`
- `trade_memory_health`

Optional plugin compatibility tools:
- `preview_trade_handoff_context`
- `pin_trade_memory_note`
- `unpin_trade_memory_note`
- `list_trade_memory_pins`

Acceptance:
- Preview output matches injected content except volatile timestamps.
- Pinned notes appear first.
- Deprecated notes are excluded.

## Phase 6: Optional Qdrant Semantic Index

Goal:
- Add fuzzy recall without weakening exact critical handoff.

Tasks:
1. Add Qdrant config via env vars.
2. Add embedding adapter behind an interface.
3. Index from SQLite only.
4. Store payload checksums.
5. Add semantic MCP search tool.
6. Keep disabled by default.

Acceptance:
- Handoff works with Qdrant disabled.
- Qdrant can be rebuilt from SQLite.
- Semantic results never override pinned decisions.

## Test Plan

### Unit Tests
- `escapeLikePattern`
- `redactSecrets`
- `detectModelSwitchedEvent`
- `renderHandoffSystemBlock`
- `truncateHandoffContext`
- `selectPinnedNotes`
- `selectCriticalNotes`
- `dedupeByChecksum`
- service request/response schemas

### Integration Tests
- temp SQLite schema migration
- existing DB migration from v1 to v2
- sync_run success and failure recording
- FTS success
- FTS query failure fallback to escaped LIKE
- service `GET /health`
- service `POST /handoff/context`
- MCP tool exact search
- pinned memory inclusion
- deprecated memory exclusion
- model switch event calls service
- system transform injects returned block
- compaction hook includes critical memory
- plugin hook failures do not throw

### Manual Tests
1. Store active decision note: `Safety Gate first. Strategy second. ML last.`
2. Pin the note.
3. Start `trade-memory-service`.
4. Confirm `GET /health` works.
5. Enable thin bridge plugin.
6. Switch `/models` from GPT5.4 to GPT5.5.
7. Ask the next model what the current final plan is.
8. Confirm it mentions RiskManager first and live trading NO-GO.
9. Switch back to GPT5.4.
10. Repeat the same check.

## Operational Guarantees

Guaranteed after Phase 4:
- model switch reaches service
- next provider turn receives critical handoff block when service is healthy
- active pinned memory is included
- deprecated memory is excluded
- service and bridge failures are visible but do not crash chat

Not guaranteed:
- hidden reasoning preservation
- provider-native metadata preservation
- all historical text in context
- Qdrant semantic accuracy
- Redis-backed distributed consistency

## Risks and Mitigations

### Service Down
Mitigation:
- bridge injects warning
- manual MCP/service health tool
- optional fallback to direct SQLite later if necessary

### Context Bloat
Mitigation:
- strict character budget
- pinned and critical memory first
- semantic recall last

### Stale Memory
Mitigation:
- include `last_sync_at`
- warn when stale
- allow manual sync

### Transient SQLite DB From Empty Path
Mitigation:
- normalize optional DB paths with `trim() || DEFAULT_MEMORY_DB`
- add regression tests for omitted, empty, whitespace-only, and explicit paths
- include resolved DB path in every write/update/search response
- fail fast if a resolved canonical DB path is still empty

### MCP Tool Overhead
Mitigation:
- keep MCP disabled until tested
- expose only necessary tools
- disable broad MCP tools per agent if needed

### Qdrant Drift
Mitigation:
- checksum payloads
- rebuild from SQLite
- never make Qdrant canonical

### Bad Pinned Notes
Mitigation:
- require active status
- show importance and reason in preview
- provide unpin tool

## Commit Boundaries

### Commit 1
`docs(opencode): revise memory handoff service architecture`
- Update this document only.

### Commit 2
`refactor(opencode): extract trade memory core modules`
- Move memory code out of monolithic plugin.

### Commit 3
`fix(opencode): harden canonical memory store`
- Migration versioning, sync_run, pins, handoff tables, LIKE escape, DB path normalization.

### Commit 4
`feat(opencode): add trade memory service and mcp tools`
- Local service, HTTP API, MCP tools.

### Commit 5
`feat(opencode): add thin trade handoff bridge plugin`
- Model switch event bridge and system injection.

### Commit 6
`feat(opencode): add memory pins and handoff management tools`
- Pin/unpin/list/preview/health.

### Commit 7
`feat(opencode): add optional qdrant semantic memory index`
- Disabled by default.

## Go/No-Go Gates

### Service GO
- SQLite migration succeeds.
- `GET /health` succeeds.
- exact search works.
- handoff context endpoint returns expected block.
- empty and whitespace-only `index_db_path` resolve to the canonical DB.

### MCP GO
- service works without MCP first.
- MCP server starts and stops cleanly.
- MCP tools do not bloat default context excessively.

### Bridge Plugin GO
- service is healthy.
- bridge autostart behavior is tested.
- model switch event observed.
- system transform injection confirmed.
- service-down warning confirmed.

### Qdrant GO
- SQLite and bridge handoff are stable.
- embedding path is deterministic and redacted.
- rebuild procedure is documented.

### Redis GO
- real multi-process coordination problem exists.
- SQLite-only local workflow is proven insufficient.

## Immediate Next Step

Run live verification next:
- restart opencode so plugin changes load
- verify `trade-memory-server` autostart or manual `--http` startup
- switch `/models` and confirm handoff injection on the next turn
- verify service-down warning path
- do not touch unrelated EA changes

## Final Decision

```text
MCP/service first
  + thin plugin bridge for opencode hooks
  + SQLite canonical memory
  + optional Qdrant semantic secondary index
  + Redis only when coordination is actually needed
```

This is the safest final design because the memory system is external and reusable, while the thin plugin only handles opencode-specific lifecycle injection.
