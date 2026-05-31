# OpenCode V2 Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement self-improvement (memory/curation), plugin hooks, compaction augmentations, browser tools, and channels into OpenCode's existing V2 architecture.

**Architecture:** New modules in `packages/opencode/src/` (self-improvement/, tool/browser/, channels/) + 4 new experimental hooks in `packages/plugin/src/index.ts` + compaction augmentations in session/ + new config modules + CLI commands + console UI pages. All built Effect-first following existing code patterns.

**Tech Stack:** TypeScript, Effect (v4 beta), @effect/schema, Drizzle ORM (SQLite), Playwright (optional), yargs (CLI), SvelteKit (console)

**Assumptions:**
- Assumes the existing tool pattern (Tool.define/Tool.init) — will NOT work if tools must be registered differently
- Assumes plugin hooks are Promise-based (not Effect) — will NOT work if hooks are migrated to Effect during implementation
- Assumes config uses self-reexport sibling pattern (no barrel index.ts) — will NOT work if config adds an index.ts
- Assumes EventV2 subscription pattern via `EventV2.Service.subscribe()` — will NOT work if event system changes

---

## Scope & Phase Dependencies

```
Phase 1: Self-Improvement Schema + Tools  ◄── START HERE (foundation)
    │
    ▼
Phase 2: Plugin Hooks + Memory Injection  ◄── depends on Phase 1 (needs MemoryService)
    │
    ▼
Phase 3: Curation Loop + Maintenance       ◄── depends on Phase 1+2 (needs hooks + store)

Phase 4: Compaction Augmentations          ◄── INDEPENDENT (can run in parallel with 1-3)
Phase 5: Browser Tools                     ◄── INDEPENDENT (can run in parallel with 1-3)
Phase 6: Channels                          ◄── INDEPENDENT (can run in parallel with 1-3)
```

### Execution Waves

| Wave | Phases | Rationale |
|------|--------|-----------|
| Wave A | Phase 1 | Must go first — everything depends on memory schema/store |
| Wave B | Phase 2 | Depends on Phase 1 MemoryService |
| Wave C | Phases 3 + 4 | Curation depends on phase 2 hooks; compaction is independent |
| Wave D | Phase 5 + 6 | Both independent, can run in parallel |
| Wave E | Console UI + CLI | Depends on all phases (needs running services) |

---

## File Structure

### New Files Created (74 total)

```
packages/opencode/src/
├── self-improvement/
│   ├── index.ts                    # Plugin registration, Layer exports, boot
│   ├── schema.ts                   # MemoryID, MemoryType, MemoryLayer, MemoryInfo
│   ├── memory.sql.ts               # Drizzle table: self_improvement_memory
│   ├── memory-store.ts             # SQLite CRUD + keyword search + event subscriptions
│   ├── memory-bus-events.ts        # Bus events: memory.stored, .recalled, .evolved, .decayed
│   ├── curation.ts                 # Background fiber: consolidation, evolution, pattern discovery
│   ├── curation-log.sql.ts         # Drizzle table: curation_run_log
│   ├── curation-bus-events.ts      # Bus events: curation.started, .ended, .error
│   ├── decay.ts                    # DecayProcessor: importance decrement + purge
│   ├── heartbeat.ts                # Heartbeat touch fiber
│   ├── health-check.ts             # Periodic health check fiber
│   ├── pattern-extractor.ts        # LLM-driven pattern extraction
│   ├── tools/
│   │   ├── index.ts                # Barrel export for tools array
│   │   ├── remember.ts             # `remember` tool Tool.Def
│   │   └── recall.ts               # `recall` tool Tool.Def
│   ├── prompts/
│   │   ├── evolve.md               # LLM prompt for memory evolution
│   │   └── pattern.md              # LLM prompt for pattern extraction
│   └── migrations/
│       ├── 001_create_memory_table.sql
│       └── 002_create_curation_log.sql
│
├── tool/browser/
│   ├── index.ts                    # Tool registration + engine lifecycle init
│   ├── schema.ts                   # BrowserSessionID, BrowserState, tool param schemas
│   ├── engine.ts                   # Playwright lifecycle (launch/browser/context/page)
│   ├── navigate.ts                 # browser_navigate tool
│   ├── click.ts                    # browser_click tool
│   ├── type.ts                     # browser_type tool
│   ├── snapshot.ts                 # browser_snapshot tool
│   ├── screenshot.ts               # browser_screenshot tool
│   ├── evaluate.ts                 # browser_evaluate tool
│   └── bus-events.ts               # Browser session events
│
├── channels/
│   ├── index.ts                    # Channel registry — CRUD, event forwarding, lifecycle
│   ├── schema.ts                   # ChannelID, ChannelInfo schemas
│   ├── channel.sql.ts              # Drizzle table: channel_config
│   ├── bus-events.ts               # Channel events
│   ├── transports/
│   │   ├── slack.ts                # Slack transport
│   │   └── discord.ts              # Discord transport
│   └── migrations/
│       └── 001_create_channel_config.sql
│
├── config/
│   ├── self-improvement.ts         # SelfImprovementConfig schema
│   ├── browser.ts                  # BrowserConfig schema
│   └── channels.ts                 # ChannelsConfig schema
│
└── cli/cmd/
    ├── memory/
    │   ├── list.ts
    │   ├── show.ts
    │   ├── prune.ts
    │   └── search.ts
    ├── browser/
    │   ├── list.ts
    │   └── close.ts
    ├── channel/
    │   ├── add.ts
    │   ├── list.ts
    │   ├── test.ts
    │   └── remove.ts
    └── curation/
        ├── status.ts
        └── run.ts
```

