# session/inbox

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

## Types

- `Location.PublicRef`: `{ directory: string }`
- `Prompt.AgentAttachment`: `{ name: string; mention?: Prompt.Mention }` An agent @-mentioned in the prompt, such as @explore, to suggest the model use it. Only the @name in text reaches the model; this records which agent it names and doesn't change the session's own agent.
- `Prompt.FileAttachment`: `{ data: string; mime: string; source: Prompt.FileSource; name?: string; description?: string; mention?: Prompt.Mention }`
- `Prompt.FileSource`: `{ type: "inline" } | { type: "uri"; uri: string }`
- `Prompt.Mention`: `{ start: number; end: number; text: string }`
- `Prompt.SkillAttachment`: `{ id: string; name: string; text?: string; mention?: Prompt.Mention }`
- `Session.Inbox.Compaction`: `{ id: string; enqueuedSeq?: number; sessionID: string; time: { created }; type: "compaction"; payload: unknown; delivery: "steer" | "queue" }`
- `Session.Inbox.Info`: `Session.Inbox.User | Session.Inbox.Synthetic | Session.Inbox.Compaction | Session.Inbox.Move`
- `Session.Inbox.Move`: `{ id: string; enqueuedSeq?: number; sessionID: string; time: { created }; type: "move"; delivery: "steer" | "queue"; payload: Session.Inbox.MovePayload }`
- `Session.Inbox.MovePayload`: `{ projectID: string; subpath?: string; location: Location.PublicRef }`
- `Session.Inbox.Synthetic`: `{ id: string; enqueuedSeq?: number; sessionID: string; time: { created }; type: "synthetic"; payload: Session.Inbox.SyntheticPayload; delivery: "steer" | "queue" }`
- `Session.Inbox.SyntheticPayload`: `{ text: string; description?: string; metadata?: Record<string, unknown> }`
- `Session.Inbox.User`: `{ id: string; enqueuedSeq?: number; sessionID: string; time: { created }; type: "user"; payload: Session.Inbox.UserPayload; delivery: "steer" | "queue" }`
- `Session.Inbox.UserPayload`: `{ text: string; files?: Prompt.FileAttachment[]; agents?: Prompt.AgentAttachment[]; skills?: Prompt.SkillAttachment[]; metadata?: Record<string, unknown> }`
