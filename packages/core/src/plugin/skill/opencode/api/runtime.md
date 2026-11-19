# Runtime, Jobs, Automations & Artifacts

Server info, read-only config, background shells/jobs, automations, artifacts, blobs/media, SSE events, debug, and migration status.

## `GET /api/info`
Get server info. Return the server identity, connection URLs, paths, and readiness status.
- Returns: 200 `ServerInfo`

## `GET /api/event`
Subscribe to events. Subscribe to native events and plugin RPC events across all server locations. Volatile by contract: a slow consumer overflows and fails the stream, and events during disconnection are missed.
- Query: `types?: "location.shutdown" | "models-dev.refreshed" | "credential.updated" | "credential.switched" | "integration.updated" | "provider.updated" | "model.updated" | "agent.updated" | "session.created" | "session.agent.selected" | "session.model.selected" | "session.moved" | "session.renamed" | "session.metadata.updated" | "session.permissions" | "session.viewed" | "session.archived" | "session.unarchived" | "session.usage.updated" | "session.deleted" | "session.forked" | "session.inbox.delivered" | "session.inbox.enqueued" | "session.inbox.cancelled" | "session.inbox.delivery.changed" | "session.execution.started" | "session.execution.succeeded" | "session.execution.failed" | "session.execution.interrupted" | "session.instructions.updated" | "session.synthetic" | "session.skill.activated" | "session.shell.started" | "session.shell.ended" | "session.step.started" | "session.step.first-token" | "session.step.streamed" | "session.step.ended" | "session.step.failed" | "session.text.started" | "session.text.delta" | "session.text.ended" | "session.reasoning.started" | "session.reasoning.delta" | "session.reasoning.ended" | "session.tool.input.started" | "session.tool.input.delta" | "session.tool.input.ended" | "session.tool.called" | "session.tool.progress" | "session.tool.success" | "session.tool.failed" | "session.retry.scheduled" | "session.compaction.started" | "session.compaction.delta" | "session.compaction.ended" | "session.compaction.failed" | "session.revert.staged" | "session.revert.cleared" | "session.revert.committed" | "filesystem.changed" | "reference.updated" | "permission.asked" | "permission.replied" | "plugin.updated" | "project.updated" | "worktree.updated" | "worktree.resolved" | "command.updated" | "config.updated" | "skill.updated" | "pty.created" | "pty.updated" | "pty.exited" | "pty.deleted" | "persistent-pty.added" | "persistent-pty.removed" | "persistent-pty.updated" | "shell.created" | "shell.exited" | "shell.deleted" | "experimental.job.updated" | "form.created" | "form.replied" | "form.cancelled" | "websearch.updated" | "artifact.updated" | "session.status" | "session.idle" | "tui.prompt.append" | "tui.command.execute" | "tui.toast.show" | "tui.session.select" | "installation.updated" | "installation.update-available" | "vcs.branch.updated" | "mcp.status.changed" | "mcp.resources.changed" | "experimental.mcp.event" | string | ("location.shutdown" | "models-dev.refreshed" | "credential.updated" | "credential.switched" | "integration.updated" | "provider.updated" | "model.updated" | "agent.updated" | "session.created" | "session.agent.selected" | "session.model.selected" | "session.moved" | "session.renamed" | "session.metadata.updated" | "session.permissions" | "session.viewed" | "session.archived" | "session.unarchived" | "session.usage.updated" | "session.deleted" | "session.forked" | "session.inbox.delivered" | "session.inbox.enqueued" | "session.inbox.cancelled" | "session.inbox.delivery.changed" | "session.execution.started" | "session.execution.succeeded" | "session.execution.failed" | "session.execution.interrupted" | "session.instructions.updated" | "session.synthetic" | "session.skill.activated" | "session.shell.started" | "session.shell.ended" | "session.step.started" | "session.step.first-token" | "session.step.streamed" | "session.step.ended" | "session.step.failed" | "session.text.started" | "session.text.delta" | "session.text.ended" | "session.reasoning.started" | "session.reasoning.delta" | "session.reasoning.ended" | "session.tool.input.started" | "session.tool.input.delta" | "session.tool.input.ended" | "session.tool.called" | "session.tool.progress" | "session.tool.success" | "session.tool.failed" | "session.retry.scheduled" | "session.compaction.started" | "session.compaction.delta" | "session.compaction.ended" | "session.compaction.failed" | "session.revert.staged" | "session.revert.cleared" | "session.revert.committed" | "filesystem.changed" | "reference.updated" | "permission.asked" | "permission.replied" | "plugin.updated" | "project.updated" | "worktree.updated" | "worktree.resolved" | "command.updated" | "config.updated" | "skill.updated" | "pty.created" | "pty.updated" | "pty.exited" | "pty.deleted" | "persistent-pty.added" | "persistent-pty.removed" | "persistent-pty.updated" | "shell.created" | "shell.exited" | "shell.deleted" | "experimental.job.updated" | "form.created" | "form.replied" | "form.cancelled" | "websearch.updated" | "artifact.updated" | "session.status" | "session.idle" | "tui.prompt.append" | "tui.command.execute" | "tui.toast.show" | "tui.session.select" | "installation.updated" | "installation.update-available" | "vcs.branch.updated" | "mcp.status.changed" | "mcp.resources.changed" | "experimental.mcp.event" | string)[]`
- Returns: 200 SSE `{ id?: string | null; event: string; data: string }`