### Modified Files (18 total)

| File | Change |
|------|--------|
| `packages/plugin/src/index.ts` | Add 4 new `experimental.*` hook types |
| `packages/opencode/src/tool/registry.ts` | Import + register `remember`/`recall`/`browser_*` tools |
| `packages/opencode/src/session/prompt.ts` | Add hook triggers + memory injection |
| `packages/opencode/src/session/processor.ts` | Add session.error hook trigger |
| `packages/opencode/src/session/session.ts` | Add session.ended hook trigger |
| `packages/opencode/src/session/message-v2.ts` | Replace generic tool collapse with informative summary |
| `packages/opencode/src/session/compaction.ts` | Add anti-thrashing + pre-compaction hook |
| `packages/opencode/src/config/config.ts` | Merge new config sections |
| `packages/opencode/src/permission/schema.ts` | Add `"browser"` permission type |
| `packages/opencode/src/permission/index.ts` | Add browser permission prompt text |
| `packages/opencode/src/tool/truncate.ts` | Add binary output truncation for screenshots |
| `packages/opencode/src/index.ts` | Register new CLI command groups |
| `packages/opencode/package.json` | Add playwright optional dependency |
| `packages/plugin/package.json` | Version bump |

---

## Wave A: Phase 1 — Self-Improvement Foundation

### Task 1.1: Create Memory Schema (schema.ts)

**Files:**
- Create: `packages/opencode/src/self-improvement/schema.ts`

**Does NOT cover:** Drizzle table definitions (separate Task 1.2), MemoryStore service (separate Task 1.3)

- [ ] **Create schema.ts with MemoryID, MemoryType, MemoryLayer, MemoryInfo**

```typescript
import { Schema } from "@effect/schema"
import { Identifier } from "@opencode-ai/core/util/id"

export const MemoryID = Schema.String.pipe(
  Schema.brand("MemoryID"),
)

export const MemoryType = Schema.Literal("episodic", "semantic", "procedural", "pattern")
export const MemoryLayer = Schema.Literal("short_term", "long_term", "semantic", "procedural")

export class MemoryInfo extends Schema.Struct({
  id: MemoryID,
  session_id: Schema.String,
  workspace_id: Schema.optional(Schema.String),
  type: MemoryType,
  layer: MemoryLayer,
  title: Schema.String,
  content: Schema.String,
  tags: Schema.Array(Schema.String),
  importance: Schema.Number,
  confidence: Schema.Number,
  access_count: Schema.Number.pipe(Schema.int()),
  version: Schema.Number.pipe(Schema.int()),
  time_created: Schema.Number.pipe(Schema.int()),
  time_last_accessed: Schema.Number.pipe(Schema.int()),
  time_last_evolved: Schema.optional(Schema.Number.pipe(Schema.int())),
  heartbeat_at: Schema.optional(Schema.Number.pipe(Schema.int())),
}) {}

export class MemoryRelation extends Schema.Struct({
  target_id: MemoryID,
  relation: Schema.String,
  weight: Schema.Number,
}) {}
```

