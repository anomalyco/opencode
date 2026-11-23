# session

## GET /api/session

Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or cursor.previous to move through the ordered list.

Parameters:
- `limit?: string` Maximum number of sessions to return. Defaults to the newest 50 sessions.
- `order?: "asc" | "desc"` Session order for the first page. Use desc for newest first or asc for oldest first.
- `search?: string`
- `parentID?: string | "null"` Filter by parent session. Use null to return only root sessions.
- `archived?: "true" | "false"`
- `directory?: string`
- `project?: string`
- `subpath?: string`
- `cursor?: string` Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response.

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

## GET /api/experimental/session/stats (experimental)

Aggregate local session activity, usage, and tool reliability for a time range.

Parameters:
- `from?: string`
- `to?: string`
- `project?: string`
- `timezone?: string`
- `tools?: "none" | "summary" | "detail"`

Returns: `{ data: SessionStats.Info }`

## POST /api/experimental/session/import (experimental)

Import a projected session transcript at the requested location. Accepts transcripts exported by earlier releases. If parentID is supplied, the parent session must already exist; import parents before children.

Body:
- `info: Session.Info`
- `messages: unknown[]`
- `location?: Location.PublicRef`

Returns: `{ data: Session.Info }`

## GET /api/experimental/session/{sessionID}/export (experimental)

Export a complete projected session transcript.

Parameters:
- `sanitize?: "true" | "false"`

Returns: `{ data: SessionTransfer.Data }`

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

## DELETE /api/session/{sessionID}

Delete a session and its child sessions.

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

## POST /api/session/{sessionID}/move

Move a session to another project directory at the requested delivery boundary.

Body:
- `directory: string`
- `delivery?: "steer" | "queue"` steer delivers before the agent's next model call, even mid-work. queue waits until the agent finishes its current work, then delivers one queued item at a time. Sending defaults to steer.

Returns: nothing

## POST /api/session/{sessionID}/prompt

Send a user message and start the agent unless resume is false. Returns once the message is queued, not when the agent finishes: wait with experimental.session.wait or the session.execution.* events, then read the reply with session.message.list.

Body:
- `id?: string` Sending the same ID again returns the original item instead of adding a second one, so retries are safe. Reusing it in another session or for another kind of item fails with 409.
- `text: string`
- `files?: PromptInput.FileAttachment[]`
- `agents?: Prompt.AgentAttachment[]`
- `skills?: PromptInput.SkillAttachment[]`
- `metadata?: Record<string, unknown>` Stored on the message. The model doesn't see it.
- `delivery?: "steer" | "queue"` steer delivers before the agent's next model call, even mid-work. queue waits until the agent finishes its current work, then delivers one queued item at a time. Sending defaults to steer.
- `resume?: boolean` false adds the message to the inbox without starting the agent; it is delivered the next time the session runs.

Returns: `{ data: Session.Inbox.User }`

## POST /api/session/{sessionID}/command

Run a named command in the session. Most commands send a prompt, so like session.prompt this returns before the agent finishes.

Body:
- `name: string`
- `text: string` The command's arguments.
- `files?: PromptInput.FileAttachment[]`
- `agents?: Prompt.AgentAttachment[]`
- `skills?: PromptInput.SkillAttachment[]`
- `delivery?: "steer" | "queue"` steer delivers before the agent's next model call, even mid-work. queue waits until the agent finishes its current work, then delivers one queued item at a time. Sending defaults to steer.

Returns: nothing

## POST /api/experimental/session/{sessionID}/skill (experimental)

Activate a skill for a session by appending a skill message and resuming execution.

Body:
- `id: string`
- `resume?: boolean`

Returns: nothing

## POST /api/session/{sessionID}/synthetic

Add a message the model reads as user input but the user didn't type, such as a notification. Starts the agent unless resume is false or the session has a staged revert.

Body:
- `id?: string` Sending the same ID again returns the original item instead of adding a second one, so retries are safe. Reusing it in another session or for another kind of item fails with 409.
- `text: string`
- `description?: string` Short label shown in the transcript instead of the full text.
- `metadata?: Record<string, unknown>` Stored on the message. The model doesn't see it.
- `delivery?: "steer" | "queue"` steer delivers before the agent's next model call, even mid-work. queue waits until the agent finishes its current work, then delivers one queued item at a time. Sending defaults to steer.
- `resume?: boolean` false adds the message to the inbox without starting the agent; it is delivered the next time the session runs.

