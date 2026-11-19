# Sessions, Messages & Forms

Create, list, prompt, wait, interrupt, fork, revert, and inspect sessions, messages, inbox, and pending forms/permissions.

## `GET /api/session`
List sessions. Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or cursor.previous to move through the ordered list.
- Query: `limit?: string`, `order?: "asc" | "desc"`, `search?: string`, `parentID?: string | "null"`, `archived?: "true" | "false"`, `directory?: string`, `project?: string`, `subpath?: string`, `cursor?: string`
- Returns: 200 `SessionsResponse`

## `POST /api/session`
Create session. Create a session at the requested location. A parentID creates a linked child session at its parent's location.
- Body: `{ id?: string | null; parentID?: string | null; title?: string | null; agent?: string | null; model?: Model.Ref | null; location?: Location.PublicRef | null; metadata?: Session.Metadata | null; permissions?: Permission.Ruleset | null }`
- Returns: 200 `{ data: Session.Info }`

## `GET /api/experimental/session/stats`
Get session statistics. Aggregate local session activity, usage, and tool reliability for a time range.
- Query: `from?: string`, `to?: string`, `project?: string`, `timezone?: string`, `tools?: "none" | "summary" | "detail"`
- Returns: 200 `{ data: SessionStats.Info }`

## `POST /api/experimental/session/import`
Import session. Import a projected session transcript at the requested location. Accepts transcripts exported by earlier releases. If parentID is supplied, the parent session must already exist; import parents before children.
- Body: `{ info: Session.Info; messages: unknown[]; location?: Location.PublicRef | null }`
- Returns: 200 `{ data: Session.Info }`

## `GET /api/experimental/session/{sessionID}/export`
Export session. Export a complete projected session transcript.
- Query: `sanitize?: "true" | "false"`
- Returns: 200 `{ data: SessionTransfer.Data }`

## `GET /api/session/active`
List active sessions. Retrieve foreground Session drains currently owned by this OpenCode process. Sessions absent from the result are inactive.
- Returns: 200 `{ data: Record<string, unknown> }`

## `GET /api/session/{sessionID}`
Get session. Retrieve a session by ID.
- Returns: 200 `{ data: Session.Info }`

## `PATCH /api/session/{sessionID}`
Update session. Update mutable session properties.
- Body: `{ title?: string | null; metadata?: Session.Metadata | null; permissions?: Permission.Ruleset | null; archived?: boolean | null }`
- Returns: 204 No Content

## `DELETE /api/session/{sessionID}`
Delete session. Delete a session and its child sessions.
- Returns: 204 No Content

## `POST /api/session/{sessionID}/fork`
Fork session. Create a child session by copying projected history before a message. Omit before to copy the full history.
- Body: `{ before?: string | null }`
- Returns: 200 `{ data: Session.Info }`

## `POST /api/session/{sessionID}/agent`
Switch session agent. Switch the agent used by subsequent provider turns.
- Body: `{ agent: string }`
- Returns: 204 No Content

## `POST /api/session/{sessionID}/model`
Switch session model. Switch the model used by subsequent provider turns.
- Body: `{ model: Model.Ref }`
- Returns: 204 No Content

## `POST /api/session/{sessionID}/move`
Move session. Move a session to another project directory at the requested delivery boundary.
- Body: `{ directory: string; delivery?: "steer" | "queue" | null }`
- Returns: 204 No Content

## `POST /api/session/{sessionID}/prompt`
Send message. Durably admit one session input and schedule agent-loop execution unless resume is false.
- Body: `{ id?: string | null; text: string; files?: PromptInput.FileAttachment[]; agents?: Prompt.AgentAttachment[]; skills?: PromptInput.SkillAttachment[]; metadata?: Record<string, unknown>; delivery?: "steer" | "queue" | null; resume?: boolean | null }`
- Returns: 200 `{ data: Session.Inbox.User }`

## `POST /api/session/{sessionID}/command`
Run command. Execute a slash command callback immediately.
- Body: `{ name: string; text: string; files?: PromptInput.FileAttachment[]; agents?: Prompt.AgentAttachment[]; skills?: PromptInput.SkillAttachment[]; delivery?: "steer" | "queue" | null }`
- Returns: 204 No Content

## `POST /api/experimental/session/{sessionID}/skill`
Activate skill. Activate a skill for a session by appending a skill message and resuming execution.
- Body: `{ id: string; resume?: boolean | null }`
- Returns: 204 No Content

