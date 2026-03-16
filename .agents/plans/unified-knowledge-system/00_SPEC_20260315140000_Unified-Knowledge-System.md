# Unified Knowledge System - Specification

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assimilate learning and memory plugins into OpenCode as a native knowledge system with semantic tagging, automatic writebacks, and intelligent retrieval integrated into the agent workflow.

**Architecture:**

- Native SQLite integration using OpenCode's builtin database (Drizzle ORM)
- Three writeback types: Patterns (recovery from failures), Knowledge (architectural decisions), Logs (deployment history)
- `knowledge_search` tool as native OpenCode tool (like `read`, `skill`, `bash`)
- Semantic tagging (no embeddings) with canonical tag vocabulary and broad categories
- Automatic writebacks triggered on session idle: minimum 1 entry per 20 steps (1 entry <20 steps, 2 entries <40 steps, 3+ entries ≥40 steps)
- Silent injection of skills and united-governance with search results
- Fail-fast, fail-loud error handling via TUI toasts (no console writes)

**Tech Stack:**

- SQLite (builtin) + Drizzle ORM
- Zod for schema validation
- Native OpenCode tool pattern
- Bus/Event system for error publishing

**Plan Location:** `.agents/plans/unified-knowledge-system/`

---

## High-Level Design

### 1. Database Schema (Drizzle)

- `KnowledgeEntryTable` — Core entries (patterns, knowledge, logs)
- `KnowledgeSearchIndexTable` — FTS index for semantic search
- Timestamps in UTC (milliseconds since epoch)
- Relationships: optional reference to SessionTable

### 2. Native Tool: `knowledge_search`

- Replaces external learning plugins
- Parameters: query, type (pattern|knowledge|log|all), limit, min_confidence
- Returns markdown with results grouped by type (A+B+C approach)
- Silent injection of skills + united-governance in session/prompt.ts

### 3. Writeback System

- `writePattern()` — Recovery patterns (first_attempt_failed, attempts, context, tags, confidence)
- `writeKnowledge()` — Architectural decisions (category, impact, related_files, decision_rationale)
- `writeLog()` — Deployment logs (what/how/where, changes metrics, tags)
- All UTC-stamped, semantically tagged, with optional fields for flexibility

### 4. Semantic Tagging

- **Canonical Tags:** Predefined vocabulary (recovery, network, architecture, performance, testing, etc.)
- **Categories:** Broad scopes (architecture, performance, security, testing, deployment) — no overlap
- **Tag Weights:** Critical tags 2.0x, recovery 1.5x, architecture 1.2x, etc.
- **Semantic Search:** FTS on tags + title + description, sorted by tag relevance × confidence

### 5. Automatic Writebacks

- Triggered on session idle (no explicit agent action required)
- **Logs are REQUIRED whenever agent performs significant work** (tool execution, code changes, file modifications)
- Log thresholds based on session step count:
  - <20 steps: Write 1 log entry (captures what was built)
  - 20-40 steps: Write 2 entries (log + pattern if applicable)
  - ≥40 steps: Write 3+ entries (log + pattern + knowledge if applicable)
- Uses heuristics to auto-extract patterns/knowledge from session history
- Graceful handling if extraction fails (log error, continue)

### 6. Health & Error Handling

- MongoDB removed entirely — use SQLite only
- Health checks on init: verify database tables exist
- Errors published via `Bus.publish(TuiEvent.ToastShow, ...)`
- No console writes anywhere
- Graceful degradation: if DB unavailable, knowledge_search returns empty results
- Status indicator in TUI window shows knowledge system health

---

## File Structure

### Core Knowledge System

```
src/knowledge/
├── index.ts                    # Main Knowledge namespace (writePattern, writeKnowledge, writeLog, search)
├── knowledge.sql.ts            # Drizzle schema (KnowledgeEntryTable, KnowledgeSearchIndexTable)
├── search.ts                   # Search logic (semantic tagging, FTS, ranking)
├── health.ts                   # Health checks, error handling, status
└── extractors/
    ├── patterns.ts             # Extract patterns from session history
    ├── knowledge.ts            # Extract knowledge/decisions
    └── logs.ts                 # Extract deployment logs
```

### Tool Integration

```
src/tool/
├── knowledge_search.ts         # Native tool (follows Tool.define pattern)
└── registry.ts                 # (already exists, no changes needed)
```

### Session Integration

```
src/session/
├── status.ts                   # (modify) Add onIdle trigger for auto-writebacks
└── prompt.ts                   # (modify) Add silent injection of skills + governance
```

### Database Migration

```
migration/
└── 20260315000000_knowledge_system/
    └── migration.sql           # Create KnowledgeEntryTable, KnowledgeSearchIndexTable
```

---

## Data Models

### KnowledgeEntry