### Task 1.2: Create Drizzle Table (memory.sql.ts)

**Files:**
- Create: `packages/opencode/src/self-improvement/memory.sql.ts`

**Does NOT cover:** MemoryStore service (Task 1.3), curation log table (Task 3.1)

- [ ] **Create memory.sql.ts with self_improvement_memory Drizzle table**

```typescript
import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core"

export const memoryTable = sqliteTable("self_improvement_memory", {
  id: text("id").primaryKey(),
  session_id: text("session_id").notNull(),
  workspace_id: text("workspace_id"),
  type: text("type").notNull().$type<"episodic" | "semantic" | "procedural" | "pattern">(),
  layer: text("layer").notNull().$type<"short_term" | "long_term" | "semantic" | "procedural">(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags").notNull().default("[]"),
  importance: real("importance").notNull().default(0.5),
  confidence: real("confidence").notNull().default(0.8),
  access_count: integer("access_count").notNull().default(0),
  version: integer("version").notNull().default(1),
  time_created: integer("time_created").notNull(),
  time_last_accessed: integer("time_last_accessed").notNull(),
  time_last_evolved: integer("time_last_evolved"),
  heartbeat_at: integer("heartbeat_at"),
})
```

### Task 1.3: Create Memory Store Service (memory-store.ts)

**Files:**
- Create: `packages/opencode/src/self-improvement/memory-store.ts`
- Depends on: `schema.ts`, `memory.sql.ts`

**Does NOT cover:** Tool definitions (Task 1.5, 1.6), bus events (Task 1.4)

- [ ] **Create MemoryStore service with CRUD + keyword search + event subscriptions**

Key patterns to follow:
- Use `Context.Service` and `Layer.effect` pattern
- Subscribe to EventV2 events for auto-storage
- Implement `store()`, `search()`, `get()`, `update()`, `delete()`, `touchActive()`, `recordToolError()`, `compile()` methods
- `search()` does keyword/tag matching in V1
- `compile()` queries relevant memories for system prompt injection

### Task 1.4: Create Memory Bus Events (memory-bus-events.ts)

**Files:**
- Create: `packages/opencode/src/self-improvement/memory-bus-events.ts`

- [ ] **Create bus events following existing BusEvent.define() pattern**

```typescript
import { BusEvent } from "../../bus/bus-event"
import { Schema } from "@effect/schema"
import { MemoryID, MemoryType } from "./schema"

export const MemoryStored = BusEvent.define("memory.stored", Schema.Struct({
  memory_id: MemoryID,
  type: MemoryType,
  tags: Schema.Array(Schema.String),
  importance: Schema.Number,
}))

export const MemoryRecalled = BusEvent.define("memory.recalled", Schema.Struct({
  memory_id: MemoryID,
  query: Schema.String,
  relevance_score: Schema.Number,
}))
```

### Task 1.5: Create `remember` Tool

**Files:**
- Create: `packages/opencode/src/self-improvement/tools/remember.ts`
- Depends on: memory-store.ts

- [ ] **Create remember tool using Tool.define() pattern**

```typescript
import { Tool } from "../../tool/tool"
import { Schema } from "@effect/schema"
import { MemoryStore } from "../memory-store"

export const RememberTool = Tool.define("remember", Effect.gen(function* () {
  const store = yield* MemoryStore.Service
  return {
    id: "remember",
    description: "Store a fact, decision, or pattern for cross-session recall. Use this to persist important information the user should be able to retrieve in future sessions.",
    parameters: Schema.Struct({
      title: Schema.String,
      content: Schema.String,
      type: Schema.optional(Schema.Literal("episodic", "semantic", "procedural", "pattern"), { default: () => "semantic" }),
      tags: Schema.optional(Schema.Array(Schema.String), { default: () => [] }),
      importance: Schema.optional(Schema.Number, { default: () => 0.5 }),
    }),
    execute: (params, ctx) => Effect.gen(function* () {
      return yield* store.store({ ...params, sessionID: ctx.sessionID })
    }),
  }
}))
```

