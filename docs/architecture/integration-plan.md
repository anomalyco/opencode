# Integration Plan: OpenCode V2 + Self-Improvement + Channels + Browser

> **Status:** Draft — based on deep implementation study (see `session-log.md`)
> **Date:** 2026-05-31
> **Scope:** Add Hermes Agent self-improvement patterns and openClaw channel/browser integrations into OpenCode's existing V2 architecture. **No preemptive denials** — each architectural decision is backed by implementation analysis.

---

## Table of Contents

1. [Deep-Study Findings Summary](#1-deep-study-findings-summary)
2. [Architecture Principles](#2-architecture-principles)
3. [Target Architecture](#3-target-architecture)
4. [Self-Improvement Subsystem](#4-self-improvement-subsystem)
5. [Channels Subsystem](#5-channels-subsystem)
6. [Browser Automation](#6-browser-automation)
7. [Compaction Augmentations](#7-compaction-augmentations)
8. [Identity & Schema Files](#8-identity--schema-files)
9. [Subagent Assignments Per Phase](#9-subagent-assignments-per-phase)
10. [Indirect Effects & UI Impact](#10-indirect-effects--ui-impact)
11. [Cron / Heartbeat / Maintenance](#11-cron--heartbeat--maintenance)
12. [Complete File Manifest](#12-complete-file-manifest)
13. [Architecture Decision Records](#13-architecture-decision-records)
14. [Implementation Phases](#14-implementation-phases)
15. [Module Placement](#15-module-placement)
16. [Dependency Graph](#16-dependency-graph)

---

## 1. Deep-Study Findings Summary

Before any plan was written,  parallel subagents analyzed the actual codebase:

### 1.1 Plugin Systems — Two Systems Found

| System | Location | Use Case |
|--------|----------|----------|
| **PluginV2** | `packages/core/src/plugin.ts` | 7 typed Effect hooks for model/provider/agent plumbing (`catalog.transform`, `account.switched`, `aisdk.*`, `agent.*`) |
| **@opencode-ai/plugin** | `packages/plugin/src/index.ts` | 18 async hooks, 6 already `experimental.*`. Has `event`, `tool`, `chat.*`, `experimental.session.compacting`, `experimental.chat.system.transform`, etc. |

**Key insight:** There are already two parallel plugin systems. Adding a third for self-improvement is bad. Using `@opencode-ai/plugin` follows established conventions and the `experimental.*` naming pattern.

### 1.2 EventV2 System — 27 Session Events Already Defined

All in `packages/core/src/session-event.ts`. Includes `Step.Ended`, `Step.Failed`, `Tool.Failed`, `Tool.Success`, `Retried`, `Compaction.Ended`, etc. No new event types needed for observation.

**Can subscribe with zero core changes** via `EventV2.Service.subscribe()`.

### 1.3 Compaction vs Hermes — Architecturally Convergent

Both systems converged on the same two-phase (prune → compact), structured-template, iterative-summary approach. **No case for replacement.** Augmentation is appropriate.

### 1.4 Channels/Browser — Nothing Exists

- Zero channel infrastructure (just a `disableChannelDb` flag remnant)
- Zero browser automation dependencies (no Playwright, Puppeteer, Chromium)
- **WorkspaceAdapter** exists for workspace isolation (git worktree adapter is built-in)
- **MCP** (`packages/opencode/src/mcp/`) exists for external tool/runtime integration

### 1.5 Key Line Numbers Discovered

| What | File | Lines |
|------|------|-------|
| System prompt assembly | `session/prompt.ts` | ~L1555-L1565 |
| Plugin hook injection (system transform) | `llm/request.ts` | L67-L71 |
| Plugin hook injection (message transform) | `session/prompt.ts` | L1433 |
| Tool registration | `tool/registry.ts` | Full file |
| Tool.Def type | `tool/tool.ts` | L34-L80 |
| Compaction process | `session/compaction.ts` | L344-L582 |
| Tool collapse placeholder | `message-v2.ts` | L791 |
| Event subscription pattern | `core/event.ts` | L74-L84 |
| Cross-session access (MessageV2.page) | `session/message-v2.ts` | L923-L962 |

---

## 2. Architecture Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| P1 | **Study first, decide second** | No preemptive denials. Every architectural decision is based on actual code analysis |
| P2 | **Add hooks to @opencode-ai/plugin where needed** | The `experimental.*` convention is established for unstable additions |
| P3 | **Add alongside existing systems** | No replacement unless analysis shows clear superiority (which it doesn't for compaction) |
| P4 | **Self-improvement needs both observation AND intervention** | Observation via EventV2 subscription; intervention via plugin hooks and tool registration |
| P5 | **Channels and browser as built-in tools + MCP servers** | Tools for agent-side control, MCP for external integration, WorkspaceAdapter for isolation |
| P6 | **Effect-first composition** | Consistent with existing code style |

---

## 3. Target Architecture

```
packages/core — minimal additive changes:
  No new Service types
  NO changes to PluginV2 (core hooks stay focused on plumbing)
  NO changes to EventV2 registry (events can be subscribed to externally)
  But: 3 new experimental hooks in @opencode-ai/plugin Hooks interface
       (this is packages/plugin, not packages/core)

packages/plugin — new experimental hooks:
  experimental.session.step.complete
  experimental.session.error
  experimental.session.ended

packages/opencode — new modules:

  ┌──────────────────────────────────────────────────────────────┐
  │                    packages/opencode                         │
  │                                                              │
  │  ┌──────────────────┐  ┌─────────────────────────────────┐   │
  │  │  Self-Improvement │  │  Channels & Browser             │   │
  │  │                   │  │  (new directory tree)           │   │
  │  │  ├─ memory/       │  │                                 │   │
  │  │  │  ├─ schema.ts  │  │  ├─ channels/                   │   │
  │  │  │  ├─ store.ts   │  │  │  ├─ index.ts                 │   │
  │  │  │  └─ sql.ts     │  │  │  ├─ slack.ts                 │   │
  │  │  ├─ curation.ts   │  │  │  └─ discord.ts               │   │
  │  │  ├─ tools/        │  │  ├─ browser/                    │   │
  │  │  │  ├─ remember   │  │  │  ├─ index.ts                 │   │
  │  │  │  └─ recall     │  │  │  ├─ playwright.ts            │   │
  │  │  └─ index.ts      │  │  │  └─ schema.ts                │   │
  │  └──────────────────┘  │  └─ mcp-bridge/                  │   │
  │                        │     ├─ index.ts                   │   │
  │  Compaction (as-is)    │     └─ transports/                │   │
  │  ├─ compaction.ts      │                                  │   │
  │  ├─ + tool collapse    │  Plugin system                    │   │
  │  └─ + anti-thrashing   │  ├─ @opencode-ai/plugin           │   │
  │                        │  │  + 3 new hooks                 │   │
  │  Bus (as-is)           │  └─ runtime trigger callsites     │   │
  │  ├─ bus/index.ts       │                                  │   │
  │  └─ + session events   │  Tool Registry                    │   │
  │                        │  ├─ remember (new)                │   │
  │  EventV2 Bridge (as-is)│  ├─ recall (new)                  │   │
  │  ├─ event-v2-bridge    │  ├─ browser_* (new, gated)        │   │
  │  └─ subscribe to events│  └─ existing (as-is)              │   │
  │                        └──────────────────────────────────┘   │
  └──────────────────────────────────────────────────────────────┘
```

---

## 4. Self-Improvement Subsystem

### 4.1 Design Philosophy

Derived from Hermes Agent's three orthogonal pillars, adapted for OpenCode:

| Hermes Pillar | OpenCode Equivalent | Implementation |
|---------------|-------------------|----------------|
| **Memory** (persistent facts + patterns) | New `MemoryService` | SQLite store + `remember`/`recall` tools |
| **Self-Evolution** (curation, consolidation) | New `CurationFiber` | Background Effect fiber with configurable interval |
| **Context Budget** (compaction, summarization) | Existing `Compaction.Service` | Augmented with 4 improvements (see §7) |

### 4.2 Directory Structure

```
packages/opencode/src/self-improvement/
├── index.ts              # Plugin registration, layer exports, boot integration
├── schema.ts             # MemoryID, MemoryType, MemoryLayer branded types
├── memory.sql.ts         # Drizzle table (self_improvement_memory)
├── memory-store.ts       # SQLite CRUD + semantic search (FTS5 in V2)
├── curation.ts           # Background fiber: consolidation, evolution, decay
├── pattern-extractor.ts  # LLM-driven pattern extraction from memory clusters
├── tools/
│   ├── index.ts          # Registration export
│   ├── remember.ts       # `remember` tool definition
│   └── recall.ts         # `recall` tool definition
├── prompts/
│   ├── evolve.md         # LLM prompt for memory evolution
│   └── pattern.md        # LLM prompt for pattern extraction
└── test/
```

### 4.3 EventV2 Subscriptions (Zero Core Changes)

The memory service subscribes to existing EventV2 events via `EventV2.Service.subscribe()`:

```typescript
// In self-improvement boot/startup
const events = yield* EventV2.Service

// Track successful step completions → extract procedure patterns
yield* events.subscribe(SessionEvent.Step.Ended).pipe(
  Stream.runForEach(event => MemoryStore.recordStep(event.data))
)

// Track failures → build error signature database
yield* events.subscribe(SessionEvent.Tool.Failed).pipe(
  Stream.runForEach(event => MemoryStore.recordToolError(event.data))
)

// Track compactions → log context pressure patterns
yield* events.subscribe(SessionEvent.Compaction.Ended).pipe(
  Stream.runForEach(event => MemoryStore.recordCompaction(event.data))
)
```

**No new EventV2 event types needed.** 27 existing events cover observation.

### 4.4 New Hooks in @opencode-ai/plugin (packages/plugin)

Three new `experimental.*` hooks in `packages/plugin/src/index.ts`:

| Hook | Purpose | When Fired |
|------|---------|------------|
| `experimental.session.step.complete` | Full step with all tool results + response text | After `Step.Ended` + all tool results settled |
| `experimental.session.error` | Rich error with context (tool name, args, stack) | After `Tool.Failed` or `Step.Failed` |
| `experimental.session.ended` | Session termination with summary | After session is closed |

**Trigger call sites** added in `packages/opencode` (the session loop and processor):

```typescript
// In session/prompt.ts, after Step.Ended event processed
yield* plugin.trigger(
  "experimental.session.step.complete",
  { sessionID, messages, finish },
  { memories: string[] }  // plugin can inject memories for this step
)

// In session/processor.ts, after settleToolCall error path
yield* plugin.trigger(
  "experimental.session.error",
  { sessionID, tool, args, error },
  { handled: false }
)

// In session/session.ts, on session close
yield* plugin.trigger(
  "experimental.session.ended",
  { sessionID },
  { summary: "" }
)
```

### 4.5 Memory Injection Into Session

Two injection points (both discovered in code study):

**Primary: Plugin hook `experimental.chat.system.transform`** (no code change needed)

File: `packages/opencode/src/session/llm/request.ts` lines 67–71. A plugin implementing this hook can push memory strings into the `system` array. The hook already receives `sessionID` and `model`.

```typescript
// In a self-improvement plugin:
"experimental.chat.system.transform": async (input, output) => {
  const memories = await MemoryStore.search(input.model.prompt)
  if (memories.length > 0) {
    output.system.push(formatMemories(memories))
  }
}
```

**Secondary: Add memory step in system prompt assembly** (additive code change)

File: `packages/opencode/src/session/prompt.ts` lines ~1555–1565.

```typescript
// Current:
const system = [...env, ...instructions, ...(skills ? [skills] : [])]

// After:
const memory = yield* MemoryService.compile(agent, sessionID, msgs)
const system = [
  ...env,
  ...instructions,
  ...(memory ? [memory] : []),
  ...(skills ? [skills] : []),
]
```

The `MemoryService.compile()` function would:

1. Query memory store for relevant patterns (by agent + recent context)
2. Format as a structured system message section
3. Return `null` if no relevant memories (zero overhead)

### 4.6 Tools

Two new built-in tools registered in `tool/registry.ts`:

**`remember`** — Store a fact/decision/pattern for cross-session recall

- Parameters: `title` (string), `content` (string), `type` (episodic|semantic|procedural|pattern), `tags` (string[]), `importance` (number, 0-1)
- Returns: memory ID
- Side effect: writes to `self_improvement_memory` table
- Follows same `Tool.Def` pattern as existing tools (`tool/tool.ts` lines 34-80)

**`recall`** — Semantic search across past memories

- V1: Keyword/tag matching (zero dependencies)
- V2: FTS5 full-text search on SQLite (built-in, no extra dependency)
- V3: LLM-based ranking
- Parameters: `query` (string), `type_filter` (optional), `max_results` (number, default 5)
- Returns: ranked memory summaries with confidence scores

### 4.7 Curation Loop

Background Effect fiber with configurable interval:

```typescript
// packages/opencode/src/self-improvement/curation.ts
export const CurationFiber = Layer.effect(
  Tag<Fiber.FiberId>(),
  Effect.gen(function*() {
    const config = yield* SelfImprovementConfig
    if (!config.enabled) return FiberId.none

    const fiber = yield* Effect.fork(
      Effect.forever(
        pipe(
          runCurationCycle,
          Effect.delay(config.curationInterval),
        )
      )
    )
    return fiber.id
  })
)
```

Cycle steps (derived from Hermes two-layer curator):

1. **Consolidate** — Find similar memories (tag overlap, content similarity), merge duplicates
2. **Evolve** — Promote frequently-accessed short-term → long-term; demote stale long-term
3. **Discover patterns** — Cluster memories by shared tags; when confidence threshold met, emit `pattern` memory
4. **Decay** — Decrement importance of unaccessed memories; purge below threshold after N cycles

### 4.8 Config Shape

```jsonc
{
  "self_improvement": {
    "enabled": false,           // opt-in
    "curation_interval_ms": 3600000,  // 1 hour
    "max_memories_per_session": 5,
    "enable_auto_store": true,  // auto-store episodic memories
    "recall": {
      "max_results": 5,
      "min_confidence": 0.3
    }
  }
}
```

---

## 5. Channels Subsystem

### 5.1 Design

Channels (Slack, Microsoft Teams, Discord, Telegram, WhatsApp, Gmail, Outlook, Google Calendar, Microsoft Outlook, etc.) provide alternative interfaces to the same session runtime. Unlike browser tools (which are agent-side), channels are external surfaces.

**Architecture:** Each channel is a `@opencode-ai/plugin` that uses the `event` hook for observation and injects messages via the SDK or MCP.

```
External Channel (Slack/Teams/Discord/Telegram/WhatsApp/Gmail/Outlook/Calendar/etc.)
        │
        ▼
Channel Plugin ─── event hook (receive bus events) ───→ Relayed to external
        │
        ▼
   SDK Client ─── tool/API calls ───→ OpenCode session
        │
        ▼
   MCP Transport ─── bidirectional ───→ MCP Server in opencode
```

### 5.2 Directory Structure

```
packages/opencode/src/channels/
├── index.ts              # Channel adapter registry
├── channel.sql.ts        # Drizzle table for channel config
└── transports/
    ├── slack.ts          # Slack adapter
    ├── slack.md          # Plugin scaffold template for Slack
    ├── teams.ts          # Microsoft Teams adapter
    ├── teams.md          # Plugin scaffold template for Microsoft Teams
    ├── discord.ts        # Discord adapter
    ├── discord.md        # Plugin scaffold template for Discord
    ├── telegram.ts       # Telegram adapter
    ├── telegram.md       # Plugin scaffold template for Telegram
    ├── whatsapp.ts       # WhatsApp adapter
    ├── whatsapp.md       # Plugin scaffold template for WhatsApp
    ├── gmail.ts          # Gmail adapter
    ├── gmail.md          # Plugin scaffold template for Gmail
    ├── outlook.ts        # Outlook adapter
    ├── outlook.md        # Plugin scaffold template for Outlook
    ├── calendar.ts       # Google Calendar adapter
    ├── calendar.md       # Plugin scaffold template for Google Calendar
    └── outlook365.ts     # Microsoft Outlook adapter
        └── outlook365.md # Plugin scaffold template for Microsoft Outlook
```

### 5.3 Channel Plugin Template

Each channel is a standard `@opencode-ai/plugin` that:

```typescript
import type { Plugin } from "@opencode-ai/plugin"

const channelPlugin: Plugin = (input) => {
  const client = input.client  // OpenCode SDK client

  return {
    // Receive all bus events → forward to channel
    event: async ({ event }) => {
      if (event.type === "session.diff") {
        await slack.postMessage(formatDiff(event))
      }
    },

    // Register channel-specific tools
    tool: {
      "channel.post": {
        description: "Post a message to the external channel",
        parameters: { type: "object", properties: { message: { type: "string" } } },
        execute: async ({ message }) => {
          await slack.postMessage(message)
          return { success: true }
        }
      }
    }
  }
}
```

### 5.4 Existing Infrastructure Used

| Need | Existing System |
|------|-----------------|
| Forward events to external | `event` hook (already receives ALL bus events) |
| Receive messages from external | `client.sendMessage()` via SDK |
| Register channel tools | `tool` hook (already in Hooks type) |
| Auth for external services | `auth` hook (already in Hooks type) |

**No new hooks needed for channels.** The existing `event`, `tool`, and `auth` hook types are sufficient.

---

## 6. Browser Automation

### 6.1 Design

Two parallel paths:

| Path | Use Case | Implementation |
|------|----------|----------------|
| **Built-in tools** | Agent navigates web, fills forms, takes screenshots | Playwright as optional dep, **7 high-level tools** in ToolRegistry (replacing dozens of individual operations) |
| **Workspace adapter** | Browser-based sandbox for agent execution (openClaw's browser agent) | New `browser` adapter registered via `experimental_workspace` |

### 6.2 Directory Structure

```
packages/opencode/src/tool/browser/
├── index.ts           # Tool registration + Playwright engine lifecycle
├── engine.ts          # Playwright lifecycle (launch/browser/context management per-session)
├── schema.ts          # Tool input/output schemas + config types
├── navigate.ts        # browser_navigate (was: browser_navigate)
├── click.ts           # browser_click (was: browser_click)
├── type.ts            # browser_type (was: browser_type)
├── snapshot.ts        # browser_snapshot (was: browser_snapshot)
├── screenshot.ts      # browser_screenshot (was: browser_screenshot)
├── evaluate.ts        # browser_evaluate (was: browser_evaluate)
└── high-level-tools.ts # NEW: Seven core high-level browser tools
```

### 6.3 Browser Playwright Engine Lifecycle

```typescript
// packages/opencode/src/tool/browser/engine.ts

class BrowserEngine {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private pages: Map<SessionID, Map<string, Page>> = new Map() // sessionID -> (pageID -> Page)

  async ensurePage(sessionID: string, pageID: string = "default"): Promise<Page> {
    if (!this.sessionMap.has(sessionID)) {
      this.sessionMap.set(sessionID, new Map())
    }
    
    const sessionPages = this.sessionMap.get(sessionID)!
    if (sessionPages.has(pageID)) return sessionPages.get(pageID)!

    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: config.headless,
        args: ["--no-sandbox"],
      })
    }
    if (!this.context) {
      this.context = await this.browser.newContext({
        viewport: config.viewport,
      })
    }
    const page = await this.context.newPage()
    sessionPages.set(pageID, page)
    return page
  }

  async dispose(): Promise<void> {
    for (const sessionPages of this.sessionMap.values()) {
      for (const page of sessionPages.values()) {
        await page.close().catch(() => {})
      }
    }
    await this.context?.close().catch(() => {})
    await this.browser?.close().catch(() => {})
  }
}
```

### 6.4 Tool Signatures

```typescript
// browser_navigate
{
  id: "browser_navigate",
  description: "Navigate a browser to a URL",
  parameters: {
    url: Schema.String  // must be http:// or https://
  }
}

// browser_click
{
  id: "browser_click",
  description: "Click an element on the page",
  parameters: {
    element: Schema.String,  // CSS selector or text description
    selector: Schema.String  // Playwright selector
  }
}

// browser_type
{
  id: "browser_type",
  description: "Type text into an input field",
  parameters: {
    selector: Schema.String,
    text: Schema.String,
    submit: Schema.optional(Schema.Boolean)
  }
}

// browser_snapshot
{
  id: "browser_snapshot",
  description: "Get the accessibility tree of the current page",
  parameters: {}
}

// browser_screenshot
{
  id: "browser_screenshot",
  description: "Take a screenshot of the current page",
  parameters: {
    fullPage: Schema.optional(Schema.Boolean)
  }
}

// browser_evaluate
{
  id: "browser_evaluate",
  description: "Run JavaScript in the browser page",
  parameters: {
    code: Schema.String
  }
}
```

### 6.5 Permission System Integration

Browser tools follow the existing `toolPermissionCheck` pattern. Each tool action triggers a permission prompt:

```typescript
execute: Effect.gen(function*(params, ctx) {
  const allowed = yield* ctx.ask({
    action: `Navigate browser to ${params.url}`,
    type: "browser",
  })
  if (!allowed) return { error: "Permission denied" }
  // ... execute
})
```

### 6.6 Config

```jsonc
{
  "experimental": {
    "browser": {
      "enabled": false,
      "headless": true,
      "viewport": { "width": 1280, "height": 720 },
      "channel": undefined  // optional: "chrome", "msedge", etc.
    }
  }
}
```

### 6.7 WorkspaceAdapter Path

For openClaw's browser-agent sandbox pattern (agent runs INSIDE the browser), register a new `browser` adapter type:

```typescript
// In self-improvement boot or plugin:
WorkspaceAdapter.register("browser", {
  name: "Browser Sandbox",
  description: "Execute agent in a browser-based sandbox",
  configure: (info) => ({ ... }),
  create: async (info, env) => {
    // Launch Playwright, set up browser agent
  },
  target: (info) => ({
    type: "browser",
    url: `http://localhost:${info.port}`,
  })
})
```

This is an **alternative** to the built-in tools approach, not a replacement. The tools path is for "agent uses browser to interact with web pages." The workspace adapter path is for "agent runs in a browser sandbox."

---

## 7. Compaction Augmentations

Research showed OpenCode's compaction is architecturally on-par with Hermes. No replacement. Four small augmentations:

### 7.1 Informative Tool Collapse

**File:** `packages/opencode/src/session/message-v2.ts` line ~791

**Current:**

```typescript
"[Old tool result content cleared]"
```

**After:**

```typescript
`[tool] ${part.state.input?.tool ?? "unknown"} → ${summarizeToolOutput(part.state.output)}`
```

Where `summarizeToolOutput()` produces:

```
`ran ${command} → exit ${code}, ${N} lines`
`read ${path} from line ${start} (${chars} chars)`
`searched for ${pattern} → ${matches} matches`
`wrote ${path} (${chars} chars)`
```

**Effort:** ~30 lines in a helper function. Low risk, high return — model gets actionable signals instead of a meaningless placeholder.

### 7.2 Anti-Thrashing

**File:** `packages/opencode/src/session/compaction.ts`

Add a counter to skip Phase 2 (LLM compaction) after consecutive low-yield passes:

```typescript
// After pruning, before compaction:
if (savings < MINIMUM_SAVINGS_THRESHOLD) {
  thrashCounter++
  if (thrashCounter >= MAX_THRASH_COUNT) {
    return { skipped: true, reason: "anti-thrashing" }
  }
} else {
  thrashCounter = 0
}
```

### 7.3 Pre-Compaction Plugin Hook

**File:** `packages/opencode/src/session/compaction.ts` line ~397 (before pruning)

New hook in `@opencode-ai/plugin`:

```typescript
"experimental.compaction.before": async (input, output) => {
  // Plugin can extract memories before they're pruned
  // Can inject context to be preserved in the summary
}
```

This enables the Hermes "memory flush before compaction" pattern — let the model save important facts before they're compressed away.

### 7.4 Post-Compaction Memory Trigger

After compaction succeeds, emit the existing `session.compacted` bus event (already exists in `compaction.ts`). The self-improvement subsystem subscribes to this to extract durable patterns from the summary.

**Already exists.** No change needed.

---

## 8. Identity & Schema Files

Every new subsystem introduces branded identity types and schema files. These are the "what is this thing" definitions.

### 8.1 Subsystem Identity Map

| Subsystem | Branded ID | Schema File | Table Name | Config Section |
|-----------|-----------|-------------|------------|----------------|
| Self-Improvement | `MemoryID` (`mem_*` prefix) | `self-improvement/schema.ts` | `self_improvement_memory` | `self_improvement` |
| Browser Engine | `BrowserSessionID` (`brs_*` prefix) | `tool/browser/schema.ts` | (in-memory map) | `experimental.browser` |
| Channel | `ChannelID` (`ch_*` prefix) | `channels/channel.sql.ts` | `channel_config` | `channels` |
| Curation Cycle | `CurationRunID` (`cur_*` prefix) | `self-improvement/curation.ts` | `curation_run_log` | (under `self_improvement`) |

### 8.2 Identity File Details

**MemoryID** — `/packages/opencode/src/self-improvement/schema.ts`

```typescript
// Branded type for memory identity — follows existing session ID pattern
export const MemoryID = Schema.String.pipe(
  Schema.brand("MemoryID"),
  withStatics((s) => ({
    make: (id?: string) => s.make(id ?? "mem_" + Identifier.descending()),
    fromString: (id: string) => s.make(id),
  }))
)

export const MemoryType = Schema.Literal("episodic", "semantic", "procedural", "pattern")
export const MemoryLayer = Schema.Literal("short_term", "long_term", "semantic", "procedural")

export class MemoryInfo extends Schema.Struct({
  id: MemoryID,
  session_id: Schema.String,          // foreign key to SessionTable
  workspace_id: Schema.optional(Schema.String),
  type: MemoryType,
  layer: MemoryLayer,
  title: Schema.String,
  content: Schema.String,
  tags: Schema.Array(Schema.String),
  importance: Schema.Number,          // 0.0 - 1.0
  confidence: Schema.Number,          // 0.0 - 1.0
  access_count: Schema.Number.pipe(Schema.int()),
  version: Schema.Number.pipe(Schema.int()),     // incremented on evolution
  time_created: Schema.Number.pipe(Schema.int()),
  time_last_accessed: Schema.Number.pipe(Schema.int()),
  time_last_evolved: Schema.optional(Schema.Number.pipe(Schema.int())),
  heartbeat_at: Schema.optional(Schema.Number.pipe(Schema.int())),  // last curation touch
  relations: Schema.optional(Schema.Array(Schema.Struct({
    target_id: MemoryID,
    relation: Schema.String,          // "caused", "solved_by", "related_to", "extends"
    weight: Schema.Number,
  }))),
}) {}
```

**BrowserSessionID** — `/packages/opencode/src/tool/browser/schema.ts`

```typescript
// Per-session browser identity — tracks which Playwright page belongs to which session
export const BrowserSessionID = Schema.String.pipe(Schema.brand("BrowserSessionID"))

export const BrowserViewport = Schema.Struct({
  width: Schema.Number.pipe(Schema.int()),
  height: Schema.Number.pipe(Schema.int()),
})

export const BrowserState = Schema.Struct({
  session_id: BrowserSessionID,
  opencode_session_id: Schema.String,
  current_url: Schema.String,
  page_title: Schema.String,
  viewport: BrowserViewport,
  pages_count: Schema.Number.pipe(Schema.int()),
  time_created: Schema.Number.pipe(Schema.int()),
  time_last_action: Schema.Number.pipe(Schema.int()),
})
```

**ChannelID** — `/packages/opencode/src/channels/schema.ts`

```typescript
export const ChannelID = Schema.String.pipe(
  Schema.brand("ChannelID"),
  withStatics((s) => ({
    make: (id?: string) => s.make(id ?? "ch_" + Identifier.descending()),
  }))
)

export const ChannelInfo = Schema.Struct({
  id: ChannelID,
  type: Schema.Literal("slack", "discord", "custom"),
  name: Schema.String,
  enabled: Schema.Boolean,
  config: Schema.Record({ key: Schema.String, value: Schema.String }),
  time_created: Schema.Number.pipe(Schema.int()),
  time_last_connected: Schema.optional(Schema.Number.pipe(Schema.int())),
})
```

**CurationRunID** — `/packages/opencode/src/self-improvement/curation.ts`

```typescript
export const CurationRunID = Schema.String.pipe(
  Schema.brand("CurationRunID"),
  withStatics((s) => ({
    make: (id?: string) => s.make(id ?? "cur_" + Identifier.descending()),
  }))
)

export const CurationRunLog = Schema.Struct({
  id: CurationRunID,
  time_started: Schema.Number.pipe(Schema.int()),
  time_ended: Schema.optional(Schema.Number.pipe(Schema.int())),
  memories_consolidated: Schema.Number.pipe(Schema.int()),
  memories_evolved: Schema.Number.pipe(Schema.int()),
  memories_decayed: Schema.Number.pipe(Schema.int()),
  patterns_discovered: Schema.Number.pipe(Schema.int()),
  duration_ms: Schema.Number.pipe(Schema.int()),
  errors: Schema.Array(Schema.String),
})
```

### 8.3 Drizzle Table Definitions

All new tables use the same SQLite Drizzle instance as existing OpenCode tables.

```typescript
// packages/opencode/src/self-improvement/memory.sql.ts
import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core"

export const memoryTable = sqliteTable("self_improvement_memory", {
  id: text("id").primaryKey(),
  session_id: text("session_id").notNull(),
  workspace_id: text("workspace_id"),
  type: text("type").notNull().$type<"episodic" | "semantic" | "procedural" | "pattern">(),
  layer: text("layer").notNull().$type<"short_term" | "long_term" | "semantic" | "procedural">(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags").notNull().default("[]"),             // JSON string[]
  importance: real("importance").notNull().default(0.5),
  confidence: real("confidence").notNull().default(0.8),
  access_count: integer("access_count").notNull().default(0),
  version: integer("version").notNull().default(1),
  time_created: integer("time_created").notNull(),
  time_last_accessed: integer("time_last_accessed").notNull(),
  time_last_evolved: integer("time_last_evolved"),
  heartbeat_at: integer("heartbeat_at"),
  relations: text("relations").notNull().default("[]"),   // JSON array
})

// V2: FTS5 virtual table for full-text search
// "self_improvement_memory_fts" — created via raw SQL migration
```

```typescript
// packages/opencode/src/channels/channel.sql.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const channelTable = sqliteTable("channel_config", {
  id: text("id").primaryKey(),
  type: text("type").notNull().$type<"slack" | "discord" | "custom">(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  config: text("config").notNull().default("{}"),         // JSON: per-channel type config
  time_created: integer("time_created").notNull(),
  time_last_connected: integer("time_last_connected"),
})
```

```typescript
// packages/opencode/src/self-improvement/curation-log.sql.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const curationLogTable = sqliteTable("curation_run_log", {
  id: text("id").primaryKey(),
  time_started: integer("time_started").notNull(),
  time_ended: integer("time_ended"),
  memories_consolidated: integer("memories_consolidated").notNull().default(0),
  memories_evolved: integer("memories_evolved").notNull().default(0),
  memories_decayed: integer("memories_decayed").notNull().default(0),
  patterns_discovered: integer("patterns_discovered").notNull().default(0),
  duration_ms: integer("duration_ms").notNull().default(0),
  errors: text("errors").notNull().default("[]"),
})
```

### 8.4 Migration Files

Pulumi/Drizzle migration for each new table:

```
packages/opencode/src/self-improvement/
  └── migrations/
      └── 001_create_memory_table.sql
      └── 002_create_fts5_index.sql         (V2)
      └── 003_create_curation_log.sql

packages/opencode/src/channels/
  └── migrations/
      └── 001_create_channel_config.sql
```

Each migration file is a standalone SQL script that the Drizzle migration pipeline picks up.

---

## 9. Subagent Assignments Per Phase

Each phase assigns specific agent types to specific files. This ensures parallel execution with clear boundaries.

### Subagent Key

| Agent Type | Best For |
|-----------|----------|
| **Software Architect** | Schema design, ADRs, interface contracts, architecture diagrams |
| **Backend Architect** | Effect services, store implementations, SQL/SQLite patterns, tool definitions |
| **AI Engineer** | LLM prompt design, pattern extraction logic, memory evolution algorithms |
| **Frontend Developer** | Console/UI pages, CLI commands, admin dashboard widgets |
| **DevOps Automator** | Curation fiber, heartbeat scheduling, decay cycles, cron-like loops |
| **Senior QA** | Test files, integration tests, memory store test fixtures |
| **Technical Writer** | Plugin templates, usage docs, contributing guide updates |
| **Database Optimizer** | Drizzle table design, FTS5 migration, query optimization, index design |

### Phase 1: Foundation — Self-Improvement Schema + Tools

**Subagent: Backend Architect** (owner), **Software Architect** (review), **Database Optimizer** (consult)

| File | Agent | Action | Depends On |
|------|-------|--------|------------|
| `self-improvement/schema.ts` | Software Architect → Backend Architect | Create: MemoryID, MemoryType, MemoryLayer, MemoryInfo schemas | — |
| `self-improvement/memory.sql.ts` | Database Optimizer | Create: `self_improvement_memory` Drizzle table | schema.ts identity types |
| `self-improvement/memory.sql.ts` (FTS5) | Database Optimizer | Create: FTS5 virtual table migration | Existing DB schema knowledge |
| `self-improvement/memory-store.ts` | Backend Architect | Create: `MemoryStore.Service` — CRUD + keyword search + subscribe-to-events | memory.sql.ts |
| `self-improvement/tools/remember.ts` | Backend Architect | Create: `remember` tool (Tool.Def, Effect-based execute) | memory-store.ts |
| `self-improvement/tools/recall.ts` | Backend Architect | Create: `recall` tool (keyword match, tag filter, ranking) | memory-store.ts |
| `self-improvement/tools/index.ts` | Backend Architect | Create: barrel export for tool array | remember.ts, recall.ts |
| `self-improvement/index.ts` | Backend Architect | Create: Service layer, boot sequence, Layer export | all of above |
| `tool/registry.ts` | Backend Architect | **Modify:** import + register `remember`/`recall` | tools/index.ts |
| `self-improvement/migrations/001_create_memory_table.sql` | Database Optimizer | Create: Drizzle migration SQL | memory.sql.ts |

**Verification by:** Senior QA

- `bun typecheck` passes across `packages/opencode`
- `remember("my fact", { type: "semantic", tags: ["test"] })` writes to SQLite
- `recall("my fact")` returns the stored memory
- Migration runs cleanly against empty and existing databases

### Phase 2: Event Wiring — Plugin Hooks + Memory Injection

**Subagent: Software Architect** (owner), **Backend Architect** (implement)

| File | Agent | Action | Depends On |
|------|-------|--------|------------|
| `@opencode-ai/plugin/src/index.ts` | Software Architect | **Modify:** Add `experimental.session.step.complete`, `.session.error`, `.session.ended` to Hooks type | Current plugin type definitions |
| `session/prompt.ts` (~L1477-L1490) | Backend Architect | **Modify:** Trigger `experimental.session.step.complete` after step completion | Phase 1 complete |
| `session/prompt.ts` (~L1555-L1565) | Backend Architect | **Modify:** Add memory injection into system array (call `MemoryService.compile()`) | memory-store.ts |
| `session/processor.ts` (~L180-L201) | Backend Architect | **Modify:** Trigger `experimental.session.error` in settleToolCall error path | — |
| `session/session.ts` (~L333-L369) | Backend Architect | **Modify:** Trigger `experimental.session.ended` in session close path | — |

**Indirectly affected:**

- `packages/plugin/package.json` — version bump (new hooks = semver minor)
- Any existing `@opencode-ai/plugin` consumer (needs type compatibility)
- `packages/opencode/src/plugin/index.ts` — dispatch call (already routes all hooks, no change needed)

**Verification by:** Senior QA

- Hook triggers fire with correct input/output data
- Memory appears in `system` array during LLM requests
- No existing plugin behavior changed (backward-compatible hook additions)

### Phase 3: Curation Loop — Memory Maintenance + Heartbeat

**Subagent: DevOps Automator** (owner), **Backend Architect** (Effect integration), **AI Engineer** (prompts)

| File | Agent | Action | Depends On |
|------|-------|--------|------------|
| `self-improvement/curation-log.sql.ts` | Database Optimizer | Create: `curation_run_log` Drizzle table | — |
| `self-improvement/curation.ts` | DevOps Automator | Create: `CurationFiber` — scheduled consolidation, evolution, decay, heartbeat | memory-store.ts, ph2 hooks |
| `self-improvement/curation.ts` (CurationRunLog) | DevOps Automator | Create: Log each curation cycle with metrics | curation-log.sql.ts |
| `self-improvement/heartbeat.ts` | DevOps Automator | Create: Periodic memory heartbeat (touch `heartbeat_at`, mark stale candidates) | memory-store.ts |
| `self-improvement/pattern-extractor.ts` | AI Engineer | Create: LLM-driven pattern extraction from memory clusters | memory-store.ts, model access |
| `self-improvement/decay.ts` | DevOps Automator | Create: `DecayProcessor` — decrement importance of unaccessed memories, purge below threshold | memory-store.ts |
| `self-improvement/prompts/evolve.md` | AI Engineer | Create: LLM prompt for memory evolution (merge, refine, reclassify) | — |
| `self-improvement/prompts/pattern.md` | AI Engineer | Create: LLM prompt for pattern discovery from memory clusters | — |
| `self-improvement/index.ts` | Backend Architect | **Modify:** Wire curation fiber + decay processor into boot sequence | curation.ts, decay.ts |

**Indirectly affected:**

- `self-improvement/memory-store.ts` — may need batch read/write methods for curation to consume
- Memory heartbeat touches `heartbeat_at` column on each memory row
- `curation_run_log` table grows with each cycle (needs log rotation policy)

**Verification by:** DevOps Automator + Senior QA

- Curation fiber starts/stops with config toggle (`self_improvement.enabled`)
- After 2+ runs, similar memories get consolidated
- Unaccessed memories decay below threshold and are purged
- Heartbeat timestamps update on schedule
- Curation run log shows metrics after each cycle

### Phase 4: Compaction Augmentations

**Subagent: Backend Architect** (owner), **Software Architect** (review)

| File | Agent | Action | Depends On |
|------|-------|--------|------------|
| `session/message-v2.ts` (~L791) | Backend Architect | **Modify:** Replace generic tool collapse with informative 1-line summary | Understanding of Part.state schema |
| `session/compaction.ts` (~L344-L582) | Backend Architect | **Modify:** Add anti-thrashing counter + skip logic | — |
| `session/compaction.ts` (~L398) | Backend Architect | **Modify:** Add `experimental.compaction.before` hook trigger | — |
| `@opencode-ai/plugin/src/index.ts` | Software Architect | **Modify:** Add `experimental.compaction.before` hook | — |

**Indirectly affected:**

- `session/message-v2.ts` — `toModelMessagesEffect` function (same file, ~L750-L800) reads collapsed output
- LLM effectiveness — informative collapses give better signal than "[Old tool result content cleared]"
- Compaction test fixtures may need updating if they assert on the old placeholder string

**Verification by:** Senior QA

- Collapsed tool results show `[tool] grep → found 4 matches (1,200 chars)` instead of generic placeholder
- Compaction skips after 2 consecutive <10% savings passes
- Pre-compaction hook fires and receives `{ sessionID, messages }`

### Phase 5: Browser Tools

**Subagent: Backend Architect** (owner), **Senior QA** (test), **Frontend Developer** (UI)

| File | Agent | Action | Depends On |
|------|-------|--------|------------|
| `tool/browser/schema.ts` | Software Architect | Create: BrowserSessionID, BrowserState, tool param schemas | — |
| `tool/browser/engine.ts` | Backend Architect | Create: `BrowserEngine` — Playwright lifecycle (launch/context/page per-session/dispose) | playwright (npm) |
| `tool/browser/navigate.ts` | Backend Architect | Create: `browser_navigate` tool | engine.ts |
| `tool/browser/click.ts` | Backend Architect | Create: `browser_click` tool | engine.ts |
| `tool/browser/type.ts` | Backend Architect | Create: `browser_type` tool | engine.ts |
| `tool/browser/snapshot.ts` | Backend Architect | Create: `browser_snapshot` tool | engine.ts |
| `tool/browser/screenshot.ts` | Backend Architect | Create: `browser_screenshot` tool | engine.ts |
| `tool/browser/evaluate.ts` | Backend Architect | Create: `browser_evaluate` tool | engine.ts |
| `tool/browser/index.ts` | Backend Architect | Create: tool registration, gating, engine lifecycle init | all of above |
| `package.json` (opencode) | Backend Architect | **Modify:** Add `playwright` as optional dependency | — |
| `tool/registry.ts` | Backend Architect | **Modify:** Register browser tools (gated by `experimental.browser.enabled`) | browser/index.ts |
| Config (`config/`) | Backend Architect | **Modify:** Add `experimental.browser` config section | — |
| `console/app/src/routes/browser/` | Frontend Developer | Create: Browser session viewer page (list active sessions, current URL, screenshot gallery) | browser/engine.ts exports |

**Indirectly affected:**

- Permission system — new permission type `"browser"` needs addition to permission schema
- Truncation system — screenshot output may exceed default 2000-line limit, needs `truncation.ts` to handle binary content
- Config — `experimental.browser` needs to merge into config schema (TypeScript type + JSON parsing)
- Console package — new dependency on `playwright` console types (if viewing browser state)
- OTEL spans — browser tool calls need tracing spans

**Verification by:** Senior QA

- `bun install --optional playwright` completes cleanly
- Agent can navigate to URL, snapshot page, click elements, type text, take screenshot
- Permission prompts fire for browser actions
- Browser engine disposes cleanly on session end
- Screenshot output is truncated properly

### Phase 6: Channels

**Subagent: Software Architect** (owner - interface design), **Backend Architect** (implement - transports)

| File | Agent | Action | Depends On |
|------|-------|--------|------------|
| `channels/schema.ts` | Software Architect | Create: ChannelID, ChannelInfo schemas + config types | — |
| `channels/channel.sql.ts` | Database Optimizer | Create: `channel_config` Drizzle table | schema.ts |
| `channels/index.ts` | Backend Architect | Create: Channel registry — CRUD, event forwarding, lifecylce | channel.sql.ts |
| `channels/transports/slack.ts` | Backend Architect | Create: Slack transport — webhook posting + event subscription | channels/index.ts |
| `channels/transports/discord.ts` | Backend Architect | Create: Discord transport — webhook posting + event subscription | channels/index.ts |
| Config (`config/`) | Backend Architect | **Modify:** Add `channels` config section | — |
| `channels/migrations/001_create_channel_config.sql` | Database Optimizer | Create: Drizzle migration SQL | channel.sql.ts |
| `console/app/src/routes/channels/` | Frontend Developer | Create: Channel admin page — list, add, remove, test channel configs | channels/index.ts |

**Indirectly affected:**

- Bus event filtering — channels subscribe to all bus events; may need filtering/per-event routing
- `@opencode-ai/plugin` — channel templates are published as reference plugins, not core changes
- Config merge — `channels` section added to config schema
- Migration pipeline — new table needs to be discovered by Drizzle migration runner

**Verification by:** Senior QA

- Channel config create/read/update/delete works
- Bus events forward to Slack webhook
- Channel tools register and execute

---

## 10. Indirect Effects & UI Impact

### 10.1 Console / Dashboard UI (`packages/console/app/src/`)

The console (SvelteKit web app) needs new pages and widgets for each subsystem:

| Subsystem | New Pages | Files | Priority |
|-----------|-----------|-------|----------|
| **Memory** | Memory list (table + search), Memory detail view | `routes/memory/`, `routes/memory/[id]/` | Medium |
| **Curation** | Curation run log viewer, curation stats dashboard | `routes/admin/curation/` | Low |
| **Browser** | Active browser sessions list, current page view, screenshot gallery | `routes/browser/`, `routes/browser/[session]/` | Medium |
| **Channels** | Channel admin — list, add, remove, test, connection status | `routes/channels/`, `routes/channels/[id]/` | Low |
| **Config** | Self-improvement + browser + channels config editor sections | Extension of existing `routes/settings/` | Low |

**Console files indirectly affected:**

```
packages/console/app/src/
  ├── routes/
  │   ├── memory/                        (NEW)
  │   │   ├── +page.svelte              — Memory list (table, search, filter)
  │   │   └── [id]/
  │   │       └── +page.svelte          — Memory detail (content, relations, history)
  │   ├── browser/                       (NEW)
  │   │   ├── +page.svelte              — Active browser sessions list
  │   │   └── [session]/
  │   │       └── +page.svelte          — Per-session browser view (URL, screenshot, snapshot)
  │   ├── channels/                      (NEW)
  │   │   ├── +page.svelte              — Channel list + add button
  │   │   └── [id]/
  │   │       └── +page.svelte          — Channel detail (config, status, test button)
  │   ├── settings/
  │   │   └── +page.svelte              — MODIFY: add self_improvement + browser + channels sections
  │   └── admin/
  │       └── curation/                  (NEW)
  │           └── +page.svelte          — Curation run log + stats dashboard
  ├── lib/
  │   ├── components/
  │   │   ├── MemoryCard.svelte         — Memory summary card
  │   │   ├── MemorySearch.svelte       — Search bar + type/layer/tag filters
  │   │   ├── BrowserPreview.svelte     — Browser screenshot preview + page info
  │   │   ├── ChannelStatusBadge.svelte — Connected/disconnected/error badge
  │   │   └── CurationRunRow.svelte     — Single run row in curation log
  │   └── api/
  │       └── self-improvement.ts       — API client for memory operations
```

### 10.2 CLI Admin Commands (`packages/opencode/src/cli/cmd/`)

New CLI commands for the `code` CLI:

| Command | Implementation File | Purpose |
|---------|-------------------|---------|
| `code memory list [--type] [--tag]` | `cli/cmd/memory/list.ts` | List memories with filtering |
| `code memory show <id>` | `cli/cmd/memory/show.ts` | Show memory detail |
| `code memory prune [--days]` | `cli/cmd/memory/prune.ts` | Purge memories older than N days |
| `code memory search <query>` | `cli/cmd/memory/search.ts` | Full-text search memories |
| `code browser list` | `cli/cmd/browser/list.ts` | List active browser sessions |
| `code browser close <id>` | `cli/cmd/browser/close.ts` | Force-close a browser session |
| `code channel add <type> <name>` | `cli/cmd/channel/add.ts` | Add a channel config |
| `code channel list` | `cli/cmd/channel/list.ts` | List configured channels |
| `code channel test <id>` | `cli/cmd/channel/test.ts` | Test channel connectivity |
| `code curation status` | `cli/cmd/curation/status.ts` | Show curation fiber health + last run |
| `code curation run` | `cli/cmd/curation/run.ts` | Manually trigger curation cycle |

**CLI files indirectly affected:**

```
packages/opencode/src/cli/
  ├── cmd/
  │   ├── memory/                       (NEW directory)
  │   │   ├── list.ts
  │   │   ├── show.ts
  │   │   ├── prune.ts
  │   │   └── search.ts
  │   ├── browser/                      (NEW directory)
  │   │   ├── list.ts
  │   │   └── close.ts
  │   ├── channel/                      (NEW directory)
  │   │   ├── add.ts
  │   │   ├── list.ts
  │   │   ├── test.ts
  │   │   └── remove.ts
  │   └── curation/                     (NEW directory)
  │       ├── status.ts
  │       └── run.ts
  ├── index.ts                          MODIFY: register new command groups
  └── help.ts                           MODIFY: add new commands to help text
```

### 10.3 Event Changes (Indirect)

New bus events emitted by the new subsystems:

| Subsystem | New Bus Events | File | Source |
|-----------|---------------|------|--------|
| Memory | `memory.stored`, `memory.recalled`, `memory.evolved`, `memory.decayed` | `self-improvement/memory-bus-events.ts` | memory-store.ts |
| Curation | `curation.started`, `curation.ended`, `curation.error` | `self-improvement/curation-bus-events.ts` | curation.ts |
| Browser | `browser.session.created`, `browser.session.closed`, `browser.navigated`, `browser.error` | `tool/browser/bus-events.ts` | engine.ts |
| Channels | `channel.connected`, `channel.disconnected`, `channel.message.sent`, `channel.error` | `channels/bus-events.ts` | transports/*.ts |

Each set of events follows the existing `BusEvent.define()` pattern:

```typescript
// Example: packages/opencode/src/self-improvement/memory-bus-events.ts
import { BusEvent } from "../../bus/bus-event"

export const MemoryStored = BusEvent.define(
  "memory.stored",
  Schema.Struct({
    memory_id: MemoryID,
    type: MemoryType,
    tags: Schema.Array(Schema.String),
    importance: Schema.Number,
  })
)

export const MemoryRecalled = BusEvent.define(
  "memory.recalled",
  Schema.Struct({
    memory_id: MemoryID,
    query: Schema.String,
    relevance_score: Schema.Number,
  })
)
```

### 10.4 Config Schema Changes (Indirect)

The config system (`config/config.ts`) needs new sections. Each section gets its own file following the existing self-export pattern:

| New Config File | Section Key | Fields |
|----------------|-------------|--------|
| `config/self-improvement.ts` | `self_improvement` | `enabled`, `curation_interval_ms`, `max_memories_per_session`, `enable_auto_store`, `recall.max_results`, `recall.min_confidence` |
| `config/browser.ts` | `experimental.browser` | `enabled`, `headless`, `viewport.width`, `viewport.height`, `channel` |
| `config/channels.ts` | `channels` | `enabled`, `allow_auto_connect` |

```typescript
// packages/opencode/src/config/self-improvement.ts
import { Schema } from "@effect/schema"

export const SelfImprovementConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDefault(() => false)),
  curation_interval_ms: Schema.Number.pipe(Schema.int(), Schema.withDefault(() => 3600000)),
  max_memories_per_session: Schema.Number.pipe(Schema.int(), Schema.withDefault(() => 5)),
  enable_auto_store: Schema.Boolean.pipe(Schema.withDefault(() => true)),
  recall: Schema.Struct({
    max_results: Schema.Number.pipe(Schema.int(), Schema.withDefault(() => 5)),
    min_confidence: Schema.Number.pipe(Schema.withDefault(() => 0.3)),
  }),
})

// Self-export pattern (same as existing config modules)
export * as ConfigSelfImprovement from "./self-improvement"
```

**Config index indirectly affected:**

- `packages/opencode/src/config/config.ts` — MODIFY: merge new config sections into `Config` union type
- `packages/opencode/src/config/index.ts` — MODIFY: add new exports

### 10.5 Permission System Changes (Indirect)

Browser tools introduce a new permission type. Current permission schemas may need extension.

| File | Change |
|------|--------|
| `packages/opencode/src/permission/schema.ts` | Add `"browser"` to permission type union |
| `packages/opencode/src/permission/prompts.ts` | Add browser-specific permission prompt text |

```typescript
// In permission/schema.ts — modified union
export const PermissionType = Schema.Literal(
  "read",
  "write",
  "edit",
  "shell",
  "network",
  "browser",     // NEW
)
```

### 10.6 Tool Truncation Changes (Indirect)

Browser screenshot tool can produce very large output (full-page screenshots can be multi-MB). The existing truncation system (`tool/truncate.ts`) handles text output up to 2000 lines/50KB. Screenshots need:

| File | Change |
|------|--------|
| `tool/truncate.ts` | Add `binaryOutputTruncation()` — base64 screenshot truncation by pixel dimensions |
| `tool/truncation-dir.ts` | Confirm truncation directory exists for file-spillover of large screenshots |

---

## 11. Cron / Heartbeat / Maintenance

Self-improvement requires periodic maintenance — these are not one-shot cron jobs but Effect fibers running inside the opencode process.

### 11.1 Process Architecture

All scheduled tasks run as **Effect fibers** inside the opencode process, not as OS cron jobs. This is consistent with existing patterns (EventV2 subscriptions, bus pub-sub, background tasks).

```
┌─────────────────────────────────────────────────────────────┐
│                  OpenCode Process                            │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Curation Fiber (every 1h)                           │    │
│  │  ├─ Memory consolidation (merge similar)             │    │
│  │  ├─ Memory evolution (promote/demote layers)         │    │
│  │  ├─ Pattern discovery (LLM on clusters)              │    │
│  │  └─ Log run metrics to curation_run_log              │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Decay Fiber (every 6h)                             │    │
│  │  ├─ Scan for unaccessed memories (heartbeat_at)      │    │
│  │  ├─ Decrement importance by 0.1 per cycle            │    │
│  │  ├─ Purge memories below importance_threshold        │    │
│  │  └─ Emit memory.decayed events for each removal      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Heartbeat Touch (every 5min)                        │    │
│  │  ├─ Update heartbeat_at on all frequently-accessed   │    │
│  │  │  memories (access_count > threshold)               │    │
│  │  └─ Prevent false-positive decay for active memories  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Health Check Fiber (every 5min)                    │    │
│  │  ├─ Check memory store integrity (row count, size)   │    │
│  │  ├─ Check curation fiber is alive (supervised)       │    │
│  │  ├─ Check browser engine is healthy (if active)      │    │
│  │  └─ Check channel connections are alive (if enabled) │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 11.2 Fiber Definitions

```typescript
// packages/opencode/src/self-improvement/heartbeat.ts
// — Heartbeat touch fiber: prevents false-positive decay
export const HeartbeatFiber = Layer.effect(
  Tag<Fiber.FiberId>(),
  Effect.gen(function*() {
    const config = yield* SelfImprovementConfig
    if (!config.enabled) return FiberId.none

    const fiber = yield* Effect.fork(
      Effect.forever(
        pipe(
          // Touch all memories with access_count >= 3 (keep them alive)
          MemoryStore.touchActive({ minAccessCount: 3 }),
          Effect.delay("5 minutes"),
        )
      )
    )
    return fiber.id
  })
)

// packages/opencode/src/self-improvement/decay.ts
// — Decay fiber: long-interval memory decay processing
export const DecayFiber = Layer.effect(
  Tag<Fiber.FiberId>(),
  Effect.gen(function*() {
    const fiber = yield* Effect.fork(
      Effect.forever(
        pipe(
          DecayProcessor.run({
            decayAmount: 0.1,
            purgeThreshold: 0.1,
            unaccessedDays: 7,
          }),
          Effect.delay("6 hours"),
        )
      )
    )
    return fiber.id
  })
)

// packages/opencode/src/self-improvement/health-check.ts
// — Health check fiber: periodic system health verification
export const HealthCheckFiber = Layer.effect(
  Tag<Fiber.FiberId>(),
  Effect.gen(function*() {
    const fiber = yield* Effect.fork(
      Effect.forever(
        pipe(
          HealthCheck.run(),
          Effect.catchAll((err) =>
            Effect.logWarning("Health check failed", err)
          ),
          Effect.delay("5 minutes"),
        )
      )
    )
    return fiber.id
  })
)
```

### 11.3 Curation Schedule Constants

```typescript
// packages/opencode/src/self-improvement/curation.ts

export const CURATION_DEFAULTS = {
  interval: 3600_000,           // 1 hour — main curation cycle
  decayInterval: 21_600_000,    // 6 hours — decay processing
  heartbeatInterval: 300_000,   // 5 minutes — memory touch
  healthCheckInterval: 300_000, // 5 minutes — system health

  // Decay thresholds
  decayAmount: 0.1,             // importance decrement per decay cycle
  purgeThreshold: 0.1,          // purge memories below this importance
  unaccessedDays: 7,            // consider unaccessed after N days

  // Evolution thresholds
  promoteAccessCount: 10,       // promote to long_term after N accesses
  demoteAccessCount: 0,         // demote if access_count = 0 for 3 cycles
  minConfidenceForPattern: 0.7, // minimum confidence to emit pattern memory

  // Consolidation thresholds
  similarityThreshold: 0.85,    // cosine similarity / tag overlap for merging
  maxBatchSize: 100,            // memories per consolidation batch
}
```

### 11.4 Fiber Lifecycle

All fibers follow the same lifecycle pattern as existing OpenCode background processes:

```typescript
// In self-improvement/index.ts — boot integration
export const SelfImprovementBoot = Layer.effect(
  Tag<void>(),
  Effect.gen(function*() {
    yield* CurationFiber       // starts curation loop
    yield* DecayFiber          // starts decay processing
    yield* HeartbeatFiber      // starts heartbeat touching
    yield* HealthCheckFiber    // starts health checks

    // Cleanup on shutdown
    yield* Effect.addFinalizer(() =>
      Effect.log("Shutting down self-improvement fibers")
    )
  })
)
```

### 11.5 Heartbeat Storage

Each memory's `heartbeat_at` field is the record of the last time the heartbeat fiber touched it:

| Scenario | heartbeat_at | Action |
|----------|-------------|--------|
| Memory recently accessed (<=5min) | Touched by heartbeat fiber | Protected from decay |
| Memory accessed in last session | Set by `recall` tool | Not decayed yet |
| Memory untouched for 7 days | Not touched by heartbeat | Decayed by 0.1 per 6h cycle |
| Memory importance < 0.1 | N/A | Purged on next decay cycle |

---

## 12. Complete File Manifest

Every file that will be **created** or **modified** across all 6 phases, organized by subsystem.

### 12.1 Created Files — Self-Improvement

```
packages/opencode/src/self-improvement/
  ├── index.ts
  ├── schema.ts
  ├── memory.sql.ts
  ├── memory-store.ts
  ├── memory-bus-events.ts
  ├── curation.ts
  ├── curation-log.sql.ts
  ├── curation-bus-events.ts
  ├── decay.ts
  ├── heartbeat.ts
  ├── health-check.ts
  ├── pattern-extractor.ts
  ├── tools/
  │   ├── index.ts
  │   ├── remember.ts
  │   └── recall.ts
  ├── prompts/
  │   ├── evolve.md
  │   └── pattern.md
  ├── migrations/
  │   ├── 001_create_memory_table.sql
  │   ├── 002_create_fts5_index.sql          (V2)
  │   └── 003_create_curation_log.sql
  └── test/
      ├── memory-store.test.ts
      ├── remember.test.ts
      ├── recall.test.ts
      ├── curation.test.ts
      └── decay.test.ts
```

**Total: 21 new files**

### 12.2 Created Files — Browser

```
packages/opencode/src/tool/browser/
  ├── index.ts
  ├── schema.ts
  ├── engine.ts
  ├── navigate.ts
  ├── click.ts
  ├── type.ts
  ├── snapshot.ts
  ├── screenshot.ts
  ├── evaluate.ts
  ├── bus-events.ts
  └── test/
      ├── engine.test.ts
      ├── navigate.test.ts
      ├── click.test.ts
      └── screenshot.test.ts

packages/console/app/src/routes/browser/
  ├── +page.svelte
  └── [session]/
      └── +page.svelte
```

**Total: 16 new files**

### 12.3 Created Files — Channels

```
packages/opencode/src/channels/
  ├── index.ts
  ├── schema.ts
  ├── channel.sql.ts
  ├── bus-events.ts
  ├── migrations/
  │   └── 001_create_channel_config.sql
  ├── transports/
  │   ├── slack.ts
  │   └── discord.ts
  └── test/
      ├── channel-store.test.ts
      ├── slack.test.ts
      └── discord.test.ts

packages/console/app/src/routes/channels/
  ├── +page.svelte
  └── [id]/
      └── +page.svelte
```

**Total: 12 new files**

### 12.4 Created Files — CLI Commands

```
packages/opencode/src/cli/cmd/
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

**Total: 12 new files**

### 12.5 Created Files — Config

```
packages/opencode/src/config/
  ├── self-improvement.ts    (NEW)
  ├── browser.ts             (NEW)
  └── channels.ts            (NEW)
```

**Total: 3 new files**

### 12.6 Created Files — Console Widgets

```
packages/console/app/src/
  ├── routes/memory/
  │   ├── +page.svelte
  │   └── [id]/
  │       └── +page.svelte
  ├── routes/admin/curation/
  │   └── +page.svelte
  ├── routes/settings/
  │   └── (modify: add sections)
  └── lib/
      ├── components/
      │   ├── MemoryCard.svelte
      │   ├── MemorySearch.svelte
      │   ├── BrowserPreview.svelte
      │   ├── ChannelStatusBadge.svelte
      │   └── CurationRunRow.svelte
      └── api/
          └── self-improvement.ts
```

**Total: 10 new files**

### 12.7 Modified Files

| File | Package | Change |
|------|---------|--------|
| `packages/plugin/src/index.ts` | `@opencode-ai/plugin` | Add 4 new `experimental.*` hook types |
| `packages/plugin/package.json` | `@opencode-ai/plugin` | Version bump (minor) |
| `packages/opencode/src/tool/registry.ts` | opencode | Register `remember`, `recall`, `browser_*` tools |
| `packages/opencode/src/session/prompt.ts` | opencode | Add hook triggers + memory injection (~10 lines) |
| `packages/opencode/src/session/processor.ts` | opencode | Add error hook trigger (~5 lines) |
| `packages/opencode/src/session/session.ts` | opencode | Add session.ended hook trigger (~5 lines) |
| `packages/opencode/src/session/message-v2.ts` | opencode | Informative tool collapse (~30 lines) |
| `packages/opencode/src/session/compaction.ts` | opencode | Anti-thrashing + pre-compaction hook (~40 lines) |
| `packages/opencode/src/config/config.ts` | opencode | Merge new config sections |
| `packages/opencode/src/config/index.ts` | opencode | Add new config module exports |
| `packages/opencode/src/permission/schema.ts` | opencode | Add `"browser"` permission type |
| `packages/opencode/src/permission/prompts.ts` | opencode | Add browser permission prompt text |
| `packages/opencode/src/tool/truncate.ts` | opencode | Add binary output truncation for screenshots |
| `packages/opencode/src/cli/index.ts` | opencode | Register new CLI command groups |
| `packages/opencode/src/cli/help.ts` | opencode | Add new commands to help text |
| `packages/opencode/package.json` | opencode | Add `playwright` optional dependency |
| `packages/console/app/src/lib/api/` | console | Add self-improvement API client integration |
| `packages/console/app/src/routes/settings/+page.svelte` | console | Add self-improvement + browser + channels settings |

**Total: 18 modified files**

### 12.8 Grand Totals

| Metric | Count |
|--------|-------|
| New files | 74 |
| Modified files | 18 |
| Total files touched | 92 |
| Implementation phases | 6 |
| Subagent types involved | 8 |
| New Drizzle tables | 3 (memory, curation_log, channel_config) |
| New Bus events | 14 |
| New CLI commands | 12 |
| New console pages | 8 |
| New console components | 5 |
| New Effect fibers | 4 (curation, decay, heartbeat, health-check) |
| New plugin hooks | 4 (3 session + 1 compaction) |

---

## Appendix: Hermes Patterns Decided

| Hermes Pattern | Decision | Rationale |
|---------------|----------|-----------|
| Memory flush before compaction | ✅ Phase 4 (pre-compaction hook) | Enables memory extraction before lossy compression |
| Frozen snapshot + hot writes | ✅ Phase 1 (system prompt injection) | Best practice from Hermes — preserves prefix caching |
| FTS5 searchable lineage | ⏸️ V3 | Valuable but complex. V1 keyword, V2 FTS5, V3 lineage |
| Two-layer curation | ✅ Phase 3 | Deterministic (access count) + LLM (pattern detection) |
| Anti-thrashing | ✅ Phase 4 | Small change, prevents oscillation |
| Informative tool collapse | ✅ Phase 4 | High signal-to-noise improvement |
| Sandbox persistence | ❌ Deferred | Marginal benefit for current architecture |
| Focus topic for compaction | ❌ Deferred | Configurable later via pre-compaction hook |
| Smart budget enforcement | ❌ Deferred | OpenCode's approach is simpler and sufficient |

## Appendix: What We're NOT Doing

| Considered | Decision |
|------------|----------|
| New plugin system for self-improvement | ❌ Improve @opencode-ai/plugin (2 already exist, don't add a third) |
| Replace compaction with Hermes version | ❌ Architecturally convergent, not worth replacement cost |
| Replace EventV2 with custom event system | ❌ 27 events already exist, subscribe pattern works |
| Cloud sync for memory store | ❌No cloud for now, we can add it later preffered privacy for users (Local Memory Storage) |
| Full Hermes agent runtime (claude_code_agent.py) | ❌ Only self-improvement patterns |
| Embedding-based semantic search (V1) | ❌ Keyword/FTS5 first — LLM ranking  if needed |
| New Service type in packages/core | ❌ No new core abstractions |
| PluginV2 changes (core hook system) | ❌ Core hooks are for model/provider plumbing, not self-improvement |
| Channel as separate plugin kind | ❌ Standard @opencode-ai/plugin is sufficient |
