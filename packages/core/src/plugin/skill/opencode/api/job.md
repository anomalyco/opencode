# job

## GET /api/experimental/job (experimental)

List active and unconsumed background jobs, optionally filtered by owning session, descendants, or kind.

Parameters:
- `sessionID?: string` Filter to background jobs owned by this session.
- `kind?: "shell" | "subagent" | "image" | "video" | "codemode"` Filter by background job kind.
- `status?: "running" | "completed" | "error" | "cancelled"` Filter by job status (running, completed, error, or cancelled).
- `descendants?: "true" | "false"` When sessionID is set, also include background jobs owned by child and nested subagent sessions.

Returns: `{ data: Job.Info[] }`

## POST /api/experimental/job/{id}/cancel (experimental)

Cancel a running background job, interrupting the work it started. Cancelling a job that already finished does nothing.

Returns: nothing

## Types

- `Job.CodeMode`: `{ kind: "codemode"; id: string; sessionID: string; status: "running" | "completed" | "error" | "cancelled"; title?: string; time: Job.Time }`
- `Job.Image`: `{ kind: "image"; id: string; sessionID: string; status: "running" | "completed" | "error" | "cancelled"; title?: string; time: Job.Time; path: string; model: string }`
- `Job.Info`: `Job.Shell | Job.Subagent | Job.Image | Job.Video | Job.CodeMode`
- `Job.Shell`: `{ kind: "shell"; id: string; sessionID: string; status: "running" | "completed" | "error" | "cancelled"; title?: string; time: Job.Time; shellID: string; command: string }`
- `Job.Subagent`: `{ kind: "subagent"; id: string; sessionID: string; status: "running" | "completed" | "error" | "cancelled"; title?: string; time: Job.Time; childSessionID: string; agent: string; description: string }`
- `Job.Time`: `{ started: number; completed?: number }`
- `Job.Video`: `{ kind: "video"; id: string; sessionID: string; status: "running" | "completed" | "error" | "cancelled"; title?: string; time: Job.Time; path: string }`
