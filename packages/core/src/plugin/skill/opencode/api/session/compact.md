# session/compact

## POST /api/session/{sessionID}/compact

Queue a summary of the session's history. Steers by default: it runs before the next model call, ahead of queued messages.

Body:
- `id?: string`
- `delivery?: "steer" | "queue"` steer delivers before the agent's next model call, even mid-work. queue waits until the agent finishes its current work, then delivers one queued item at a time. Sending defaults to steer.

Returns: `{ data: Session.Inbox.Compaction }`

## Types

- `Session.Inbox.Compaction`: `{ id: string; sessionID: string; time: { created }; type: "compaction"; payload: unknown; delivery: "steer" | "queue" }`