Returns: `{ data: Session.Inbox.Synthetic }`

## POST /api/session/{sessionID}/shell

Execute one shell command in the session's working directory. Emits a shell.started event before execution and a shell.ended event with the merged output after.

Body:
- `id?: string`
- `command: string`

Returns: nothing

## POST /api/session/{sessionID}/compact

Queue a summary of the session's history. Steers by default: it runs before the next model call, ahead of queued messages.

Body:
- `id?: string`
- `delivery?: "steer" | "queue"` steer delivers before the agent's next model call, even mid-work. queue waits until the agent finishes its current work, then delivers one queued item at a time. Sending defaults to steer.

Returns: `{ data: Session.Inbox.Compaction }`

## POST /api/experimental/session/{sessionID}/wait (experimental)

Wait until the session's agent stops running in this server process. Returns at once when idle.

Returns: nothing

## POST /api/session/{sessionID}/revert/stage

Stage or move a reversible session boundary and optionally apply its file changes.

Body:
- `messageID: string`
- `files?: boolean`

Returns: `{ data: Session.Revert }`

## DELETE /api/session/{sessionID}/revert

Clear staged revert

Returns: nothing

## POST /api/session/{sessionID}/revert/commit

Commit staged revert

Returns: nothing

## GET /api/session/{sessionID}/context

Retrieve the active context messages for a session (all messages after the last compaction).

Returns: `{ data: Session.Message.Info[] }`

## GET /api/session/{sessionID}/diff

Structured per-file diffs of the files a turn changed. A turn runs from the first prompt after the session was last idle until its next idle marker, so prompts steered in while it was busy belong to the same turn; `to` extends the range through a later turn. Compares the range's first recorded snapshot with its last; a step still running in the active session compares against the working copy. Ranges that span a location change are rejected. In sessions without any idle marker, a prompt's turn spans until the next user message.

Parameters:
- `from?: string` User message whose turn to diff. Defaults to the turn of the newest user message.
- `to?: string` Later user message whose turn ends the range. Defaults to the turn of `from` alone.
- `context?: string` Unchanged lines around each hunk. Omit for full-file patches.

Returns: `{ data: FileDiff.Info[] }`

## GET /api/session/{sessionID}/inbox

List user, synthetic, compaction and move items not yet delivered to the agent, oldest first. Delivered user and synthetic items move to session.message.list.

Returns: `{ data: Session.Inbox.Info[] }`

## PATCH /api/session/{sessionID}/inbox/{inboxID}

Change a pending inbox item's delivery mode. Steering wakes session execution.

Body:
- `delivery: "steer" | "queue"` steer delivers before the agent's next model call, even mid-work. queue waits until the agent finishes its current work, then delivers one queued item at a time. Sending defaults to steer.

Returns: nothing

## DELETE /api/session/{sessionID}/inbox/{inboxID}

Cancel an inbox item that has not yet been delivered. Unavailable items are a no-op.

Returns: nothing

## GET /api/experimental/session/{sessionID}/instructions/entries (experimental)

List API-managed instruction entries attached to the session.

Returns: `{ data: InstructionEntry.Info[] }`

## PUT /api/experimental/session/{sessionID}/instructions/entries/{key} (experimental)

Attach or replace one durable instruction entry. Changes announce as updates at the next step boundary.

Parameters:
- `key: string` Instruction entry key (lowercase alphanumerics plus . _ -)

Body:
- `value: unknown`

Returns: nothing

## DELETE /api/experimental/session/{sessionID}/instructions/entries/{key} (experimental)

Remove one instruction entry; the removal is announced to the model at the next step boundary.

Parameters:
- `key: string` Instruction entry key (lowercase alphanumerics plus . _ -)

Returns: nothing

## POST /api/session/{sessionID}/generate

Generate transient text from the current session context without mutating session history. Its tokens and cost count toward the session's totals.

Body:
- `prompt: string`

Returns: `SessionGenerateResponse`

## GET /api/experimental/session/{sessionID}/log (experimental)

Experimental durable session event log. Reads events after an exclusive aggregate sequence and continues with live events when follow=true.

Parameters:
- `after?: string`
- `follow?: "true" | "false"`

Returns: an event stream

## POST /api/session/{sessionID}/interrupt