## `GET /api/experimental/session/{sessionID}/terminal/read`
Read the session's most recently controlled terminal. Read the last physical rows without changing selection or taking control. Omitted lines uses the live terminal height; larger counts include retained history. Blank rows are preserved. Screen dimensions and cursor remain relative to the live screen. Returns null when no current terminal exists. Selection is server-local and resets on restart. Experimental: may change without compatibility guarantees.
- Query: `lines?: string`
- Returns: 200 `{ data: PersistentPty.ReadResult | null }`

## `GET /api/experimental/session/{sessionID}/terminal`
experimental.persistentPty.list
- Returns: 200 `{ data: PersistentPty.Info[] }`

## `GET /api/experimental/media/{hash}`
Read media blob. Read a content-addressed media blob by SHA-256 hash with immutable Cache-Control, ETag, and 304 Not Modified support. Only blobs a stored message or inbox item still references are served. Experimental: may change without compatibility guarantees.
- Returns: 200 application/octet-stream

## `GET /api/experimental/blob/{id}`
Read a blob. Stream a stored blob's bytes, such as a generated video, with single byte Range, ETag and 304 Not Modified support. Blobs are kept until removed. Experimental: may change without compatibility guarantees.
- Returns: 200 application/octet-stream

## `GET /api/experimental/automation`
List automations. List automations, oldest first. Experimental: needs experimental.automations in the config of the automation's directory and may change without compatibility guarantees.
- Query: `sessionID?: string`, `directory?: string`
- Returns: 200 `{ data: Automation.Info[] }`

## `POST /api/experimental/automation`
Create automation. Create an automation that sends a prompt or runs a Code Mode program at a time, every interval, or on a cron. Creating an MCP event watch requires the automation_create tool in a local session; a session ID over HTTP is not a watch authorization. Experimental: needs experimental.automations in the config of the automation's directory and may change without compatibility guarantees.
- Body: `Automation.CreatePayload`
- Returns: 200 `{ data: Automation.Info }`

## `GET /api/experimental/automation/{automationID}`
Get automation. Read one automation. Experimental: needs experimental.automations in the config of the automation's directory and may change without compatibility guarantees.
- Returns: 200 `{ data: Automation.Info }`

## `DELETE /api/experimental/automation/{automationID}`
Delete automation. Delete an automation. Experimental: needs experimental.automations in the config of the automation's directory and may change without compatibility guarantees.
- Returns: 204 No Content

