# session/diff

## GET /api/session/{sessionID}/diff

Structured per-file diffs of the files a turn changed. A turn runs from the first prompt after the session was last idle until its next idle marker, so prompts steered in while it was busy belong to the same turn; `to` extends the range through a later turn. Compares the range's first recorded snapshot with its last; a step still running in the active session compares against the working copy. Ranges that span a location change are rejected. In sessions without any idle marker, a prompt's turn spans until the next user message.

Parameters:
- `from?: string` User message whose turn to diff. Defaults to the turn of the newest user message.
- `to?: string` Later user message whose turn ends the range. Defaults to the turn of `from` alone.
- `context?: string` Unchanged lines around each hunk. Omit for full-file patches.

Returns: `{ data: FileDiff.Info[] }`

## Types

- `FileDiff.Info`: `{ file: string; patch: string; additions: number; deletions: number; status: "added" | "deleted" | "modified"; more?: true }`