Stop the session's agent if it is running in this server process; interrupted=false means nothing was running. With resume=true it continues with pending steer items, compaction and moves, while queued messages keep waiting.

Parameters:
- `resume?: "true" | "false"`

Returns: `SessionInterruptResponse`

## POST /api/session/{sessionID}/background

Move active foreground backgroundable tools for this session into background observation. Idle requests are a no-op.

Returns: nothing

## GET /api/session/{sessionID}/message/{messageID}

Retrieve one message of the session by ID.

Returns: `{ data: Session.Message.Info }`

## GET /api/session/{sessionID}/form

Retrieve pending forms for a session.

Returns: `{ data: Form.Info[] }`

## POST /api/session/{sessionID}/form

Create a form for a session.

Body:
- `id?: string`
- `title: string`
- `metadata?: Record<string, unknown>`
- `fields: Form.Fields`

Returns: `{ data: Form.Info }`

## GET /api/session/{sessionID}/form/{formID}

Retrieve a form and its current state for a session.

Returns: `{ data: Form.Detail }`

## DELETE /api/session/{sessionID}/form/{formID}

Cancel a pending form, optionally telling the asker why it was not answered.

Parameters:
- `message?: string`

Returns: nothing

## POST /api/session/{sessionID}/form/{formID}/reply

Submit an answer to a pending form.

Body:
- `answer: Record<string, Form.Value>`

Returns: nothing

## PUT /api/session/{sessionID}/environment

Replace the process environment used by local shell commands for this session.

Body:
- `variables: Record<string, string>`

Returns: nothing

## POST /api/session/{sessionID}/view

Mark the idle transition observed by the viewer as viewed.

Body:
- `idle: number`

Returns: nothing

## GET /api/session/{sessionID}/message

List a session's messages, optionally filtered by type. Follow cursor.next or cursor.previous with the same type filter. Items still in the inbox aren't included.

Parameters:
- `limit?: string` Maximum number of messages to return. When omitted, the endpoint returns its default page size.
- `order?: "asc" | "desc"` Message order for the first page. Use desc for newest first or asc for oldest first.
- `cursor?: string` Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response. Do not combine with order.
- `type?: "agent-switched" | "model-switched" | "location-switched" | "user" | "synthetic" | "system" | "skill" | "shell" | "assistant" | "compaction" | "idle"` Filter by message type before pagination. When omitted, all message types are returned. Pass the same type when following cursors.

Returns: `SessionMessagesResponse`

## GET /api/session/{sessionID}/permission

Retrieve pending permission requests owned by a session.

Returns: `{ data: Permission.Request[] }`

## POST /api/session/{sessionID}/permission

Evaluate and, when approval is required, create a permission request for a session.

Body:
- `id?: string`
- `action: string`
- `resources: string[]`
- `save?: string[]`
- `metadata?: Record<string, unknown>`
- `source?: Permission.Source`
- `agent?: string`

Returns: `{ data: { id: string; effect: "allow" | "deny" | "ask" } }`

## GET /api/session/{sessionID}/permission/{requestID}

Retrieve a pending permission request owned by a session.

Returns: `{ data: Permission.Request }`

## GET /api/experimental/session/{sessionID}/terminal/read (experimental)

Read the last physical rows without changing selection or taking control. Omitted lines uses the live terminal height; larger counts include retained history. Blank rows are preserved. Screen dimensions and cursor remain relative to the live screen. Returns null when no current terminal exists. Selection is server-local and resets on restart.

Parameters:
- `lines?: string`

Returns: `{ data: PersistentPty.ReadResult }`

## GET /api/experimental/session/{sessionID}/terminal (experimental)

Returns: `{ data: PersistentPty.Info[] }`

## POST /api/experimental/session/{sessionID}/terminal (experimental)

Body:
- `command?: string`
- `args: string[]`
- `cwd?: string`
- `title: string`
- `env: Record<string, string>`
- `size?: { cols: number; rows: number }`

Returns: `{ data: PersistentPty.Info }`

## Types