## `POST /api/experimental/automation/{automationID}/pause`
Pause automation. Stop an automation from running until it is resumed. Experimental: needs experimental.automations in the config of the automation's directory and may change without compatibility guarantees.
- Returns: 200 `{ data: Automation.Info }`

## `POST /api/experimental/automation/{automationID}/resume`
Resume automation. Resume a paused automation. A missed `at` runs once; repeating timers resume at their next slot. Event watches request replay from their saved cursor. Experimental: needs experimental.automations in the config of the automation's directory and may change without compatibility guarantees.
- Returns: 200 `{ data: Automation.Info }`

## `GET /api/experimental/artifacts/providers`
List artifact providers. Return active artifact providers and default. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
- Returns: 200 `{ location: Location.PublicRef; data: Artifact.Provider[] }`

## `GET /api/experimental/artifacts`
List artifacts. List published artifacts, newest update first. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
- Query: `sessionID?: string`, `provider?: string`
- Returns: 200 `{ location: Location.PublicRef; data: Artifact.Info[] }`

## `POST /api/experimental/artifacts`
Create artifact. Publish a new artifact through the selected or default artifact provider. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
- Body: `Artifact.CreateInput`
- Returns: 200 `{ location: Location.PublicRef; data: Artifact.Info }`

## `GET /api/experimental/artifacts/{artifactID}`
Read artifact. Read an artifact's metadata and file contents. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
- Returns: 200 `{ location: Location.PublicRef; data: Artifact.Content }`

## `PATCH /api/experimental/artifacts/{artifactID}`
Update artifact. Replace an artifact's files at the same ID and URL. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
- Body: `Artifact.UpdateInput`
- Returns: 200 `{ location: Location.PublicRef; data: Artifact.Info }`

## `DELETE /api/experimental/artifacts/{artifactID}`
Delete artifact. Remove an artifact and its stored files. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
- Returns: 204 No Content

## `GET /api/experimental/artifacts/{artifactID}/view/*`
View local artifact. Serve HTML and static files from the local provider. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
- Returns: 200 application/octet-stream

## `GET /api/experimental/job`
List background jobs. List active and unconsumed background jobs, optionally filtered by owning session, descendants, or kind. Experimental: may change without compatibility guarantees.
- Query: `sessionID?: string`, `kind?: "shell" | "subagent" | "image" | "video" | "codemode"`, `status?: "running" | "completed" | "error" | "cancelled"`, `descendants?: "true" | "false"`
- Returns: 200 `{ data: Job.Info[] }`

## `POST /api/experimental/job/{id}/cancel`
Cancel background job. Cancel a running background job, interrupting the work it started. Cancelling a job that already finished does nothing. Experimental: may change without compatibility guarantees.
- Returns: 204 No Content

## `GET /api/shell`
List running shell commands. List currently running shell commands for a location. Exited commands are not included.
- Returns: 200 `{ location: Location.PublicRef; data: Shell.Info[] }`

## `GET /api/shell/{id}`
Get shell command. Get one shell command, including its status and exit code once exited.
- Returns: 200 `{ location: Location.PublicRef; data: Shell.Info }`

## `DELETE /api/shell/{id}`
Remove shell command. Terminate and remove one shell command and its retained output.
- Returns: 204 No Content

## `GET /api/shell/{id}/output`
Read shell output. Page through captured combined output by absolute byte cursor.
- Query: `cursor?: string`, `limit?: string`
- Returns: 200 `{ location: Location.PublicRef; data: { output: string; cursor: number; size: number; truncated: boolean } }`

