# Code References — Legion & Session Storage

## Session Identity Computation

### Deterministic Session ID

**File**: `/home/ubuntu/.dotfiles/vendor/legion/.opencode/skills/opencode-api/SKILL.md` (lines 83)

```typescript
// Session IDs are deterministic UUIDs from computeSessionId(legionId, issueId, mode)
// Same inputs always produce the same session ID
// This enables session reuse — re-dispatching with same issue+mode reconnects to existing session
```

**Implementation**: Not found in this repo (likely in daemon or serve codebase)

---

## Session Storage Schema

### SessionTable Definition

**File**: `/home/ubuntu/opencode/db/packages/opencode/src/session/session.sql.ts` (lines 14-47)

```typescript
export const SessionTable = sqliteTable(
  "session",
  {
    id: text().$type<SessionID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id),
    workspace_id: text().$type<WorkspaceID>(),
    parent_id: text().$type<SessionID>(),
    root_session_id: text().$type<SessionID>(), // For session trees
    slug: text().notNull(),
    directory: text().notNull(), // Workspace path
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>(),
    revert: text({ mode: "json" }),
    permission: text({ mode: "json" }).$type<Permission.Ruleset>(),
    origin_machine: text(), // ← FUTURE: Cross-machine support
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_workspace_idx").on(table.workspace_id),
    index("session_parent_idx").on(table.parent_id),
    index("session_root_session_idx").on(table.root_session_id),
  ],
)
```

### Key Fields for Cross-Machine Support

1. **`origin_machine`** (line 36)
   - Currently unused
   - Intended to track which machine created the session
   - Set in `Session.fromRow()` and `Session.toRow()`

2. **`root_session_id`** (line 24)
   - Tracks session hierarchy
   - Used for session trees (parent-child relationships)
   - Indexed for fast lookup

3. **`workspace_id`** (line 22)
   - Links to control-plane workspace
   - Optional, for workspace-scoped sessions

---

## Session Type Definitions

### Session.Info Type

**File**: `/home/ubuntu/opencode/db/packages/opencode/src/session/index.ts` (lines 58-91)

```typescript
export function fromRow(row: SessionRow): Info {
  const summary =
    row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
      ? {
          additions: row.summary_additions ?? 0,
          deletions: row.summary_deletions ?? 0,
          files: row.summary_files ?? 0,
          diffs: row.summary_diffs ?? undefined,
        }
      : undefined
  const share = row.share_url ? { url: row.share_url } : undefined
  const revert = row.revert ?? undefined
  return {
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    parentID: row.parent_id ?? undefined,
    title: row.title,
    version: row.version,
    summary,
    share,
    revert,
    permission: row.permission ?? undefined,
    originMachine: row.origin_machine ?? undefined, // ← Cross-machine field
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  }
}
```

### Session.Info Zod Schema

**File**: `/home/ubuntu/opencode/db/packages/opencode/src/session/index.ts` (lines 150-165)

```typescript
export const Info = Schema.Class({
  id: SessionID,
  slug: Slug,
  projectID: ProjectID,
  workspaceID: WorkspaceID.optional(),
  directory: Schema.String,
  parentID: SessionID.optional(),
  title: Schema.String,
  version: Schema.String,
  summary: Summary.optional(),
  share: Share.optional(),
  revert: Revert.optional(),
  permission: Permission.Ruleset.optional(),
  originMachine: Schema.String.optional(), // ← Cross-machine field
  time: Time,
})
```

---

## Session HTTP Routes

### Session List Endpoint

**File**: `/home/ubuntu/opencode/db/packages/opencode/src/server/routes/session.ts` (lines 28-75)

```typescript
export const SessionRoutes = lazy(() =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "List sessions",
      description: "Get a list of all OpenCode sessions, sorted by most recently updated.",
      operationId: "session.list",
    }),
    validator(
      "query",
      z.object({
        directory: z.string().optional(),
        roots: z.coerce.boolean().optional(),
        start: z.coerce.number().optional(),
        search: z.string().optional(),
        limit: z.coerce.number().optional(),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query")
      const sessions: Session.Info[] = []
      for await (const session of Session.list({
        directory: query.directory,
        roots: query.roots,
        start: query.start,
        search: query.search,
        limit: query.limit,
      })) {
        sessions.push(session)
      }
      return c.json(sessions)
    },
  ),
)
```

---

## Event Sourcing & Sync System

### SyncEvent Definition

**File**: `/home/ubuntu/opencode/db/packages/opencode/src/sync/index.ts` (lines 14-24)

```typescript
export namespace SyncEvent {
  export type Definition = {
    type: string
    version: number
    aggregate: string // e.g., "sessionID"
    schema: z.ZodObject

    // For backwards compatibility with bus events
    properties: z.ZodObject
  }

  export type Event<Def extends Definition = Definition> = {
    id: string
    seq: number // Sequence number for total ordering
    aggregateID: string
    data: z.infer<Def["schema"]>
  }
}
```

### Origin Machine Tracking

**File**: `/home/ubuntu/opencode/db/packages/opencode/src/sync/index.ts` (line 38)

```typescript
const origin = { machine: os.hostname(), pid: node.pid }
```

This captures the **origin of the event** (which machine generated it), but is **not yet integrated** into the session storage layer.

### Event Sequence Table

**File**: `/home/ubuntu/opencode/db/packages/opencode/src/sync/event.sql.ts`