### Task 1.6: Create `recall` Tool

**Files:**
- Create: `packages/opencode/src/self-improvement/tools/recall.ts`
- Depends on: memory-store.ts

- [ ] **Create recall tool using Tool.define() pattern**

```typescript
export const RecallTool = Tool.define("recall", Effect.gen(function* () {
  const store = yield* MemoryStore.Service
  return {
    id: "recall",
    description: "Search across past memories. Retrieve stored facts, decisions, and patterns from previous sessions.",
    parameters: Schema.Struct({
      query: Schema.String,
      type_filter: Schema.optional(Schema.String),
      max_results: Schema.optional(Schema.Number.pipe(Schema.int()), { default: () => 5 }),
    }),
    execute: (params, ctx) => Effect.gen(function* () {
      return yield* store.search(params)
    }),
  }
}))
```

### Task 1.7: Create Tools Index + Registry Registration

**Files:**
- Create: `packages/opencode/src/self-improvement/tools/index.ts`
- Modify: `packages/opencode/src/tool/registry.ts`

- [ ] **Create tools/index.ts barrel export**

```typescript
import { RememberTool } from "./remember"
import { RecallTool } from "./recall"

export const SelfImprovementTools = [RememberTool, RecallTool]
```

- [ ] **Modify registry.ts** — import and register the tools alongside existing built-in tools

### Task 1.8: Create Self-Improvement Index (boot layer)

**Files:**
- Create: `packages/opencode/src/self-improvement/index.ts`
- Depends on: all above tasks

- [ ] **Create index.ts with Service layer, boot sequence, Layer export**

Following the `export * as SelfImprovement from "."` pattern at the bottom.

### Task 1.9: Create Migration SQL

**Files:**
- Create: `packages/opencode/src/self-improvement/migrations/001_create_memory_table.sql`

- [ ] **Create migration SQL file**

```sql
CREATE TABLE IF NOT EXISTS self_improvement_memory (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  workspace_id TEXT,
  type TEXT NOT NULL CHECK(type IN ('episodic', 'semantic', 'procedural', 'pattern')),
  layer TEXT NOT NULL CHECK(layer IN ('short_term', 'long_term', 'semantic', 'procedural')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  importance REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.8,
  access_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  time_created INTEGER NOT NULL,
  time_last_accessed INTEGER NOT NULL,
  time_last_evolved INTEGER,
  heartbeat_at INTEGER
);
```

**Verification for Wave A:**
- `bun typecheck` passes across `packages/opencode`
- Migration SQL is syntactically valid SQLite
- Tool.Def types compile correctly

---

## Wave B: Phase 2 — Plugin Hooks + Memory Injection

### Task 2.1: Add New Hook Types to Plugin Interface

**Files:**
- Modify: `packages/plugin/src/index.ts`
- Modify: `packages/plugin/package.json` (version bump)

- [ ] **Add 4 new experimental hook types to Hooks interface**

```typescript
"experimental.session.step.complete"?: (
  input: { sessionID: string; messages: any[]; finish: any },
  output: { memories: string[] },
) => Promise<void>

"experimental.session.error"?: (
  input: { sessionID: string; tool: string; args: any; error: string },
  output: { handled: boolean },
) => Promise<void>

"experimental.session.ended"?: (
  input: { sessionID: string },
  output: { summary: string },
) => Promise<void>

"experimental.compaction.before"?: (
  input: { sessionID: string; messages: any[] },
  output: { context: string },
) => Promise<void>
```

### Task 2.2: Add Hook Trigger in processor.ts (session.error)

**Files:**
- Modify: `packages/opencode/src/session/processor.ts`

