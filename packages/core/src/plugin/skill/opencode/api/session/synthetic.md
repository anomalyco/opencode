# session/synthetic

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

## Types

- `Session.Inbox.Synthetic`: `{ id: string; sessionID: string; time: { created }; type: "synthetic"; payload: Session.Inbox.SyntheticPayload; delivery: "steer" | "queue" }`
- `Session.Inbox.SyntheticPayload`: `{ text: string; description?: string; metadata?: Record<string, unknown> }`
