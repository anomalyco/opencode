# Legion & Envoy Architecture Investigation

## Executive Summary

**Legion** is a distributed worker orchestration system that manages multi-phase issue workflows (plan → implement → test → review → merge). **Envoy** is NOT found in this codebase — it appears to be a planned/external system for cross-machine session coordination via NATS KV.

The session storage layer currently supports **single-machine sessions** with an `origin_machine` field for future cross-machine support. The Postgres sharding work (opencode-postgres-sync) is about **event sourcing and replication**, not session sharding.

---

## Legion Architecture

### Location

- **Skills**: `/home/ubuntu/.dotfiles/vendor/legion/.opencode/skills/`
- **Key Files**:
  - `legion-controller/SKILL.md` — Controller orchestration logic
  - `opencode-api/SKILL.md` — Session API reference
  - `opencode-api/reference.md` — Complete endpoint documentation
  - `legion-worker/SKILL.md` — Worker execution workflows

### Core Concepts

#### 1. **Worker Sessions**

- Each worker is a **persistent OpenCode session** with a deterministic session ID
- Session ID computed as: `computeSessionId(teamId, issueId, mode)` using UUID v5
- **Modes**: `plan`, `implement`, `test`, `review`, `merge`, `retro`
- Same issue + mode = same session ID = **session reuse** (preserves context)

#### 2. **Session Identity Flow**

```
Issue (Linear/GitHub)
  ↓
Controller routes to worker
  ↓
Daemon creates workspace + session
  ↓
Worker session ID = deterministic UUID(teamId, issueId, mode)
  ↓
Session stored in shared OpenCode serve (port 13381)
  ↓
Worker resumes with full context on re-dispatch
```

#### 3. **Daemon API** (Legion's interface to sessions)

- **Port**: `$LEGION_DAEMON_PORT` (default 13370)
- **Key endpoints**:
  - `POST /workers` — Create new worker session
  - `GET /workers` — List all workers
  - `POST /workers/:id/prompt` — Send prompt to worker
  - `POST /state/collect` — State machine decisions
  - `GET /workers/:id/status` — Worker liveness

#### 4. **Shared OpenCode Serve**

- **Port**: 13381 (fixed)
- **Responsibility**: Stores all sessions (controller + all workers)
- **Session storage**: In-memory + SQLite database
- **Key endpoints**:
  - `POST /session` — Create session
  - `POST /session/:id/prompt_async` — Fire-and-forget prompt
  - `GET /session/:id/message` — Read session messages
  - `GET /session/:id/todo` — Read session todos
  - `GET /session/:id/status` — Session busy/idle state

#### 5. **Session Versioning**

- **Default behavior**: Re-dispatch with same issue ID + mode = **reuse existing session**
- **Escape hatch**: `--version` flag creates fresh session (destroys context)
- **Critical rule**: Never increment version during normal pipeline — only for unrecoverable sessions

---

## Session Storage Layer

### Location

- **Schema**: `/home/ubuntu/opencode/db/packages/opencode/src/session/session.sql.ts`
- **Index**: `/home/ubuntu/opencode/db/packages/opencode/src/session/index.ts`
- **Routes**: `/home/ubuntu/opencode/db/packages/opencode/src/server/routes/session.ts`

### Database Schema (SQLite)

```typescript
// SessionTable
{
  id: SessionID (primary key)
  project_id: ProjectID (foreign key)
  workspace_id: WorkspaceID (optional)
  parent_id: SessionID (optional, for forked sessions)
  root_session_id: SessionID (optional, for session trees)
  slug: string
  directory: string (workspace path)
  title: string
  version: string
  share_url: string (optional)
  summary_additions: integer
  summary_deletions: integer
  summary_files: integer
  summary_diffs: JSON (FileDiff[])
  revert: JSON (optional)
  permission: JSON (Permission.Ruleset)
  origin_machine: string (FUTURE: cross-machine support)
  time_created: integer
  time_updated: integer
  time_compacting: integer (optional)
  time_archived: integer (optional)
}

// MessageTable
{
  id: MessageID (primary key)
  session_id: SessionID (foreign key)
  data: JSON (MessageV2.Info)
  time_created: integer
  time_updated: integer
}

// PartTable
{
  id: PartID (primary key)
  message_id: MessageID (foreign key)
  session_id: SessionID (foreign key)
  data: JSON (MessageV2.Part)
  time_created: integer
  time_updated: integer
}

// TodoTable
{
  session_id: SessionID (foreign key)
  content: string
  status: string (pending|in_progress|completed|cancelled)
  priority: string (high|medium|low)
  position: integer
  time_created: integer
  time_updated: integer
}
```

