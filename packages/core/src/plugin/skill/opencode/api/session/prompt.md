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

## POST /api/session/{sessionID}/command

Run a named command in the session. Most commands send a prompt, so like session.prompt this returns before the agent finishes. An archived session is unarchived.

Body:
- `name: string`
- `text: string` The command's arguments.
- `files?: PromptInput.FileAttachment[]`
- `agents?: Prompt.AgentAttachment[]`
- `skills?: PromptInput.SkillAttachment[]`
- `delivery?: "steer" | "queue"` steer delivers before the agent's next model call, even mid-work. queue waits until the agent finishes its current work, then delivers one queued item at a time. Sending defaults to steer.

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

## POST /api/session/{sessionID}/compact

Queue a summary of the session's history. Steers by default: it runs before the next model call, ahead of queued messages.

Body:
- `id?: string`
- `delivery?: "steer" | "queue"` steer delivers before the agent's next model call, even mid-work. queue waits until the agent finishes its current work, then delivers one queued item at a time. Sending defaults to steer.

Returns: `{ data: Session.Inbox.Compaction }`

## POST /api/experimental/session/{sessionID}/wait (experimental)

Wait until the session's agent stops running in this server process. Returns at once when idle.

Returns: nothing

## POST /api/session/{sessionID}/generate

Generate transient text from the current session context without mutating session history. Its tokens and cost count toward the session's totals.

Body:
- `prompt: string`

Returns: `SessionGenerateResponse`

## POST /api/session/{sessionID}/interrupt

Stop the session's agent if it is running in this server process; interrupted=false means nothing was running. With resume=true it continues with pending steer items, compaction and moves, while queued messages keep waiting.

Parameters:
- `resume?: "true" | "false"` Set to true to resume pending steering input and next-in-line control items after interrupting.

Returns: `SessionInterruptResponse`

## Types

- `Prompt.AgentAttachment`: `{ name: string; mention?: Prompt.Mention }` An agent @-mentioned in the prompt, such as @explore, to suggest the model use it. Only the @name in text reaches the model; this records which agent it names and doesn't change the session's own agent.
- `Prompt.FileAttachment`: `{ data: string; mime: string; source: Prompt.FileSource; name?: string; description?: string; mention?: Prompt.Mention }`
- `Prompt.FileSource`: `{ type: "inline" } | { type: "uri"; uri: string }`
- `Prompt.Mention`: `{ start: number; end: number; text: string }`
- `Prompt.SkillAttachment`: `{ id: string; name: string; text?: string; mention?: Prompt.Mention }`
- `PromptInput.FileAttachment`: `{ uri: string; source?: Prompt.FileSource; name?: string; description?: string; mention?: Prompt.Mention }`
- `PromptInput.SkillAttachment`: `{ id: string; mention?: Prompt.Mention }`
- `Session.Inbox.Compaction`: `{ id: string; sessionID: string; time: { created }; type: "compaction"; payload: unknown; delivery: "steer" | "queue" }`
- `Session.Inbox.Synthetic`: `{ id: string; sessionID: string; time: { created }; type: "synthetic"; payload: Session.Inbox.SyntheticPayload; delivery: "steer" | "queue" }`
- `Session.Inbox.SyntheticPayload`: `{ text: string; description?: string; metadata?: Record<string, unknown> }`
- `Session.Inbox.User`: `{ id: string; sessionID: string; time: { created }; type: "user"; payload: Session.Inbox.UserPayload; delivery: "steer" | "queue" }`
- `Session.Inbox.UserPayload`: `{ text: string; files?: Prompt.FileAttachment[]; agents?: Prompt.AgentAttachment[]; skills?: Prompt.SkillAttachment[]; metadata?: Record<string, unknown> }`
- `SessionGenerateResponse`: `{ data: { text, tokens, cost } }`
- `SessionInterruptResponse`: `{ interrupted: boolean }`
