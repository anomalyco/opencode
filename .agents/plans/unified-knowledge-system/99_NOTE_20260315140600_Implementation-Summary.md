# Implementation Summary: Unified Knowledge System

**Plan Created:** March 15, 2026  
**Status:** Ready for Execution  
**Execution Method:** subagent-driven-development

---

## Overview

This plan integrates learning and memory functionality into OpenCode as a native knowledge system. Instead of external plugins, the system uses OpenCode's builtin SQLite database to store and retrieve three types of knowledge entries:

1. **Patterns** — Proven recovery actions when first attempts fail
2. **Knowledge** — Architectural decisions and big changes
3. **Logs** — Deployment history (what/how/where)

All entries are semantically tagged (no embedding models), automatically written on session idle based on step count, and retrievable via the `knowledge_search` native tool.

---

## Key Design Decisions

### 1. Database: SQLite Only

- Uses OpenCode's builtin SQLite database (Drizzle ORM)
- No external services (MongoDB removed)
- Two tables: `knowledge_entry` and `knowledge_search_index`
- All timestamps in UTC (milliseconds since epoch)

### 2. Semantic Tagging (No Embeddings)

- Canonical tag vocabulary (recovery, network, architecture, etc.)
- Broad categories (architecture, performance, security, testing, deployment)
- Tag weights for relevance (critical: 2.0x, recovery: 1.5x, architecture: 1.2x)
- FTS (full-text search) on tags + title + description

### 3. Native Tool Pattern

- `knowledge_search` tool follows OpenCode's `Tool.define()` pattern
- Registered automatically in ToolRegistry
- Returns markdown with results grouped by type (A+B+C approach)
- Health checks published via `TuiEvent.ToastShow` (no console)

### 4. Automatic Writebacks

- Triggered on session idle (no explicit agent action)
- **REQUIRED: Log written whenever agent performs significant work** (file changes, tool executions)
- Thresholds based on step count:
  - <20 steps: 1 entry (log, if work done)
  - 20-40 steps: 2 entries (log + pattern, if work done)
  - ≥40 steps: 3+ entries (log + pattern + knowledge, if work done)
- Logs capture: what was built, how it was built, where it was built
- Uses extractors to analyze session history and infer methodology

### 5. Silent Skill Injection

- When `knowledge_search` returns results, tags are extracted
- Relevant skills auto-loaded based on tag mapping
- united-governance auto-injected
- Transparent to agent (no explicit requests needed)

### 6. Error Handling

- Fail-fast, fail-loud via TUI toasts
- Health checks on init and every search
- Graceful degradation: if DB unavailable, search returns empty
- No console writes anywhere

---

## File Structure

```
src/knowledge/
├── index.ts                    # Main namespace (write*, search)
├── health.ts                   # Health checks, status
├── search.ts                   # Search logic, semantic scoring
├── knowledge.sql.ts            # Drizzle schema
├── skill-mapper.ts             # Tag -> skill mapping
└── extractors/
    ├── logs.ts                 # Extract deployment logs
    └── patterns.ts             # Extract recovery patterns

src/tool/
└── knowledge_search.ts         # Native tool

src/session/
├── status.ts                   # Modified: onIdle trigger
└── prompt.ts                   # Modified: silent injection

migration/
└── 20260315000000_knowledge_system/
    └── migration.sql           # Schema creation
```

---

## Implementation Tasks

| #   | Task                             | Files                                | Status |
| --- | -------------------------------- | ------------------------------------ | ------ |
| 1   | Database Schema & Migration      | `knowledge.sql.ts`, migration        | Ready  |
| 2   | Knowledge Core System            | `index.ts`, `health.ts`, `search.ts` | Ready  |
| 3   | Knowledge Search Tool            | `knowledge_search.ts`, registry      | Ready  |
| 4   | Session Integration & Writebacks | `status.ts`, extractors              | Ready  |
| 5   | Silent Skill Injection           | `prompt.ts`, `skill-mapper.ts`       | Ready  |

---

## Testing Strategy

### Unit Tests

- Schema generation and migration
- Write operations (pattern, knowledge, log)
- Search with semantic scoring and tag filtering
- Health checks and error handling
- Tool parameter validation and output format
- Skill mapper tag -> skill mapping

### Integration Tests

- Write/read roundtrip for all entry types
- Auto-writeback triggers at correct thresholds
- Silent skill injection with knowledge_search
- Error publishing via TUI toasts

### Manual Verification

- Create test sessions with <20, 20-40, ≥40 steps
- Verify correct number of entries written
- Call `knowledge_search` and verify markdown format
- Verify TUI toast appears on health check failure
- Verify no console output anywhere

---

## API Surface

### Knowledge.writePattern(input)

```typescript
{
  sessionID?: string
  agent: string
  title: string
  description: string
  context: Record<string, any>
  tags: string[]
  confidence: number (0-1)
  firstAttemptFailed: boolean
  attempts: number
}
```

### Knowledge.writeKnowledge(input)