## `POST /api/debug/heap-dump`
Write a heap snapshot. Write a JavaScript heap snapshot of the server process into its log directory, or the requested directory, and return the server-local path once the file is complete. Pauses the server while the heap serializes and can temporarily increase its memory use. The snapshot can contain credentials, prompts, and file contents.
- Query: `directory?: string`
- Returns: 200 `{ path: string; pid: number; memory: { rss: number | "Infinity" | "-Infinity" | "NaN"; heapTotal: number | "Infinity" | "-Infinity" | "NaN"; heapUsed: number | "Infinity" | "-Infinity" | "NaN"; external: number | "Infinity" | "-Infinity" | "NaN"; arrayBuffers: number | "Infinity" | "-Infinity" | "NaN" } }`

## `GET /api/debug/location`
List loaded locations. List locations currently loaded by the server.
- Returns: 200 `Location.PublicRef[]`

## `DELETE /api/debug/location`
Evict a loaded location. Dispose the requested location's cached services so its next use boots them fresh.
- Returns: 204 No Content

## `GET /api/experimental/migration/v1`
Get V1 migration status. Return the progress of the V1 to V2 session history migration.
- Returns: 200 `{ status: "required" | "completed" } | { status: "running"; progress: { label: string; numerator?: number | null; denominator?: number | null } } | { status: "error"; error: string }`

## `GET /api/config`
Get configuration. Return configuration documents and discovery sources for the requested location, from lowest to highest priority.
- Returns: 200 `Config.Entry[]`

## `GET /api/config/shell`
List available shells. Return shells available to terminal and agent execution.
- Returns: 200 `ConfigShell.Option[]`

## Types

- `Artifact.Content`: `{ info: Artifact.Info; files: Record<string, string> }`
- `Artifact.CreateInput`: `{ title: string; files: Record<string, string>; entry?: string; provider?: string; sessionID?: string }`
- `Artifact.Info`: `{ id: string; provider: string; sessionID?: string; title: string; entry: string; url: string; time: Artifact.Time }`
- `Artifact.Provider`: `{ id: string; name: string; capabilities: ("static" | "server-code" | "sqlite" | "durable-objects")[]; default: boolean }`
- `Artifact.UpdateInput`: `{ title?: string; files: Record<string, string>; entry?: string; sessionID?: string }`
- `Automation.CreatePayload`: `{ sessionID?: string; directory?: string; name: string; trigger: Automation.Trigger; action: Automation.ActionInput; expires?: string }`
- `Automation.Info`: `{ id: string; name: string; projectID: string; sessionID?: string; directory: string; trigger: Automation.Trigger_1; tz: string; action: Automation.Action; expires?: number; status: "active" | "paused" | "done"; nextDueAt?: number; runCount: number; lastRunAt?: number; lastOutcome?: "fired" | "late" | "skipped" | "disabled" | "failed" | "expired"; lastOutput?: string; state?: unknown; time: { created, updated } }`
- `Config.Entry`: `Config.DocumentEncoded | Config.DirectoryEncoded`
- `ConfigShell.Option`: `{ path: string; name: string; acceptable: boolean }`
- `Job.Info`: `Job.Shell | Job.Subagent | Job.Image | Job.Video | Job.CodeMode`
- `Location.PublicRef`: `{ directory: string }`
- `PersistentPty.Info`: `{ id: string; title: string; command: string; args: string[]; cwd: string; status: "running" | "exited"; pid: number; exitCode?: number; sessionID: string; userTitle: string | null; foregroundProcess: string | null; size: { cols, rows }; output: { head, tail } }`
- `PersistentPty.ReadResult`: `{ ptyID: string; title: string; cwd: string; foregroundProcess: string | null; screen: { text, cols, rows, cursor } }`
- `ServerInfo`: `{ version: string; pid: number; hostname?: string | null; urls: string[]; paths: { tmp }; capabilities?: { persistentPty } | null }`
- `Shell.Info`: `{ id: string; status: "running" | "exited" | "timeout" | "killed"; command: string; cwd: string; shell: string; file: string; pid?: number; exit?: number; signal?: string; metadata: Record<string, unknown>; time: { started, completed } }`