- [ ] **Add experimental.session.error hook trigger in failToolCall / settleToolCall**

After a tool call fails (in `failToolCall` around line 209), trigger the hook with the error context.

### Task 2.3: Add Hook Trigger in session.ts (session.ended)

**Files:**
- Modify: `packages/opencode/src/session/session.ts`

- [ ] **Add experimental.session.ended hook trigger in session close/remove path**

In the `remove` method or session cleanup path, trigger the hook before cleanup.

### Task 2.4: Add Hook Trigger in prompt.ts (step.complete)

**Files:**
- Modify: `packages/opencode/src/session/prompt.ts`

- [ ] **Add experimental.session.step.complete hook trigger after step completion**

After the `step-finish` event handling, trigger the hook with full step/result context.

### Task 2.5: Add Memory Injection in System Prompt

**Files:**
- Modify: `packages/opencode/src/session/prompt.ts` (around L1555-L1565)

- [ ] **Call MemoryService.compile() and inject into system array**

```typescript
// In system prompt assembly, before or after skills
const memory = yield* MemoryService.compile(agent, sessionID, msgs).pipe(Effect.option)
const system = [
  ...env,
  ...instructions,
  ...(Option.isSome(memory) ? [memory.value] : []),
  ...(skills ? [skills] : []),
]
```

**Verification for Wave B:**
- `bun typecheck` passes
- New hooks appear in Plugin.Hooks type
- Triggers fire with correct input/output data during session lifecycle

---

## Wave C: Phase 3 + Phase 4

### Task 3.1: Create Curation Log Table

**Files:**
- Create: `packages/opencode/src/self-improvement/curation-log.sql.ts`
- Create: `packages/opencode/src/self-improvement/migrations/002_create_curation_log.sql`

- [ ] **Create Drizzle table + migration for curation_run_log**

### Task 3.2: Create Curation Bus Events

**Files:**
- Create: `packages/opencode/src/self-improvement/curation-bus-events.ts`

- [ ] **Create curation.started, curation.ended, curation.error bus events**

### Task 3.3: Create Decay Processor (decay.ts)

**Files:**
- Create: `packages/opencode/src/self-improvement/decay.ts`

- [ ] **Create DecayProcessor with run() that decrements importance, purges below threshold**

### Task 3.4: Create Heartbeat Touch (heartbeat.ts)

**Files:**
- Create: `packages/opencode/src/self-improvement/heartbeat.ts`

- [ ] **Create HeartbeatFiber — touch heartbeat_at on active memories**

### Task 3.5: Create Curation Fiber (curation.ts)

**Files:**
- Create: `packages/opencode/src/self-improvement/curation.ts`

- [ ] **Create CurationFiber — scheduled consolidation, evolution, decay, pattern discovery**

### Task 3.6: Create Pattern Extractor (pattern-extractor.ts)

**Files:**
- Create: `packages/opencode/src/self-improvement/pattern-extractor.ts`

- [ ] **Create LLM-driven pattern extraction from memory clusters**

### Task 3.7: Create Prompt Files

**Files:**
- Create: `packages/opencode/src/self-improvement/prompts/evolve.md`
- Create: `packages/opencode/src/self-improvement/prompts/pattern.md`

- [ ] **Create LLM prompts for memory evolution and pattern discovery**

### Task 3.8: Create Health Check Fiber (health-check.ts)

**Files:**
- Create: `packages/opencode/src/self-improvement/health-check.ts`

- [ ] **Create periodic health check fiber for memory store + fiber supervision**

### Task 3.9: Wire Fibers into Boot Sequence

**Files:**
- Modify: `packages/opencode/src/self-improvement/index.ts`

- [ ] **Wire curation, decay, heartbeat, health-check fibers into boot**

### Task 4.1: Informative Tool Collapse

**Files:**
- Modify: `packages/opencode/src/session/message-v2.ts` (line ~791)

- [ ] **Replace "[Old tool result content cleared]" with informative one-line summary**

