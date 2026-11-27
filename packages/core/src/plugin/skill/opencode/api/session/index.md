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

## Types

- `Location.PublicRef`: `{ directory: string }`
- `Model.Ref`: `{ id: string; providerID: string; variant?: string }`
- `Permission.Rule`: `{ action: string; resource: string; effect: "allow" | "deny" | "ask" }`
- `Permission.Ruleset`: `Permission.Rule[]`
- `Session.Info`: `{ id, parentID, fork, projectID, agent, model, cost, tokens, outcome, time, title, subpath, metadata, permissions, revert, location }`
- `SessionsResponse`: `{ data: Session.Info[]; cursor: { previous, next } }`