```typescript
// Tracks sequence numbers per aggregate (e.g., per sessionID)
// Enables total ordering without distributed clocks
export const EventSequenceTable = sqliteTable("event_sequence", {
  aggregate_id: text().notNull(),
  seq: integer().notNull(),
  // ...
})
```

---

## Legion Controller Integration

### Session Versioning (Escape Hatch Only)

**File**: `/home/ubuntu/.dotfiles/vendor/legion/.opencode/skills/legion-controller/SKILL.md` (lines 399-437)

````markdown
### Session Versioning (Escape Hatch Only)

Session IDs are **deterministic** — `computeSessionId(teamId, issueId, mode)` uses UUID v5.
Same inputs always produce the same session ID. If the serve still has that session in
memory, re-dispatching with the same issue ID and mode re-attaches to the existing session
(the serve returns 409 DuplicateIDError, which the daemon treats as "reuse").

**This is by design — session reuse preserves the worker's full context.** A worker that has
been reading code, making changes, and iterating on review feedback carries all that context
in its session. Re-dispatching without a version increment reconnects to that session, so
the worker continues where it left off.

The `--version` flag on `legion dispatch` exists **only as an escape hatch** for unrecoverable
sessions — e.g., the session is corrupted, the serve crashed and lost the session, or the
workspace was deleted and recreated. **Do NOT increment versions during normal pipeline
operation.** Each version increment creates a completely fresh session that has zero context
about the issue, the codebase changes, or prior work.

**NEVER do this:**

```bash
# WRONG: Incrementing version on every dispatch throws away all worker context
legion dispatch issue-123 implement --version 1 --prompt "Fix review feedback"
# Later...
legion dispatch issue-123 implement --version 2 --prompt "Fix CI"
```
````

**Do this instead:**

```bash
# CORRECT: Same version (or no version) = worker resumes with full context
legion dispatch issue-123 implement --prompt "Fix review feedback"
# Later...
legion dispatch issue-123 implement --prompt "Fix CI"  # Same session, worker remembers everything
```

````

---

## Daemon API Reference

### Create Session
**File**: `/home/ubuntu/.dotfiles/vendor/legion/.opencode/skills/opencode-api/reference.md` (lines 58-77)

```bash
curl -s -X POST "http://127.0.0.1:13381/session?directory=$WORKSPACE" \
  -H 'Content-Type: application/json' \
  -d '{"id": "ses_deterministic_id"}'

# Returns:
# - 200: {"id": "ses_...", "title": "", ...}
# - 409: DuplicateIDError (safe to reuse existing session)
````

### Send Prompt (Async)

**File**: `/home/ubuntu/.dotfiles/vendor/legion/.opencode/skills/opencode-api/reference.md` (lines 259-265)

```bash
curl -s -X POST "http://127.0.0.1:13381/session/$SESSION_ID/prompt_async?directory=$WORKSPACE" \
  -H 'Content-Type: application/json' \
  -d '{"parts": [{"type": "text", "text": "Your prompt here"}]}'

# Returns 204 immediately (fire-and-forget)
# Session processes prompt when current turn completes
```

### Check Session Status

**File**: `/home/ubuntu/.dotfiles/vendor/legion/.opencode/skills/opencode-api/reference.md` (lines 79-90)

```bash
curl -s "http://127.0.0.1:13381/session/status?directory=$WORKSPACE"

# Returns:
# {
#   "ses_abc": {"type": "idle"},
#   "ses_def": {"type": "busy"},
#   "ses_ghi": {"type": "retry", "attempt": 2, "message": "...", "next": timestamp}
# }
```

---

## Cross-Machine Coordination (Not Yet Implemented)

### What Would Be Needed

1. **Session Registry** (NATS KV or similar)

   ```
   Key: "session:{sessionID}"
   Value: { machine: "hostname", port: 13381, workspace: "/path" }
   ```

2. **Routing Layer** (Envoy)

   ```
   Controller → Envoy → Lookup session registry → Route to correct machine
   ```

3. **Session Migration**
   ```
   Machine A dies → Envoy detects → Migrate session to Machine B → Resume worker
   ```

### Current Placeholders

- **`origin_machine` field** in SessionTable (unused)
- **Event sourcing** (SyncEvent) enables replay on other machines
- **Deterministic session IDs** enable global session identity

---

## Summary

| Aspect                 | Status             | Location                                                                   |
| ---------------------- | ------------------ | -------------------------------------------------------------------------- |
| Legion Controller      | ✅ Implemented     | `/home/ubuntu/.dotfiles/vendor/legion/.opencode/skills/legion-controller/` |
| Session Storage        | ✅ Implemented     | `/home/ubuntu/opencode/db/packages/opencode/src/session/`                  |
| Event Sourcing         | ✅ Implemented     | `/home/ubuntu/opencode/db/packages/opencode/src/sync/`                     |
| Cross-Machine Registry | ❌ Not Found       | —                                                                          |
| Envoy Coordination     | ❌ Not Found       | —                                                                          |
| NATS KV Integration    | ❌ Not Found       | —                                                                          |
| Session Sharding       | ❌ Not Implemented | —                                                                          |

**Key Insight**: Session identity is **deterministic and global**, but **routing** across machines is not yet implemented. The infrastructure (event sourcing, origin_machine field) is ready for cross-machine support, but the **session registry and routing layer** (Envoy) are missing.