## `POST /api/session/{sessionID}/synthetic`
Add synthetic message. Durably admit synthetic session input and schedule execution unless resume is false.
- Body: `{ id?: string | null; text: string; description?: string | null; metadata?: Record<string, unknown>; delivery?: "steer" | "queue" | null; resume?: boolean | null }`
- Returns: 200 `{ data: Session.Inbox.Synthetic }`

## `POST /api/session/{sessionID}/shell`
Run shell command. Execute one shell command in the session's working directory. Emits a shell.started event before execution and a shell.ended event with the merged output after.
- Body: `{ id?: string | null; command: string }`
- Returns: 204 No Content

## `POST /api/session/{sessionID}/compact`
Compact session. Durably admit a session compaction request. Steers by default: it runs at the next step boundary instead of waiting behind queued prompts.
- Body: `{ id?: string | null; delivery?: "steer" | "queue" | null }`
- Returns: 200 `{ data: Session.Inbox.Compaction }`

## `POST /api/experimental/session/{sessionID}/wait`
Wait for session. Wait for a session agent loop to become idle.
- Returns: 204 No Content

## `POST /api/session/{sessionID}/revert/stage`
Stage session revert. Stage or move a reversible session boundary and optionally apply its file changes.
- Body: `{ messageID: string; files?: boolean | null }`
- Returns: 200 `{ data: Session.Revert }`

## `DELETE /api/session/{sessionID}/revert`
Clear staged revert
- Returns: 204 No Content

## `POST /api/session/{sessionID}/revert/commit`
Commit staged revert
- Returns: 204 No Content

## `GET /api/session/{sessionID}/context`
Get session context. Retrieve the active context messages for a session (all messages after the last compaction).
- Returns: 200 `{ data: Session.Message.Info[] }`

## `GET /api/session/{sessionID}/diff`
Diff session turns. Structured per-file diffs of the files a turn changed. A turn runs from the first prompt after the session was last idle until its next idle marker, so prompts steered in while it was busy belong to the same turn; `to` extends the range through a later turn. Compares the range's first recorded snapshot with its last; a step still running in the active session compares against the working copy. Ranges that span a location change are rejected. In sessions without any idle marker, a prompt's turn spans until the next user message.
- Query: `from?: string`, `to?: string`, `context?: string`
- Returns: 200 `{ data: FileDiff.Info[] }`

## `GET /api/session/{sessionID}/inbox`
List session inbox. List durable enqueued session work not yet delivered, ordered by enqueue sequence. Includes user, synthetic, compaction, and move items.
- Returns: 200 `{ data: Session.Inbox.Info[] }`

## `PATCH /api/session/{sessionID}/inbox/{inboxID}`
Update inbox item. Change a pending inbox item's delivery mode. Steering wakes session execution.
- Body: `{ delivery: "steer" | "queue" }`
- Returns: 204 No Content

## `DELETE /api/session/{sessionID}/inbox/{inboxID}`
Cancel inbox input. Cancel an inbox item that has not yet been delivered. Unavailable items are a no-op.
- Returns: 204 No Content

## `GET /api/experimental/session/{sessionID}/instructions/entries`
List instruction entries. List API-managed instruction entries attached to the session.
- Returns: 200 `{ data: InstructionEntry.Info[] }`

## `PUT /api/experimental/session/{sessionID}/instructions/entries/{key}`
Put instruction entry. Attach or replace one durable instruction entry. Changes announce as updates at the next step boundary.
- Body: `{ value: unknown }`
- Returns: 204 No Content

## `DELETE /api/experimental/session/{sessionID}/instructions/entries/{key}`
Remove instruction entry. Remove one instruction entry; the removal is announced to the model at the next step boundary.
- Returns: 204 No Content

## `POST /api/session/{sessionID}/generate`
Generate text from session context. Generate transient text from the current session context without mutating session history. Its tokens and cost count toward the session's totals.
- Body: `{ prompt: string }`
- Returns: 200 `SessionGenerateResponse`

## `GET /api/experimental/session/{sessionID}/log`
Read the session log. Experimental durable session event log. Reads events after an exclusive aggregate sequence and continues with live events when follow=true.
- Query: `after?: string`, `follow?: "true" | "false"`
- Returns: 200 SSE `{ id?: string | null; event: string; data: string }`

