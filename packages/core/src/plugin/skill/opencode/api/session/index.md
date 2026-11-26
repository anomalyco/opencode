# session/index

## GET /api/session

Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or cursor.previous to move through the ordered list.

Parameters:
- `limit?: string` Maximum number of sessions to return. Defaults to the newest 50 sessions.
- `order?: "asc" | "desc"` Session order for the first page. Use desc for newest first or asc for oldest first.
- `search?: string` Only sessions whose title contains this text, ignoring case. % and _ act as wildcards.
- `parentID?: string | "null"` Filter by parent session. Use null to return only root sessions.
- `archived?: "true" | "false"` Filter by archive state. Use true to return only archived sessions or false to exclude them. Omit to include both.
- `directory?: string` Only sessions whose directory is exactly this absolute path.
- `project?: string`
- `subpath?: string` With project, only sessions at this path relative to the project directory.
- `cursor?: string` Opaque cursor from a previous page's cursor.next or cursor.previous. It carries that page's filters and order, so other filters are ignored.

Returns: `SessionsResponse`

## POST /api/session

Create a session at the requested location. A parentID creates a linked child session at its parent's location.

Body:
- `id?: string` If a session with this ID already exists, it is returned unchanged, so retries are safe.
- `parentID?: string` Creates a child session at the parent's location. Each time the child finishes running, it sends its last reply to the parent as a `<background-result kind="subagent">` message and wakes the parent, unless the parent has a staged revert.
- `title?: string`
- `agent?: string`
- `model?: Model.Ref`
- `location?: Location.PublicRef` Defaults to the server's working directory. Ignored when parentID is set.
- `metadata?: Record<string, unknown>` Opaque to OpenCode. Child sessions inherit the parent's metadata unless you pass your own.
- `permissions?: Permission.Ruleset` Applied on top of the agent's rules. Child sessions inherit the parent's rules unless you pass your own.

Returns: `{ data: Session.Info }`

## GET /api/session/active

List the sessions whose agent is running right now in this server process. Sessions missing from the result are idle.

Returns: `{ data: Record<string, unknown> }`

## GET /api/session/{sessionID}

Retrieve a session by ID.

Returns: `{ data: Session.Info }`

## PATCH /api/session/{sessionID}

Update mutable session properties.

Body:
- `title?: string`
- `metadata?: Record<string, unknown>`
- `permissions?: Permission.Ruleset`
- `archived?: boolean` Archive the session with true or restore it with false. Repeating the current state is a no-op.

Returns: nothing

## POST /api/session/{sessionID}/fork

Create a child session with this session's history before a message. Omit before to copy the full history.

Body:
- `before?: string`

Returns: `{ data: Session.Info }`

## POST /api/session/{sessionID}/agent

Change the agent the session uses from its next model call on.

Body:
- `agent: string`

Returns: nothing

## POST /api/session/{sessionID}/model

Change the model the session uses from its next model call on.

Body:
- `model: Model.Ref`

Returns: nothing

## POST /api/experimental/session/{sessionID}/wait (experimental)

Wait until the session's agent stops running in this server process. Returns at once when idle.

Returns: nothing

## GET /api/session/{sessionID}/diff

Structured per-file diffs of the files a turn changed. A turn runs from the first prompt after the session was last idle until its next idle marker, so prompts steered in while it was busy belong to the same turn; `to` extends the range through a later turn. Compares the range's first recorded snapshot with its last; a step still running in the active session compares against the working copy. Ranges that span a location change are rejected. In sessions without any idle marker, a prompt's turn spans until the next user message.

Parameters:
- `from?: string` User message whose turn to diff. Defaults to the turn of the newest user message.
- `to?: string` Later user message whose turn ends the range. Defaults to the turn of `from` alone.
- `context?: string` Unchanged lines around each hunk. Omit for full-file patches.

Returns: `{ data: FileDiff.Info[] }`

## POST /api/session/{sessionID}/generate

Generate transient text from the current session context without mutating session history. Its tokens and cost count toward the session's totals.

Body:
- `prompt: string`

Returns: `SessionGenerateResponse`

## POST /api/session/{sessionID}/interrupt

Stop the session's agent if it is running in this server process; interrupted=false means nothing was running. With resume=true it continues with pending steer items, compaction and moves, while queued messages keep waiting.

Parameters:
- `resume?: "true" | "false"` Set to true to resume pending steering input and next-in-line control items after interrupting.

Returns: `SessionInterruptResponse`

## GET /api/session/{sessionID}/permission

Retrieve pending permission requests owned by a session.

Returns: `{ data: Permission.Request[] }`

## GET /api/session/{sessionID}/permission/{requestID}

Retrieve a pending permission request owned by a session.

Returns: `{ data: Permission.Request }`

## Types

- `FileDiff.Info`: `{ file: string; patch: string; additions: number; deletions: number; status: "added" | "deleted" | "modified"; more?: true }`
- `Location.PublicRef`: `{ directory: string }`
- `Model.Ref`: `{ id: string; providerID: string; variant?: string }`
- `Permission.Request`: `{ id: string; sessionID: string; action: string; resources: string[]; save?: string[]; metadata?: Record<string, unknown>; source?: Permission.Source; message?: string }`
- `Permission.Rule`: `{ action: string; resource: string; effect: "allow" | "deny" | "ask" }`
- `Permission.Ruleset`: `Permission.Rule[]`
- `Permission.Source`: `{ type: "tool"; messageID: string; id: string }`
- `Session.Info`: `{ id, parentID, fork, projectID, agent, model, cost, tokens, outcome, time, title, subpath, metadata, permissions, revert, location }`
- `SessionGenerateResponse`: `{ data: { text, tokens, cost } }`
- `SessionInterruptResponse`: `{ interrupted: boolean }`
- `SessionsResponse`: `{ data: Session.Info[]; cursor: { previous, next } }`