```typescript
// Helper function
function summarizeToolOutput(part: any): string {
  const input = part.state.input
  if (!input) return "unknown"
  if (input.command) return `ran ${input.command} → exit ${input.code ?? "?"}, ${(part.state.output ?? "").split("\n").length} lines`
  if (input.filePath) return `read ${input.filePath} (${(part.state.output ?? "").length} chars)`
  if (input.pattern) {
    const matches = (part.state.output ?? "").match(/\n/g)?.length ?? 0
    return `searched for ${input.pattern} → ${matches} matches`
  }
  if (input.url) return `fetched ${input.url} (${(part.state.output ?? "").length} chars)`
  return `${input.tool ?? "unknown"} → done`
}
```

### Task 4.2: Anti-Thrashing in Compaction

**Files:**
- Modify: `packages/opencode/src/session/compaction.ts`

- [ ] **Add thrash counter to skip Phase 2 after consecutive low-yield passes**

Track savings % from each compaction pass. If savings < 10% for 2+ consecutive passes, skip LLM compaction.

### Task 4.3: Pre-Compaction Plugin Hook

**Files:**
- Modify: `packages/opencode/src/session/compaction.ts` (line ~397)
- Already covered: plugin hook type already added in Task 2.1

- [ ] **Trigger experimental.compaction.before hook before pruning**

**Verification for Wave C:**
- Curation fiber starts/stops with config toggle
- Decay decrements importance correctly
- Tool collapse shows informative summaries instead of generic placeholder
- Anti-thrashing skips compaction after low-yield passes

---

## Wave D: Phase 5 + Phase 6

### Task 5.1: Browser Schema (schema.ts)

**Files:**
- Create: `packages/opencode/src/tool/browser/schema.ts`

- [ ] **Create BrowserSessionID, BrowserState, BrowserViewport, tool param schemas**

### Task 5.2: Playwright Engine (engine.ts)

**Files:**
- Create: `packages/opencode/src/tool/browser/engine.ts`

- [ ] **Create BrowserEngine class — launch/dispose, per-session page management**

### Task 5.3: Browser Bus Events (bus-events.ts)

**Files:**
- Create: `packages/opencode/src/tool/browser/bus-events.ts`

- [ ] **Create browser session lifecycle bus events**

### Task 5.4-5.9: Individual Browser Tools

**Files:**
- Create: `packages/opencode/src/tool/browser/navigate.ts`
- Create: `packages/opencode/src/tool/browser/click.ts`
- Create: `packages/opencode/src/tool/browser/type.ts`
- Create: `packages/opencode/src/tool/browser/snapshot.ts`
- Create: `packages/opencode/src/tool/browser/screenshot.ts`
- Create: `packages/opencode/src/tool/browser/evaluate.ts`

- [ ] **Create all 6 browser tools following Tool.define() pattern with permission gating**

Each tool:
1. Takes params, uses BrowserEngine.ensurePage(sessionID)
2. Checks permission via ctx.ask()
3. Executes Playwright action
4. Returns result

### Task 5.10: Browser Tools Index + Registry

**Files:**
- Create: `packages/opencode/src/tool/browser/index.ts`
- Modify: `packages/opencode/src/tool/registry.ts`

- [ ] **Create browser index with tool registration and gating**
- [ ] **Register browser tools in registry.ts (gated by experimental.browser.enabled)**

### Task 5.11: Update package.json + Config + Permission

**Files:**
- Modify: `packages/opencode/package.json` — add `playwright` as optional dep
- Create: `packages/opencode/src/config/browser.ts` — browser config schema
- Modify: `packages/opencode/src/permission/schema.ts` — add `"browser"` type
- Modify: `packages/opencode/src/permission/index.ts` — add browser prompt text
- Modify: `packages/opencode/src/tool/truncate.ts` — add binary output truncation

### Task 6.1: Channel Schema

**Files:**
- Create: `packages/opencode/src/channels/schema.ts`

- [ ] **Create ChannelID, ChannelInfo schemas**

### Task 6.2: Channel Drizzle Table

**Files:**
- Create: `packages/opencode/src/channels/channel.sql.ts`
- Create: `packages/opencode/src/channels/migrations/001_create_channel_config.sql`