- `FileDiff.Info`: `{ file: string; patch: string; additions: number; deletions: number; status: "added" | "deleted" | "modified"; more?: true }`
- `Form.BooleanField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "boolean"; default?: boolean }`
- `Form.Detail`: `{ id: string; sessionID: string; title: string; metadata?: Record<string, unknown>; fields: Form.Fields; state: Form.State }`
- `Form.ExternalField`: `{ key: string; type: "external"; url: string; title?: string; description?: string }`
- `Form.Field`: `Form.StringField | Form.NumberField | Form.IntegerField | Form.BooleanField | Form.MultiselectField | Form.ExternalField`
- `Form.Fields`: `Form.Field[]`
- `Form.Info`: `{ id: string; sessionID: string; title: string; metadata?: Record<string, unknown>; fields: Form.Fields }`
- `Form.IntegerField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "integer"; minimum?: number; maximum?: number; default?: number }`
- `Form.MultiselectField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "multiselect"; options: Form.Option[]; minItems?: number; maxItems?: number; custom?: boolean; default?: string[] }`
- `Form.NumberField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "number"; minimum?: number; maximum?: number; default?: number }`
- `Form.Option`: `{ value: string; label: string; description?: string }`
- `Form.State`: `{ status: "pending" } | { status: "answered"; answer: Record<string, Form.Value> } | { status: "cancelled"; message?: string }`
- `Form.StringField`: `{ key, title, description, required, hidden, when, type, format, minLength, maxLength, pattern, placeholder, default, options, custom }`
- `Form.Value`: `string | number | boolean | string[]`
- `Form.When`: `{ key: string; op: "eq" | "neq"; value: string | number | boolean }`
- `InstructionEntry.Info`: `{ key: string; value: unknown }`
- `Location.PublicRef`: `{ directory: string }`
- `Model.Ref`: `{ id: string; providerID: string; variant?: string }`
- `Permission.Request`: `{ id: string; sessionID: string; action: string; resources: string[]; save?: string[]; metadata?: Record<string, unknown>; source?: Permission.Source; message?: string }`
- `Permission.Rule`: `{ action: string; resource: string; effect: "allow" | "deny" | "ask" }`
- `Permission.Ruleset`: `Permission.Rule[]`
- `Permission.Source`: `{ type: "tool"; messageID: string; id: string }`
- `PersistentPty.Info`: `{ id, title, command, args, cwd, status, pid, exitCode, sessionID, userTitle, foregroundProcess, size, output }`
- `PersistentPty.ReadResult`: `{ ptyID: string; title: string; cwd: string; foregroundProcess: string; screen: { text, cols, rows, cursor } }`
- `Prompt.AgentAttachment`: `{ name: string; mention?: Prompt.Mention }` An agent @-mentioned in the prompt, such as @explore, to suggest the model use it. Only the @name in text reaches the model; this records which agent it names and doesn't change the session's own agent.
- `Prompt.FileAttachment`: `{ data: string; mime: string; source: Prompt.FileSource; name?: string; description?: string; mention?: Prompt.Mention }`
- `Prompt.FileSource`: `{ type: "inline" } | { type: "uri"; uri: string }`
- `Prompt.Mention`: `{ start: number; end: number; text: string }`
- `Prompt.SkillAttachment`: `{ id: string; name: string; text?: string; mention?: Prompt.Mention }`
- `PromptInput.FileAttachment`: `{ uri: string; source?: Prompt.FileSource; name?: string; description?: string; mention?: Prompt.Mention }`
- `PromptInput.SkillAttachment`: `{ id: string; mention?: Prompt.Mention }`
- `Session.Inbox.Compaction`: `{ id: string; sessionID: string; time: { created }; type: "compaction"; payload: unknown; delivery: "steer" | "queue" }`
- `Session.Inbox.Info`: `Session.Inbox.User | Session.Inbox.Synthetic | Session.Inbox.Compaction | Session.Inbox.Move`
- `Session.Inbox.Move`: `{ id: string; sessionID: string; time: { created }; type: "move"; delivery: "steer" | "queue"; payload: Session.Inbox.MovePayload }`
- `Session.Inbox.MovePayload`: `{ projectID: string; subpath?: string; location: Location.PublicRef }`
- `Session.Inbox.Synthetic`: `{ id: string; sessionID: string; time: { created }; type: "synthetic"; payload: Session.Inbox.SyntheticPayload; delivery: "steer" | "queue" }`
- `Session.Inbox.SyntheticPayload`: `{ text: string; description?: string; metadata?: Record<string, unknown> }`
- `Session.Inbox.User`: `{ id: string; sessionID: string; time: { created }; type: "user"; payload: Session.Inbox.UserPayload; delivery: "steer" | "queue" }`
- `Session.Inbox.UserPayload`: `{ text: string; files?: Prompt.FileAttachment[]; agents?: Prompt.AgentAttachment[]; skills?: Prompt.SkillAttachment[]; metadata?: Record<string, unknown> }`
- `Session.Info`: `{ id, parentID, fork, projectID, agent, model, cost, tokens, outcome, time, title, subpath, metadata, permissions, revert, location }`
- `Session.Message.AgentSelected`: `{ id: string; metadata?: Record<string, unknown>; time: { created }; type: "agent-switched"; agent: string; previous?: string }`
- `Session.Message.Assistant`: `{ id, metadata, time, type, agent, model, content, snapshot, finish, rawFinish, native, cost, tokens, error, retry }`
- `Session.Message.Compaction`: `Session.Message.Compaction.Running | Session.Message.Compaction.Completed | Session.Message.Compaction.Failed`
- `Session.Message.Compaction.Completed`: `{ type, id, metadata, time, status, reason, model, native, summary, cost, tokens }`
- `Session.Message.Compaction.Failed`: `{ type: "compaction"; id: string; metadata?: Record<string, unknown>; time: { created }; status: "failed"; reason: "auto" | "manual"; error: Session.StructuredError; cost?: number; tokens?: TokenUsage.Info }`
- `Session.Message.Compaction.Running`: `{ type: "compaction"; id: string; metadata?: Record<string, unknown>; time: { created }; status: "running"; reason: "auto" | "manual"; summary: string }`
- `Session.Message.Idle`: `{ id: string; metadata?: Record<string, unknown>; time: { created }; type: "idle"; outcome: "succeeded" | "failed" | "interrupted"; error?: Session.StructuredError }`
- `Session.Message.Info`: `Session.Message.AgentSelected | Session.Message.ModelSelected | Session.Message.LocationSwitched | Session.Message.User | Session.Message.Synthetic | Session.Message.System | Session.Message.Skill | Session.Message.Shell | Session.Message.Assistant | Session.Message.Compaction | Session.Message.Idle`
- `Session.Message.LocationSwitched`: `{ id: string; metadata?: Record<string, unknown>; time: { created }; type: "location-switched"; projectID?: string; subpath?: string; location: Location.PublicRef; previous?: { location, projectID, subpath } }`
- `Session.Message.ModelSelected`: `{ id: string; metadata?: Record<string, unknown>; time: { created }; type: "model-switched"; model: Model.Ref; previous?: Model.Ref }`
- `Session.Message.Shell`: `{ id, metadata, time, type, shellID, command, status, exit, output }`
- `Session.Message.Skill`: `{ id: string; metadata?: Record<string, unknown>; time: { created }; type: "skill"; skill: string; name: string; text: string }`
- `Session.Message.Synthetic`: `{ id: string; metadata?: Record<string, unknown>; time: { created }; text: string; description?: string; type: "synthetic" }`
- `Session.Message.System`: `{ id: string; metadata?: Record<string, unknown>; time: { created }; type: "system"; text: string; description?: string }`
- `Session.Message.User`: `{ id: string; metadata?: Record<string, unknown>; time: { created }; text: string; files?: Prompt.FileAttachment[]; agents?: Prompt.AgentAttachment[]; skills?: Prompt.SkillAttachment[]; type: "user" }`
- `Session.Revert`: `{ messageID: string; partID?: string; snapshot?: string; files?: FileDiff.Info[] }`
- `Session.StructuredError`: `{ type: string; message: string; status?: number; response?: { body }; retryAfterMs?: number }`
- `SessionGenerateResponse`: `{ data: { text, tokens, cost } }`
- `SessionInterruptResponse`: `{ interrupted: boolean }`
- `SessionMessagesResponse`: `{ data: Session.Message.Info[]; cursor: { previous, next } }`
- `SessionsResponse`: `{ data: Session.Info[]; cursor: { previous, next } }`
- `SessionStats.Info`: `{ range, sessions, subagents, prompts, steps, tokens, cost, tools, activeDays, streak, activity, models }`
- `SessionTransfer.Data`: `{ info: Session.Info; messages: Session.Message.Info[] }`
- `TokenUsage.Info`: `{ input: number; output: number; reasoning: number; cache: { read, write } }`