```typescript
{
  sessionID?: string
  agent: string
  title: string
  description: string
  category: string
  impact: "high" | "medium" | "low"
  tags: string[]
  relatedFiles?: string[]
  decisionRationale?: string
}
```

### Knowledge.writeLog(input)

```typescript
{
  sessionID?: string
  agent: string
  build: { what: string, how: string, where: string }
  changes: { filesAdded: number, linesAdded: number, testsAdded?: number }
  tags: string[]
}
```

### Knowledge.search(input)

```typescript
{
  query: string
  type?: "pattern" | "knowledge" | "log" | "all"
  limit?: number (1-20)
  minConfidence?: number (0-1)
}
→ Promise<SearchResult[]>
```

---

## Canonical Tags

**Recovery & Debugging:**

- `recovery`, `retry`, `fallback`, `workaround`

**Domain:**

- `network`, `database`, `api`, `auth`, `storage`

**Architecture:**

- `architecture`, `refactor`, `design-pattern`, `modular`

**Quality:**

- `performance`, `optimization`, `testing`, `coverage`, `security`

**Release:**

- `deployment`, `release`, `feature`, `bugfix`, `breaking-change`

**Process:**

- `documentation`, `process`, `tooling`, `workflow`

---

## Categories (Mutually Exclusive)

- `architecture` — System design, patterns, structure
- `performance` — Speed, efficiency, optimization
- `security` — Auth, encryption, access control
- `testing` — Tests, coverage, QA
- `deployment` — Releases, builds, infrastructure
- `operations` — Monitoring, debugging, troubleshooting
- `documentation` — Docs, examples, guides

---

## Error Handling

All errors are published via `Bus.publish(TuiEvent.ToastShow, ...)`:

```typescript
Bus.publish(TuiEvent.ToastShow, {
  title: "Knowledge System",
  message: "Failed to initialize database",
  variant: "error",
  duration: 10000,
})
```

No console writes anywhere. All logging via `Log.create()`.

---

## Skill Injection Mapping

Tags automatically map to relevant skills:

| Tag                                          | Skill                           |
| -------------------------------------------- | ------------------------------- |
| `recovery`, `retry`, `fallback`              | systematic-debugging            |
| `architecture`, `design-pattern`, `refactor` | opencode-dev-ops, writing-plans |
| `testing`, `coverage`                        | test-driven-development         |
| `performance`, `optimization`                | requesting-code-review          |
| `security`                                   | requesting-code-review          |
| `deployment`, `release`                      | finishing-a-development-branch  |
| `breaking-change`                            | requesting-code-review          |
| `documentation`                              | writing-skills                  |

---

## Development Standards Applied

### From opencode-dev-ops Skill

- ✅ Single-word variable names where possible
- ✅ Namespace pattern for modules (not default exports)
- ✅ Branded types for IDs (SessionID, MessageID)
- ✅ Zod schemas for validation boundaries
- ✅ snake_case for database columns
- ✅ Early returns, no else blocks
- ✅ const over let, immutability
- ✅ Functional array methods

### From tool.ts Pattern

- ✅ `Tool.define()` for tool definition
- ✅ Zod parameters with descriptions
- ✅ Tool.Context for execution context
- ✅ Metadata for truncation handling
- ✅ Async execute function

### From Database Patterns

- ✅ Drizzle ORM with snake_case columns
- ✅ Timestamps using Timestamps helper
- ✅ Foreign key constraints with onDelete
- ✅ Proper indexing strategy
- ✅ Database.use() and Database.transaction()

---

## Acceptance Criteria (All Tasks)

✅ Database schema created and migrated  
✅ All three writeback types working (pattern, knowledge, log)  
✅ **REQUIRED: Log written whenever significant work detected** (file changes, tool executions)  
✅ Logs capture what/how/where with inferred methodology  
✅ Semantic search with tag-based ranking  
✅ `knowledge_search` tool registered and functional  
✅ Auto-writebacks triggered at correct thresholds  
✅ Skills and governance silently injected  
✅ Health checks working, errors via TUI toasts  
✅ No console writes anywhere  
✅ All unit and integration tests passing  
✅ Manual verification complete

---

## Next Steps

1. Execute tasks 1-5 using subagent-driven-development
2. Each task has detailed steps, code snippets, and test commands
3. After all tasks complete:
   - Run full test suite
   - Manual verification of auto-writebacks and skill injection
   - Verify no console output
   - Create final commit

---

## Notes

- **UTC Timestamps:** All times stored as milliseconds since epoch (Date.now())
- **Graceful Degradation:** If knowledge system unavailable, `knowledge_search` returns empty but doesn't crash
- **Silent Injection:** Skills and governance auto-injected with results — agent doesn't explicitly request
- **Explicit Writes:** Agents can also explicitly call `Knowledge.write*()` functions if desired (future enhancement)
- **No External Dependencies:** Uses only SQLite, Drizzle, Zod — no MongoDB, embeddings, or external services