### Key Fields for Cross-Machine Support

1. **`origin_machine`** (line 36 in session.sql.ts)
   - Currently optional, unused
   - Intended for tracking which machine created the session
   - Set in `Session.fromRow()` and `Session.toRow()` (index.ts lines 83, 110)

2. **`root_session_id`** (line 24 in session.sql.ts)
   - Tracks session hierarchy
   - Used for session trees (parent-child relationships)
   - Indexed for fast lookup

3. **`workspace_id`** (line 22 in session.sql.ts)
   - Links to control-plane workspace
   - Optional, for workspace-scoped sessions

---

## Event Sourcing & Sync System

### Location

- **Core**: `/home/ubuntu/opencode/db/packages/opencode/src/sync/`
- **README**: `sync/README.md` (comprehensive design doc)
- **Implementation**: `sync/index.ts`
- **Schema**: `sync/event.sql.ts`

### Purpose

**NOT for session sharding.** This is for **event sourcing and replication**:

- Single writer (one machine controls session)
- Multiple readers (other machines sync via event log)
- Total ordering via sequence IDs (not distributed clocks)
- Backwards compatible with existing `Bus` event system

### Key Concepts

1. **SyncEvent** (event sourcing)
   - Defined with: `type`, `version`, `aggregate` (e.g., sessionID), `schema`
   - Tracked with: `id`, `seq` (sequence number), `aggregateID`, `data`
   - Stored in `EventTable` and `EventSequenceTable`

2. **Projectors**
   - Functions that apply events to database
   - Registered at startup via `SyncEvent.init()`
   - Handle mutations (create, update, delete)

3. **Event Flow**

   ```
   Code calls SyncEvent.run(EventDef, data)
     ↓
   Event stored in EventTable with seq number
     ↓
   Projector applies mutation to database
     ↓
   Event re-published as Bus event (backwards compat)
     ↓
   Clients receive via Bus.subscribe() or WebSocket
   ```

4. **Session Events** (sync-enabled)
   - `session.created`
   - `session.updated`
   - `session.deleted`
   - All tracked with sequence numbers for replay

### Origin Machine Tracking in Sync

In `sync/index.ts` line 38:

```typescript
const origin = { machine: os.hostname(), pid: node.pid }
```

This captures the **origin of the event** (which machine generated it), but is **not yet integrated** into the session storage layer.

---

## Envoy — NOT FOUND

### Search Results

- **No Envoy code** in `/home/ubuntu/opencode/db/packages/opencode/src/`
- **No NATS references** in the codebase
- **No session registry** via NATS KV
- **No cross-machine coordination** currently implemented

### Likely Future Role (Speculation)

Based on Legion controller documentation and the `origin_machine` field, Envoy would likely:

1. Use NATS KV as a **session registry** (machine → session ID → location)
2. Enable **session discovery** across machines
3. Route prompts to the correct machine's session
4. Coordinate **session migration** if a machine goes down

But this is **not yet implemented**.

---

## How Session Identity Flows Through Legion

### 1. **Dispatch (New Worker)**

```
Controller calls: legion dispatch "$ISSUE_ID" "$MODE" --repo "$OWNER/$REPO"
  ↓
Daemon computes: sessionId = computeSessionId(teamId, issueId, mode)
  ↓
Daemon calls: POST /session (OpenCode serve, port 13381)
  ↓
Serve creates session with deterministic ID
  ↓
Daemon creates workspace (jj workspace add)
  ↓
Daemon returns: { sessionId, port, workspace }
  ↓
Worker connects to session on port 13381
```

### 2. **Resume (Existing Worker)**

```
Controller calls: legion prompt "$ISSUE_ID" "Your prompt"
  ↓
Daemon looks up: sessionId = computeSessionId(teamId, issueId, mode)
  ↓
Daemon calls: POST /session/:sessionId/prompt_async (port 13381)
  ↓
Serve finds existing session in memory
  ↓
Prompt queued for next turn
  ↓
Worker processes prompt with full context
```

### 3. **Session Persistence**

```
OpenCode serve (port 13381)
  ├─ In-memory session state (busy/idle, current turn)
  └─ SQLite database (messages, todos, metadata)
      └─ SessionTable.origin_machine (unused, for future)
```