## `POST /api/session/{sessionID}/interrupt`
Interrupt session execution. Interrupt active execution owned by this OpenCode process. Returns interrupted=true when an active execution was interrupted and false for the idle no-op. When resume=true, execution resumes pending steering input and next-in-line control items (manual compaction, moves) while queued prompts remain parked.
- Query: `resume?: "true" | "false"`
- Returns: 200 `SessionInterruptResponse`

## `POST /api/session/{sessionID}/background`
Background blocking session tools. Move active foreground backgroundable tools for this session into background observation. Idle requests are a no-op.
- Returns: 204 No Content

## `GET /api/session/{sessionID}/message/{messageID}`
Get session message. Retrieve one projected message owned by the Session.
- Returns: 200 `{ data: Session.Message.Info }`

## `GET /api/session/{sessionID}/form`
List session forms. Retrieve pending forms for a session.
- Returns: 200 `{ data: Form.Info[] }`

## `POST /api/session/{sessionID}/form`
Create session form. Create a form for a session.
- Body: `Form.CreatePayload`
- Returns: 200 `{ data: Form.Info }`

## `GET /api/session/{sessionID}/form/{formID}`
Get session form. Retrieve a form and its current state for a session.
- Returns: 200 `{ data: Form.Detail }`

## `DELETE /api/session/{sessionID}/form/{formID}`
Cancel form. Cancel a pending form, optionally telling the asker why it was not answered.
- Query: `message?: string`
- Returns: 204 No Content

## `POST /api/session/{sessionID}/form/{formID}/reply`
Reply to form. Submit an answer to a pending form.
- Body: `Form.Reply`
- Returns: 204 No Content

## `PUT /api/session/{sessionID}/environment`
Set session environment. Replace the process environment used by local shell commands for this session.
- Body: `{ variables: Record<string, string> }`
- Returns: 204 No Content

## `POST /api/session/{sessionID}/view`
View session. Mark the idle transition observed by the viewer as viewed.
- Body: `{ idle: number }`
- Returns: 204 No Content

## `GET /api/session/{sessionID}/message`
Get session messages. Retrieve projected messages for a session, optionally filtered by type. Items keep the requested order across pages; use cursor.next or cursor.previous to move through the ordered timeline, passing the same type filter on each page.
- Query: `limit?: string`, `order?: "asc" | "desc"`, `cursor?: string`, `type?: "agent-switched" | "model-switched" | "location-switched" | "user" | "synthetic" | "system" | "skill" | "shell" | "assistant" | "compaction" | "idle"`
- Returns: 200 `SessionMessagesResponse`

## `GET /api/form`
List pending forms. Retrieve pending forms for a location.
- Returns: 200 `{ location: Location.PublicRef; data: Form.Info[] }`

## `GET /api/permission/request`
List pending permission requests. Retrieve pending permission requests for a location.
- Returns: 200 `{ location: Location.PublicRef; data: Permission.Request[] }`

## `GET /api/permission/saved`
List saved permissions. Retrieve saved permissions, optionally filtered by project.
- Query: `projectID?: string`
- Returns: 200 `{ data: PermissionSaved.Info[] }`

## `PATCH /api/permission/saved/{id}`
Update saved permission. Change the action or resource of a saved permission. Fails with a conflict when the project already has a saved permission with the same action and resource.
- Body: `{ action?: string | null; resource?: string | null }`
- Returns: 200 `{ data: PermissionSaved.Info }`

## `DELETE /api/permission/saved/{id}`
Remove saved permission. Remove a saved permission by ID.
- Returns: 204 No Content

## `GET /api/session/{sessionID}/permission`
List session permission requests. Retrieve pending permission requests owned by a session.
- Returns: 200 `{ data: Permission.Request[] }`

## `POST /api/session/{sessionID}/permission`
Create permission request. Evaluate and, when approval is required, create a permission request for a session.
- Body: `{ id?: string | null; action: string; resources: string[]; save?: string[]; metadata?: Record<string, unknown>; source?: Permission.Source; agent?: string | null }`
- Returns: 200 `{ data: { id: string; effect: "allow" | "deny" | "ask" } }`

## `GET /api/session/{sessionID}/permission/{requestID}`
Get permission request. Retrieve a pending permission request owned by a session.
- Returns: 200 `{ data: Permission.Request }`

