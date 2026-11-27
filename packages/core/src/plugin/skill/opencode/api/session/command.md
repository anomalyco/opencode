# session/command

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

## Types

- `Prompt.AgentAttachment`: `{ name: string; mention?: Prompt.Mention }` An agent @-mentioned in the prompt, such as @explore, to suggest the model use it. Only the @name in text reaches the model; this records which agent it names and doesn't change the session's own agent.
- `Prompt.FileSource`: `{ type: "inline" } | { type: "uri"; uri: string }`
- `Prompt.Mention`: `{ start: number; end: number; text: string }`
- `PromptInput.FileAttachment`: `{ uri: string; source?: Prompt.FileSource; name?: string; description?: string; mention?: Prompt.Mention }`
- `PromptInput.SkillAttachment`: `{ id: string; mention?: Prompt.Mention }`
