# Hermes Agent: Learning-Over-Time Architecture Patterns

> Consolidation of deep-dive research into Hermes Agent's memory, self-evolution,
> and context persistence systems — with implications for opencode architecture.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Memory Architecture](#2-memory-architecture)
3. [Self-Evolution & Curation](#3-self-evolution--curation)
4. [Context Persistence & Budget Management](#4-context-persistence--budget-management)
5. [Cross-Cutting Patterns](#5-cross-cutting-patterns)
6. [Trade-Off Atlas](#6-trade-off-atlas)
7. [OpenCode Implications](#7-opencode-implications)

---

## 1. Architecture Overview

Hermes Agent's learning-over-time capability is built on **three orthogonal pillars**
that interact through well-defined interfaces:

```
┌─────────────────────────────────────────────────────────────┐
│                    HERMES AGENT SYSTEM                       │
│                                                              │
│   ┌─────────────────┐  ┌──────────────────┐  ┌───────────┐ │
│   │   PILLAR 1:     │  │   PILLAR 2:      │  │ PILLAR 3: │ │
│   │   Memory        │  │   Self-Evolution │  │  Context  │ │
│   │                 │  │                  │  │  Budget   │ │
│   │ MEMORY.md       │  │ Curator (LLM)    │  │ Per-tool  │ │
│   │ USER.md         │  │ Auto-transitions │  │ Per-result│ │
│   │ Session Search  │  │ Skill Telemetry  │  │ Per-turn  │ │
│   │ Memory Providers│  │ Cron/Routines    │  │ Sandbox   │ │
│   └────────┬────────┘  └────────┬─────────┘  └─────┬─────┘ │
│            │                    │                    │       │
│            └────────────────────┼────────────────────┘       │
│                                 │                            │
│                      ┌──────────▼──────────┐                  │
│                      │   SessionDB (SQLite) │                 │
│                      │   FTS5, Lineage,    │                 │
│                      │   Compression Chain │                  │
│                      └─────────────────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow Across Pillars

```
Session Start
│
├── MemoryStore.load_from_disk()
│   ├── Reads MEMORY.md + USER.md
│   └── Captures frozen snapshot → injected in system prompt
│
├── Session search available via FTS5
│   └── Zero LLM cost — reads SQLite directly
│
├── ContextEngine.on_session_start()
│   └── Registers token tracking
│
└── Skill system loaded
    └── Curator checks if background pass is due

During Conversation
│
├── memory tool (add/replace/remove)
│   ├── Writes to MEMORY.md / USER.md immediately (hot path)
│   └── System prompt snapshot stays frozen (prefix cache)
│
├── session_search tool (discover/scroll/browse)
│   └── FTS5 → lineage dedup → bookended windows
│
├── Tool result persistence (3 layers)
│   ├── Per-tool cap (tool pre-truncates)
│   ├── Per-result threshold → sandbox file + preview
│   └── Per-turn aggregate budget → spill largest
│
└── Context compression (when threshold hit)
    ├── ContextCompressor.should_compress()
    ├── Compress middle turns → summary message
    └── replace_messages() on SessionDB

Session End / Background
│
├── Curator (idle > min_idle_hours)
│   ├── Auto transitions (pure Python)
│   └── LLM review → consolidation/pruning
│
├── Skill usage telemetry (bump counters)
│
└── Cron/Routines scheduler
    └── Three trigger types (cron, webhook, API)
```

---

## 2. Memory Architecture

### 2.1 Bounded Curated Memory (MemoryStore)

**Files**: `~/.hermes/memories/MEMORY.md` and `USER.md`

Designed as **small, durable, high-value** memory — not exhaustive history.

| Property | Value | Rationale |
|----------|-------|-----------|
| Storage format | `§`-delimited entries in markdown | Simple, diffable, human-editable |
| MEMORY.md limit | 2,200 chars | Enforces curation pressure |
| USER.md limit | 1,375 chars | Smaller — user facts are more sensitive |
| Snapshot strategy | Frozen at session start | Prefix cache stability |
| Mid-session writes | Write-through to disk | Durable, but snapshot unchanged |
| Dedup | Lossy dedup on load (first-wins) | Simple, prevents duplicates across sessions |

**Key Innovation — Frozen Snapshot Pattern:**

```python
# At session start — system prompt gets this frozen copy
self._system_prompt_snapshot = {
    "memory": render_block(self.memory_entries),  # NEVER changes mid-session
    "user": render_block(self.user_entries),
}

# Mid-session — file writes happen but snapshot stays
# Tool responses show LIVE state via MemoryStore methods
```

This is critical because:

- The system prompt (containing memory) is **identical every turn**
- Provider prefix caching stays valid across the entire session
- Only `memory` tool responses show the live state, not the prompt
- Next session picks up the new state naturally

**Write Safety — Atomic File Protocol:**

```
1. tempfile.mkstemp(dir=same_directory, suffix=".tmp", prefix=".mem_")
2. Write content, f.flush(), os.fsync()
3. os.replace(tmp_path, real_path)  ← atomic on POSIX
4. On failure: os.unlink(tmp_path) cleanup
```

No file locking needed for readers — atomic rename means every reader sees
either the old complete file or the new complete file.

**File Locking for Writers:**

- `fcntl.flock` on Unix, `msvcrt.locking` on Windows
- Uses a `.lock` sidecar file (separate from data file)
- Graceful fallback when neither locking module available

### 2.2 Session Search (FTS5)

**Three modes, single tool shape:**

```
session_search(query="auth refactor")          → DISCOVERY
session_search(session_id="x", around_msg=42)  → SCROLL
session_search()                                → BROWSE
```

**Discovery Mode:**

1. FTS5 full-text search against SQLite message store
2. Lineage-aware dedup: walk `parent_session_id` chain to root, collapse hits
3. For each hit: ±5 message window + bookends (first 3 + last 3 messages)
4. Result: goal → match → resolution, all from DB, zero LLM calls

**Scroll Mode:**

- Anchor on a `message_id`, return window of ±N messages
- Page forward/backward by re-anchoring on boundary message
- Handles lineage rebind: if message lives in child session, rebind transparently

**Browse Mode:**

- No arguments → recent sessions chronologically
- Excludes current session lineage and tool-generated sessions

**Design Decisions:**

- **Zero LLM calls** — every shape returns actual messages from SQLite
- **Bookends are free** — cheap SQL window queries, not LLM summaries
- **Lineage dedup** — compression creates child sessions; user shouldn't see duplicates
- **FTS5 syntax** — AND is default, OR explicit, quoted phrases, prefix wildcards

### 2.3 Memory Provider Plugin System

Plugable memory backends via ABC (`MemoryProvider`):

```python
class MemoryProvider(ABC):
    @abstractmethod
    def sync_turn(self, turn_messages) → None
    @abstractmethod
    def prefetch(self, query) → List[str]
    def post_setup(self, hermes_home, config) → None
    def shutdown(self) → None
    # + 5 more optional hooks
```

**Lifecycle Hooks:**

| Hook | When Called | Purpose |
|------|-------------|---------|
| `sync_turn(turn_messages)` | After each assistant + tool turn | Feed conversation to external memory |
| `prefetch(query)` | At session start | Load relevant memories for context |
| `post_setup(home, config)` | After `hermes memory setup` | One-time initialization |
| `shutdown()` | Session end | Cleanup resources |

**Built-in providers:** honcho, mem0, supermemory, byterover, hindsight,
holographic, openviking, retaindb

**Single-external-provider enforcement:** only one external memory provider
can be active at a time (no cross-provider conflicts). The built-in
`MemoryStore` (MEMORY.md/USER.md) always runs alongside.

### 2.4 Key Insights for OpenCode

1. **Frozen snapshot + hot writes** — the most valuable pattern. System prompt
   stays cached, but mutations are durable immediately.
2. **Small curated + deep searchable** — don't try to put everything in the
   prompt. Keep a tight curated set, point to search for everything else.
3. **Bookends are free** — a few SQL queries give the model "goal → match →
   resolution" context without paying for the full transcript.
4. **Lineage dedup > content dedup** — cheaper and more semantically correct
   (compression is a continuation, not a duplicate).

---

## 3. Self-Evolution & Curation

### 3.1 Skill Lifecycle

```
                 ┌─────────────────────────────┐
                 │       Skill Created          │
                 │  skill_manage(action="create")│
                 └────────────┬────────────────┘
                              │ mark_agent_created()
                              ▼
                    ┌─────────────────┐
                    │    ACTIVE       │ ← default state
                    │  pinned? → skip │
                    └────────┬────────┘
                             │ inactivity > stale_after_days (30d)
                             ▼
                    ┌─────────────────┐
                    │     STALE       │
                    │  auto-detected  │
                    └────────┬────────┘
                             │ inactivity > archive_after_days (90d)
                             ▼
                    ┌─────────────────┐
                    │   ARCHIVED      │
                    │  moved to .arch/│
                    │  restorable     │ ← hermes curator restore
                    └─────────────────┘
```

### 3.2 Usage Telemetry

**Sidecar file:** `~/.hermes/skills/.usage.json`

```json
{
  "my-skill": {
    "created_by": "agent",
    "use_count": 12,
    "view_count": 3,
    "patch_count": 2,
    "last_used_at": "2026-05-30T10:00:00",
    "last_viewed_at": "2026-05-28T15:00:00",
    "last_patched_at": "2026-05-25T09:00:00",
    "created_at": "2026-04-01T00:00:00",
    "state": "active",
    "pinned": false,
    "archived_at": null
  }
}
```

**Derived activity:** `latest_activity_at()` returns max of `last_used_at`,
`last_viewed_at`, `last_patched_at` (excludes `created_at` intentionally).

**Provenance tracking — three tiers:**

| Source | Marker | Curator-eligible? |
|--------|--------|-------------------|
| Bundled | `.bundled_manifest` | ❌ Never |
| Hub-installed | `.hub/lock.json` | ❌ Never |
| Agent-created | `created_by: "agent"` in `.usage.json` | ✅ Yes |

Multiple safety checks: `archive_skill()` double-checks even though callers
should filter. `restore_skill()` refuses collisions with upstream sources.

### 3.3 Curator — Two-Layer Architecture

**Layer 1 — Automatic Transitions (pure Python, no LLM):**

```python
apply_automatic_transitions(now):
    stale_cutoff = now - stale_after_days     # default: 30d
    archive_cutoff = now - archive_after_days  # default: 90d
    anchor = last_activity_at ?? created_at ?? now

    for each agent-created skill:
        if pinned: continue
        if anchor <= archive_cutoff → archive_skill()
        if anchor <= stale_cutoff   → set_state(STALE)
        if anchor > stale_cutoff    → set_state(ACTIVE)  # reactivation
```

Deterministic, fast, no API costs. Handles the common cases (stale → archive).

**Layer 2 — LLM Review (expensive, infrequent):**

Spawns a forked AIAgent with `max_iterations=9999` for umbrella-building:

1. Scans all agent-created skills
2. Identifies **prefix clusters** (skills sharing domain keyword)
3. Consolidates narrow skills into umbrella/class-level skills:
   - **Merge into existing umbrella** — patch the broadest, archive the rest
   - **Create new umbrella** — create class-level skill, archive narrow siblings
   - **Demote to support files** — move content into `references/`, `scripts/`, archive
4. Outputs structured YAML with `consolidations:` and `prunings:` lists

**Critical safety: "Never delete" posture.** Max destructive action is archive
(to `.archive/`). Full backup (tar.gz) taken before every mutating run.
Rollback is itself undoable (safety snapshot before restoring).

**Cron job rewrite chaining:** When curator consolidates Skill A into Umbrella B,
cron jobs referencing A are automatically rewritten to reference B.

### 3.4 Cron / Routines / Automation

**Three trigger types:**

| Trigger | Example | Implementation |
|---------|---------|----------------|
| Scheduled | `"0 2 * * *"` | Cron scheduler with 3-min hard interrupt |
| Webhook | GitHub `pull_request` event | HMAC-authenticated webhook receiver |
| API | POST to endpoint | Same webhook infrastructure, no event filter |

**Script injection pattern:**

```bash
hermes cron create "every 1h" \
  "If CHANGE DETECTED, summarize. If NO_CHANGE, respond [SILENT]." \
  --script ~/.hermes/scripts/watch-site.py
```

Pre-run Python script's stdout becomes agent context. `[SILENT]` pattern means
zero notifications for no-op ticks.

**Cron hardening:**

- 3-minute hard interrupt on sessions
- Catchup window: half period, clamped 120s–2h
- File lock to prevent duplicate ticks
- `skip_memory=True` by default

### 3.5 Key Insights for OpenCode

1. **Provenance-driven eligibility** — every mutation checks origin first.
   Three-tier system with multiple enforcement layers.
2. **Two-layer curation** — cheap deterministic auto-transitions + expensive
   LLM consolidation. Don't pay for summarization when rule-based suffices.
3. **Never-delete posture** — archive + backup + rollback creates psychological
   safety for automated maintenance.
4. **Best-effort telemetry** — failures log at DEBUG, never break the calling tool.
5. **Cron rewrite chaining** — consolidations cascade to scheduled jobs automatically.

---

## 4. Context Persistence & Budget Management

### 4.1 Three-Layer Defense Against Overflow

```
Layer 1: Per-tool output cap
├── Each tool pre-truncates own return
├── Registry.get_max_result_size(tool_name)
└── Default: 100,000 chars

Layer 2: Per-result persistence
├── Exceeds threshold → write full output to sandbox
├── Replace in-context with <persisted-output> preview
└── read_file tool pinned to float("inf") to prevent loops

Layer 3: Per-turn aggregate budget
├── After all results collected in one turn
├── MAX_TURN_BUDGET_CHARS = 200,000
├── Spill largest non-persisted results until under budget
└── Already-persisted results skipped (detected via tag)
```

**Persisted Output Format:**

```
<persisted-output>
This tool result was too large (150,000 chars, 146.5 KB).
Full output saved to: /tmp/hermes-results/{tool_use_id}.txt
Use the read_file tool with offset and limit to access specific sections.

Preview (first 1500 chars):
...
</persisted-output>
```

**Key engineering detail — stdin piping to avoid MAX_ARG_STRLEN:**
Content is pushed through `env.execute(stdin_data=content)` rather than embedded
in command-line arguments. Linux's `MAX_ARG_STRLEN` caps argv at 128 KB; stdin
removes that ceiling.

### 4.2 Context Compression

**Live compression** (`ContextCompressor`):

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `threshold_percent` | 0.75 | % of model context length |
| `protect_first_n` | 3 | First non-system messages preserved |
| `protect_last_n` | 20 | Last messages (by token budget ~20K) |
| `summary_target_tokens` | scales as 20% of content | Proportional to volume |

Flow:

1. `should_compress_preflight()` — cheap estimate BEFORE API call
2. `should_compress()` — fires when prompt_tokens >= threshold
3. `compress()` — compress middle, keep head + tail
4. Summary budget: `content_tokens * 0.20`, capped 32K, floor 4K
5. `_previous_summary` carried across compressions (iterative preservation)
6. Secret redaction: strip API keys, tokens, passwords from summary prompt

**Offline compression** (`TrajectoryCompressor`):

- Separate CLI tool for post-processing training trajectories
- Batch-parallel: 50 concurrent API calls
- Per-trajectory timeout (5 min)
- HuggingFace tokenizer for accurate counting

### 4.3 SessionDB — SQLite Session Store

**Schema version 11**, WAL mode with NFS fallback to DELETE.

**Key tables:**

`sessions` — one row per conversation:

- `id`, `source`, `parent_session_id` (lineage), `model`, `system_prompt`
- `started_at`, `ended_at`, `end_reason` (compression creates child)
- `message_count`, `tool_call_count`, token counters, cost tracking

`messages` — full message history:

- `id`, `session_id`, `role`, `content`, `tool_call_id`, `tool_calls`, `tool_name`
- `reasoning`, `reasoning_content`, `reasoning_details`

**FTS5 search index:**

- `messages_fts` — standard unicode61 tokenizer
- `messages_fts_trigram` — trigram for CJK/substring search
- Both index content + tool_name + tool_calls
- Auto-sync via INSERT/DELETE/UPDATE triggers

**Session Lineage:**

- Compression creates child session with `parent_session_id`
- Timestamp gate: `child.started_at >= parent.ended_at` distinguishes
  compression forks from subagents (which start during parent's lifetime)
- `get_compression_tip()` walks chain (capped 100 hops) for resume redirection
- `list_sessions_rich()` projects roots to live tips so one logical
  conversation = one list entry

**Write concurrency:**

- `BEGIN IMMEDIATE` (locks at transaction start, not commit)
- Random jitter 20-150ms, 15 retries (breaks SQLite convoy behavior)
- Passive checkpoint every 50 writes

### 4.4 Context Engine Plugins

`ContextEngine` ABC defines the plugin contract:

| Method | Purpose |
|--------|---------|
| `name()` | Identifier ('compressor', 'lcm') |
| `update_from_response(usage)` | Track token usage per API response |
| `should_compress(prompt_tokens)` | Decision gate |
| `compress(messages, current_tokens, focus_topic)` | Main entry |
| `on_session_start/end()` | Session lifecycle |
| `get_tool_schemas()` / `handle_tool_call()` | Optional agent-exposed tools |
| `get_status()` | Display/logging info |

Three loading paths: default compressor → plugins/ → general plugin system.

### 4.5 Key Insights for OpenCode

1. **Three-layer defense** is the right pattern — each layer catches what the
   previous misses, and the cost is paid only at the layer needed.
2. **Stdin piping** is critical for large outputs — avoids argv size limits.
3. **Sandbox persistence** lets the model choose what to read — context cost is
   incurred only for what matters.
4. **Session lineage as compression chain** is elegant — compression creates a
   new "child" session, the chain is walkable in SQL, and listing tools project
   roots to tips transparently.
5. **Iterative summaries with carry-over** prevents information decay across
   multiple compression events.

---

## 5. Cross-Cutting Patterns

### 5.1 Atomic File Operations

Every Hermes file write across all systems uses the same protocol:

```python
fd, tmp_path = tempfile.mkstemp(dir=target_dir, suffix=".tmp", prefix=".prefix_")
try:
    with os.fdopen(fd, "w") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, real_path)   # atomic on POSIX
except BaseException:
    try: os.unlink(tmp_path)
    except OSError: pass
    raise
```

**Where used:** memory files, skill usage telemetry, curator state, backup snapshots, session DB.

### 5.2 Prefix-Cache-Friendly Design

All mutating systems follow the same rule: **never alter the system prompt mid-session**.

- MemoryStore: frozen snapshot at load time, hot writes to files only
- Skill system: skill changes deferred to next session (with `--now` flag for opt-in)
- Context compression: the single exception, and it's lossy+structured

Provider prefix caching stays valid across all turns. Only tool responses
reveal live state. This is the difference between "incurs caching cost on every
turn" and "caches once per session."

### 5.3 Best-Effort Mutations

Every telemetry, persistence, and curation path is best-effort:

- `_mutate()` failures log at DEBUG and return silently
- `save_usage()` never breaks the calling tool
- Curator LLM review failure → exponential cooldown, fallback model
- `maybe_persist_tool_result()` failure → inline truncation fallback

**The calling tool's success never depends on the side effect completing.**

### 5.4 Lock Granularity

| System | Lock Type | Lock Target |
|--------|-----------|-------------|
| Memory files | `fcntl.flock` / `msvcrt.locking` | `.lock` sidecar per file |
| Skill usage | `fcntl.flock` / `msvcrt.locking` | `.usage.json.lock` |
| Cron scheduler | File lock | `~/.hermes/cron/.tick.lock` |
| SessionDB | `BEGIN IMMEDIATE` + retry jitter | SQLite connection |

Locks are per-resource, not global. Cron and curator can run concurrently.
Multiple sessions can write memory simultaneously (last-writer-wins for content,
locking for structural integrity).

---

## 6. Trade-Off Atlas

| Decision | Given Up | Gained |
|----------|----------|--------|
| **Char limits not token limits** | Inaccurate for non-Latin scripts (CJK) | Model-independent, no tokenizer dependency |
| **Frozen memory snapshots** | Mid-session memory isn't in prompt | Prefix cache stable for entire session |
| **FTS5 over semantic search** | No cross-lingual, no synonym matching | Zero LLM cost, deterministic, fast |
| **Bookends not summaries** | Less context than a full summary | Free (SQL), not LLM-dependent |
| **Archive not delete** | Disk space for stale skills | Psychological safety, full undoability |
| **Two-layer curator** | Cleaner single-pass design | Cheap auto-transitions + expensive LLM only when needed |
| **Iterative compression** | Error accumulation across summaries | Survives arbitrarily long sessions |
| **Stdin piping** | Resource overhead for large writes | Avoids MAX_ARG_STRLEN (128KB argv cap) |
| **Lineage resolution** | SQL complexity, orphan sessions | Full audit trail, reversible compression |
| **WAL + NFS fallback** | Code path complexity | Works everywhere |
| **Best-effort telemetry** | Occasional data loss | Never breaks the main tool call |

---

## 7. OpenCode Implications

### Patterns Worth Adopting

**High value, low complexity:**

1. **Frozen memory snapshot** — System prompt gets a snapshot of memory at load
   time. Mid-session writes persist to disk but don't mutate the prompt. Prefix
   cache stays valid. This is ~50 lines of code and eliminates the biggest
   caching pain point.

2. **Small curated + deep searchable** — Keep 2-3KB of curated memory in the
   prompt. Everything else goes through full-text search (SQLite FTS5 or
   equivalent). The curated set is for facts that matter every session; search
   is for "what did we do about X."

3. **Three-layer budget enforcement** — Per-tool, per-result, per-turn. Each
   layer catches what the previous one misses. The per-turn aggregate is
   especially valuable — one large tool result is fine, six medium ones that
   sum to 200K+ chars are not.

4. **Sandbox persistence** — Write oversized results to a temp directory with
   a preview + file path. The model calls read_file selectively. Context cost
   is incurred only for what the model actually reads.

5. **Best-effort sidecars** — Telemetry and metadata writes that never break
   the primary tool call. Log at DEBUG, return silently.

**Medium value, moderate complexity:**

1. **Two-layer curation** — Deterministic auto-transitions (pure rules) for
   common cases + LLM review for consolidation decisions. Don't pay for
   summarization when rule-based suffices.

2. **Provenance-driven eligibility** — Three tiers (bundled / hub-installed /
   agent-created) with multiple enforcement layers. Safety-critical when
   automated maintenance touches user content.

3. **Archive-not-delete posture** — Maximum destructive action is moving to
   `.archive/`. Full backup before mutations. Creates psychological safety
   for automated systems.

**Nice-to-have, higher complexity:**

1. **Bookended session search** — SQL-level window queries that give the model
   "goal → match → resolution" context without LLM calls. Requires FTS5 or
   equivalent pre-indexed search.

2. **Cron rewrite chaining** — When a consolidation deprecates Skill A, any
    scheduled job referencing A is automatically rewritten. Prevents silent
    breakage of automations.

### Architectural Decisions to Avoid

1. **Token-based memory limits** — Char limits are model-independent and
   simpler. Use char limits for file-backed curated memory.

2. **Single-layer budget enforcement** — Any single threshold will fail for
   either small-but-many or large-and-few tool results. Three layers is the
   tested pattern.

3. **LLM-based session search** — FTS5 is faster, cheaper, and more
   predictable. Reserve LLM calls for consolidation/umbrella-building where
   judgment is needed, not for recall where SQL suffices.

4. **Inline argv embedding for large data** — Always pipe through stdin.
   `MAX_ARG_STRLEN` (128KB on Linux) is a hard ceiling that will be hit.
