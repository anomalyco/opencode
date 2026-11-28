# session/prompt

## POST /api/session/{sessionID}/prompt

Send a user message and start the agent unless resume is false. Returns once the message is queued, not when the agent finishes: wait with POST /api/experimental/session/:sessionID/wait or the session.execution.* events, then read the reply with GET /api/session/:sessionID/message. An archived session is unarchived.

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

## Types

- `Prompt.AgentAttachment`: `{ name: string; mention?: Prompt.Mention }` An agent @-mentioned in the prompt, such as @explore, to suggest the model use it. Only the @name in text reaches the model; this records which agent it names and doesn't change the session's own agent.
- `Prompt.FileAttachment`: `{ data: string; mime: string; source: Prompt.FileSource; name?: string; description?: string; mention?: Prompt.Mention }`
- `Prompt.FileSource`: `{ type: "inline" } | { type: "uri"; uri: string }`
- `Prompt.Mention`: `{ start: number; end: number; text: string }`
- `Prompt.SkillAttachment`: `{ id: string; name: string; text?: string; mention?: Prompt.Mention }`
- `PromptInput.FileAttachment`: `{ uri: string; source?: Prompt.FileSource; name?: string; description?: string; mention?: Prompt.Mention }`
- `PromptInput.SkillAttachment`: `{ id: string; mention?: Prompt.Mention }`
- `Session.Inbox.User`: `{ id: string; enqueuedSeq?: number; sessionID: string; time: { created }; type: "user"; payload: Session.Inbox.UserPayload; delivery: "steer" | "queue" }`
- `Session.Inbox.UserPayload`: `{ text: string; files?: Prompt.FileAttachment[]; agents?: Prompt.AgentAttachment[]; skills?: Prompt.SkillAttachment[]; metadata?: Record<string, unknown> }`