---

## Cross-Machine Interaction (Current State)

### What Exists

1. **`origin_machine` field** in SessionTable — placeholder for future
2. **Event sourcing** (SyncEvent) — enables replay on other machines
3. **Deterministic session IDs** — same issue+mode = same session everywhere

### What's Missing

1. **Session registry** (NATS KV or similar)
2. **Session discovery** across machines
3. **Prompt routing** to correct machine
4. **Session migration** on machine failure
5. **Envoy** (the coordination system)

### Postgres Sharding Work

- **Location**: `/home/ubuntu/opencode/db/packages/opencode-postgres-sync/`
- **Purpose**: Event sourcing + replication, NOT session sharding
- **Status**: Compiled to dist/, src/ is empty (likely generated or external)
- **Interaction**: Provides event log for multi-machine replay

---

## Key Takeaways for Postgres Sharding

### Session Identity

- **Deterministic**: `computeSessionId(teamId, issueId, mode)` → same ID everywhere
- **Scoped**: Per-project (projectID in SessionTable)
- **Versioned**: Optional version increment for fresh sessions

### Storage Interaction

- **Single database** (SQLite) per OpenCode serve instance
- **Shared serve** (port 13381) handles all sessions
- **Daemon** (port 13370) manages workers + state machine
- **No sharding** of sessions by ID — all in one database

### For Cross-Machine Sharding

Would need:

1. **Session registry** (which machine owns which session)
2. **Routing layer** (direct prompts to correct machine)
3. **Replication** (event log for read replicas)
4. **Failover** (session migration on machine death)

---

## File Paths Summary

| Component         | Path                                                                               | Purpose                      |
| ----------------- | ---------------------------------------------------------------------------------- | ---------------------------- |
| Legion Controller | `/home/ubuntu/.dotfiles/vendor/legion/.opencode/skills/legion-controller/SKILL.md` | Orchestration logic          |
| OpenCode API      | `/home/ubuntu/.dotfiles/vendor/legion/.opencode/skills/opencode-api/SKILL.md`      | Session API reference        |
| Session Schema    | `/home/ubuntu/opencode/db/packages/opencode/src/session/session.sql.ts`            | Database schema              |
| Session Index     | `/home/ubuntu/opencode/db/packages/opencode/src/session/index.ts`                  | Session CRUD + types         |
| Session Routes    | `/home/ubuntu/opencode/db/packages/opencode/src/server/routes/session.ts`          | HTTP endpoints               |
| Sync System       | `/home/ubuntu/opencode/db/packages/opencode/src/sync/index.ts`                     | Event sourcing               |
| Sync README       | `/home/ubuntu/opencode/db/packages/opencode/src/sync/README.md`                    | Design documentation         |
| Postgres Sync     | `/home/ubuntu/opencode/db/packages/opencode-postgres-sync/`                        | Event replication (compiled) |

---

## Interfaces & Types

### SessionID

```typescript
// Branded string type
type SessionID = string & { readonly SessionID: unique symbol }

// Creation
SessionID.make(id: string)
SessionID.descending(id?: string)  // For sorting
```

### Session.Info

```typescript
{
  id: SessionID
  slug: string
  projectID: ProjectID
  workspaceID?: WorkspaceID
  directory: string
  parentID?: SessionID
  title: string
  version: string
  summary?: { additions, deletions, files, diffs }
  share?: { url }
  revert?: { messageID, partID, snapshot, diff }
  permission?: Permission.Ruleset
  originMachine?: string  // FUTURE: cross-machine
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
}
```

### SyncEvent.Definition

```typescript
{
  type: string // e.g., "session.created"
  version: number // e.g., 1
  aggregate: string // e.g., "sessionID"
  schema: ZodObject // Data shape
  properties: ZodObject // Bus event shape (for compat)
}
```

---

## Conclusion

**Legion** is fully implemented and operational. **Envoy** does not exist in this codebase yet. The session storage layer is **single-machine** with placeholders for cross-machine support (`origin_machine` field). The **event sourcing system** (SyncEvent) provides the foundation for multi-machine replication, but **session discovery and routing** across machines is not yet implemented.

For Postgres sharding work, the key insight is: **sessions are not sharded by ID**. All sessions live in one SQLite database per OpenCode serve instance. Cross-machine coordination would require a **session registry** (NATS KV or similar) and **routing layer** (Envoy), which are planned but not yet built.