```typescript
{
  id: string (ulid)
  type: "pattern" | "knowledge" | "log"
  sessionID?: string
  agent: string (implementer, shade, oracle, etc.)
  title: string
  description: string
  tags: string[] (canonical vocabulary)
  tagWeights?: Record<string, number>
  category?: string (architecture, performance, security, testing, deployment)
  confidence: number (0-100)
  content: {
    // Type-specific fields
    // Pattern: { context, attempts, firstAttemptFailed }
    // Knowledge: { decisionRationale, impact, relatedFiles }
    // Log: { what, how, where, changes }
  }
  firstAttemptFailed?: boolean
  impact?: "high" | "medium" | "low"
  relatedFiles?: string[]
  timeCreated: number (UTC milliseconds)
  timeUpdated: number (UTC milliseconds)
}
```

### SearchResult

```typescript
{
  // All KnowledgeEntry fields plus:
  semanticScore: number (0-1, tag relevance)
  tagRelevance: number (weighted multiplier)
  confidenceScore: number (0-1)
}
```

---

## Canonical Tag Vocabulary

**Predefined tags (user can add custom tags, but these are recommended):**

- Recovery: `recovery`, `retry`, `fallback`, `workaround`
- Domain: `network`, `database`, `api`, `auth`, `storage`
- Architecture: `architecture`, `refactor`, `design-pattern`, `modular`
- Quality: `performance`, `optimization`, `testing`, `coverage`, `security`
- Release: `deployment`, `release`, `feature`, `bugfix`, `breaking-change`
- Process: `documentation`, `process`, `tooling`, `workflow`

**Categories (mutually exclusive, broad scopes):**

- `architecture` — System design, patterns, structure
- `performance` — Speed, efficiency, optimization
- `security` — Auth, encryption, access control
- `testing` — Tests, coverage, QA
- `deployment` — Releases, builds, infrastructure
- `operations` — Monitoring, debugging, troubleshooting
- `documentation` — Docs, examples, guides

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
→ Promise<string> (entry ID)
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
→ Promise<string> (entry ID)
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
→ Promise<string> (entry ID)
```

### Knowledge.search(input)

```typescript
{
  query: string
  type?: "pattern" | "knowledge" | "log" | "all"
  limit?: number (default 5, max 20)
  minConfidence?: number (default 0.6, 0-1)
}
→ Promise<SearchResult[]>
```

### KnowledgeHealth.init()

```typescript
→ Promise<void>
// Verifies database tables exist, publishes toast on error
```

### KnowledgeHealth.isHealthy()

```typescript
→ boolean
```

### KnowledgeHealth.getStatus()

```typescript
→ { healthy: boolean, error?: string }
```

---

## Integration Points

### 1. Tool Registry

- `knowledge_search.ts` automatically picked up by `ToolRegistry.all()`
- No changes needed to registry.ts

### 2. Session Status

- `SessionStatus.onIdle()` called when session becomes idle
- Triggers auto-writebacks based on step count
- Extractors analyze session history to find patterns/knowledge

### 3. Session Prompt

- After `knowledge_search` tool execution, auto-inject:
  - Relevant skills (based on result tags)
  - united-governance context
- Done transparently to agent

### 4. Error Publishing

- `Bus.publish(TuiEvent.ToastShow, ...)` for all errors
- No `console.log`, `console.error`, or logging to stdout

---

## Testing Strategy

### Unit Tests

- `src/knowledge/search.test.ts` — Semantic search, tag matching, ranking
- `src/knowledge/health.test.ts` — Health checks, error handling
- `src/tool/knowledge_search.test.ts` — Tool parameter validation, output format

### Integration Tests

- `src/knowledge/index.test.ts` — Write/read roundtrip for all three types
- `src/session/status.test.ts` — Auto-writeback triggers at correct thresholds

### Manual Verification

- Create test session with <20 steps → verify 1 entry written
- Create test session with 25 steps → verify 2 entries written
- Call `knowledge_search` → verify markdown output format
- Verify TUI toast appears on health check failure
- Verify no console output anywhere

---

## Acceptance Criteria

✅ Database schema created and migrated  
✅ `knowledge_search` tool implemented and registered  
✅ All three writeback functions (pattern, knowledge, log) working  
✅ Semantic search with tag-based ranking implemented  
✅ Auto-writebacks triggered on session idle at correct thresholds  
✅ Skills + governance silently injected with search results  
✅ Health checks working, errors published via TUI toasts  
✅ No console writes anywhere in the system  
✅ All tests passing (unit + integration)  
✅ Manual verification complete

---

## Notes

- **UTC Timestamps:** All times stored as milliseconds since epoch (Date.now())
- **Semantic Tags:** No embedding models. Pure tag-based relevance with configurable weights.
- **Graceful Degradation:** If knowledge system unavailable, `knowledge_search` returns empty results but doesn't crash.
- **Silent Injection:** Skills and governance auto-injected with results — agent doesn't explicitly request them.
- **No External Dependencies:** Uses only SQLite (builtin), Drizzle, Zod. No MongoDB, no embedding services.
- **Explicit Agent Actions:** Agents can explicitly call `Knowledge.writePattern()`, etc. via tool calls if desired (future enhancement).