## `POST /api/session/{sessionID}/permission/{requestID}/reply`
Reply to pending permission request. Respond to a pending permission request owned by a session.
- Body: `{ decision: "once" | "always" | "reject"; message?: string | null }`
- Returns: 204 No Content

## Types

- `FileDiff.Info`: `{ file: string; patch: string; additions: number; deletions: number; status: "added" | "deleted" | "modified"; more?: true }`
- `Form.CreatePayload`: `{ id?: string | null; title: string; metadata?: Form.Metadata; fields: Form.Fields }`
- `Form.Detail`: `{ id: string; sessionID: string; title: string; metadata?: Form.Metadata; fields: Form.Fields; state: Form.State }`
- `Form.Info`: `{ id: string; sessionID: string; title: string; metadata?: Form.Metadata; fields: Form.Fields }`
- `Form.Reply`: `{ answer: Form.Answer }`
- `InstructionEntry.Info`: `{ key: string; value: unknown }`
- `Location.PublicRef`: `{ directory: string }`
- `Model.Ref`: `{ id: string; providerID: string; variant?: string }`
- `Permission.Request`: `{ id: string; sessionID: string; action: string; resources: string[]; save?: string[]; metadata?: Record<string, unknown>; source?: Permission.Source; message?: string }`
- `Permission.Ruleset`: `Permission.Rule[]`
- `Permission.Source`: `{ type: "tool"; messageID: string; id: string }`
- `PermissionSaved.Info`: `{ id: string; projectID: string; action: string; resource: string; time: { created, updated } }`
- `Prompt.AgentAttachment`: `{ name: string; mention?: Prompt.Mention }`
- `PromptInput.FileAttachment`: `{ uri: string; source?: Prompt.FileSource; name?: string; description?: string; mention?: Prompt.Mention }`
- `PromptInput.SkillAttachment`: `{ id: string; mention?: Prompt.Mention }`
- `Session.Inbox.Compaction`: `{ id: string; sessionID: string; time: { created }; type: "compaction"; payload: Session.Inbox.CompactionPayload; delivery: "steer" | "queue" }`
- `Session.Inbox.Info`: `Session.Inbox.User | Session.Inbox.Synthetic | Session.Inbox.Compaction | Session.Inbox.Move`
- `Session.Inbox.Synthetic`: `{ id: string; sessionID: string; time: { created }; type: "synthetic"; payload: Session.Inbox.SyntheticPayload; delivery: "steer" | "queue" }`
- `Session.Inbox.User`: `{ id: string; sessionID: string; time: { created }; type: "user"; payload: Session.Inbox.UserPayload; delivery: "steer" | "queue" }`
- `Session.Info`: `{ id: string; parentID?: string; fork?: { sessionID, boundary }; projectID: string; agent?: string; model?: Model.Ref; cost: number; tokens: TokenUsage.Info; outcome?: "succeeded" | "failed" | "interrupted"; time: { created, updated, busy, idle, viewed, archived }; title?: string; subpath?: string; metadata?: Session.Metadata; permissions?: Permission.Ruleset; revert?: Session.Revert; location: Location.PublicRef }`
- `Session.Message.Info`: `Session.Message.AgentSelected | Session.Message.ModelSelected | Session.Message.LocationSwitched | Session.Message.User | Session.Message.Synthetic | Session.Message.System | Session.Message.Skill | Session.Message.Shell | Session.Message.Assistant | Session.Message.Compaction | Session.Message.Idle`
- `Session.Metadata`: `Record<string, unknown>`
- `Session.Revert`: `{ messageID: string; partID?: string; snapshot?: string; files?: FileDiff.Info[] }`
- `SessionGenerateResponse`: `{ data: { text, tokens, cost } }`
- `SessionInterruptResponse`: `{ interrupted: boolean }`
- `SessionMessagesResponse`: `{ data: Session.Message.Info[]; cursor: { previous, next } }`
- `SessionStats.Info`: `{ range: { from, to }; sessions: number; subagents: number; prompts: number; steps: number; tokens: TokenUsage.Info; cost: number; tools: SessionStats.Tools; activeDays: number; streak: number; activity: SessionStats.Activity[]; models: SessionStats.ModelUsage[] }`
- `SessionTransfer.Data`: `{ info: Session.Info; messages: Session.Message.Info[] }`
- `SessionsResponse`: `{ data: Session.Info[]; cursor: { previous, next } }`