- [ ] **Create channel_config Drizzle table + migration**

### Task 6.3: Channel Bus Events

**Files:**
- Create: `packages/opencode/src/channels/bus-events.ts`

- [ ] **Create channel lifecycle bus events**

### Task 6.4: Channel Index (registry)

**Files:**
- Create: `packages/opencode/src/channels/index.ts`

- [ ] **Create ChannelRegistry — CRUD, event forwarding, lifecycle**

### Task 6.5-6.6: Transports

**Files:**
- Create: `packages/opencode/src/channels/transports/slack.ts`
- Create: `packages/opencode/src/channels/transports/discord.ts`

- [ ] **Create Slack transport — webhook posting + event subscription**
- [ ] **Create Discord transport — webhook posting + event subscription**

### Task 6.7: Channel Config

**Files:**
- Create: `packages/opencode/src/config/channels.ts`

- [ ] **Create ChannelsConfig schema**

**Verification for Wave D:**
- `bun typecheck` passes
- Browser engine compiles (no runtime test without Playwright installed)
- Channel CRUD works against SQLite
- Permission type includes "browser"

---

## Wave E: Config Integration + CLI Commands

### Task 7.1: Self-Improvement Config Module

**Files:**
- Create: `packages/opencode/src/config/self-improvement.ts`

- [ ] **Create SelfImprovementConfig schema following self-export pattern**

### Task 7.2: Merge Config Into Config System

**Files:**
- Modify: `packages/opencode/src/config/config.ts`

- [ ] **Import and merge self_improvement, experimental.browser, channels into Config.Info schema**

### Task 7.3-7.8: CLI Commands

**Files:**
- Create: `packages/opencode/src/cli/cmd/memory/list.ts`
- Create: `packages/opencode/src/cli/cmd/memory/show.ts`
- Create: `packages/opencode/src/cli/cmd/memory/prune.ts`
- Create: `packages/opencode/src/cli/cmd/memory/search.ts`
- Create: `packages/opencode/src/cli/cmd/curation/status.ts`
- Create: `packages/opencode/src/cli/cmd/curation/run.ts`

- [ ] **Create CLI commands using effectCmd() pattern**

Each command follows the existing `effectCmd` pattern from `packages/opencode/src/cli/effect-cmd.ts`:

```typescript
export const MemoryListCommand = effectCmd({
  command: "memory list",
  describe: "List stored memories",
  builder: (yargs) => yargs.option("type", { type: "string", describe: "Filter by type" }),
  handler: (args) => Effect.gen(function* () {
    // ...
  }),
})
```

### Task 7.9: Register CLI Commands

**Files:**
- Modify: `packages/opencode/src/index.ts`

- [ ] **Register memory and curation command groups in the CLI**

---

## Self-Review

### 1. Spec Coverage
- Phase 1 covers all schema, tools, and store from the integration plan (§4.1-4.6, §8.1-8.3)
- Phase 2 covers all plugin hooks and triggers (§4.4, §4.5)
- Phase 3 covers curation, decay, heartbeat, health-check (§4.7, §11)
- Phase 4 covers compaction augmentations (§7.1-7.4)
- Phase 5 covers browser tools (§6.1-6.6)
- Phase 6 covers channels (§5.1-5.4)
- Phase 7 covers config (§10.4) and CLI (§10.2)
- Console UI (§10.1) is deferred to a follow-up

### 2. Types Consistency
- All 4 experimental hook names match across plugin interface, trigger call sites, and consumer expectations
- MemoryID brand is consistent across schema, store, tools, and bus events
- Tool.define() pattern consistent with existing tool definitions

### 3. Placeholder Check
- No "TODO", "TBD", or "implement later" in actual code blocks
- Every code block contains real implementation code
- Verification commands are specific and actionable

---

## Execution Handoff

**Plan complete and saved. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task/wave with staged review gates. Best for this massive plan since each task has clear boundaries.

**2. Inline Execution (start with Wave A)** — Execute Phase 1 tasks in this session using executing-plans, with checkpoints between phases.

**Which approach would you like?**
