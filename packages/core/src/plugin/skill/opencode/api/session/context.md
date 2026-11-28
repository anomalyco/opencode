# session/context

## GET /api/session/{sessionID}/context

Retrieve the active context messages for a session (all messages after the last compaction).

Returns: `{ data: Session.Message.Info[] }`

## Types

- `Location.PublicRef`: `{ directory: string }`
- `Model.Ref`: `{ id: string; providerID: string; variant?: string }`
- `Prompt.AgentAttachment`: `{ name: string; mention?: Prompt.Mention }` An agent @-mentioned in the prompt, such as @explore, to suggest the model use it. Only the @name in text reaches the model; this records which agent it names and doesn't change the session's own agent.
- `Prompt.FileAttachment`: `{ data: string; mime: string; source: Prompt.FileSource; name?: string; description?: string; mention?: Prompt.Mention }`
- `Prompt.FileSource`: `{ type: "inline" } | { type: "uri"; uri: string }`
- `Prompt.Mention`: `{ start: number; end: number; text: string }`
- `Prompt.SkillAttachment`: `{ id: string; name: string; text?: string; mention?: Prompt.Mention }`
- `Session.Message.AgentSelected`: `{ id: string; seq?: number; metadata?: Record<string, unknown>; time: { created }; type: "agent-switched"; agent: string; previous?: string }`
- `Session.Message.Assistant`: `{ id, seq, metadata, time, type, agent, model, content, snapshot, finish, rawFinish, native, cost, tokens, error, retry }`
- `Session.Message.Compaction`: `Session.Message.Compaction.Running | Session.Message.Compaction.Completed | Session.Message.Compaction.Failed`
- `Session.Message.Compaction.Completed`: `{ type, id, seq, metadata, time, status, reason, model, native, summary, cost, tokens }`
- `Session.Message.Compaction.Failed`: `{ type: "compaction"; id: string; seq?: number; metadata?: Record<string, unknown>; time: { created }; status: "failed"; reason: "auto" | "manual"; error: Session.StructuredError; cost?: number; tokens?: TokenUsage.Info }`
- `Session.Message.Compaction.Running`: `{ type: "compaction"; id: string; seq?: number; metadata?: Record<string, unknown>; time: { created }; status: "running"; reason: "auto" | "manual"; summary: string }`
- `Session.Message.Idle`: `{ id: string; seq?: number; metadata?: Record<string, unknown>; time: { created }; type: "idle"; outcome: "succeeded" | "failed" | "interrupted"; error?: Session.StructuredError }`
- `Session.Message.Info`: `Session.Message.AgentSelected | Session.Message.ModelSelected | Session.Message.LocationSwitched | Session.Message.User | Session.Message.Synthetic | Session.Message.System | Session.Message.Skill | Session.Message.Shell | Session.Message.Assistant | Session.Message.Compaction | Session.Message.Idle`
- `Session.Message.LocationSwitched`: `{ id: string; seq?: number; metadata?: Record<string, unknown>; time: { created }; type: "location-switched"; projectID?: string; subpath?: string; location: Location.PublicRef; previous?: { location, projectID, subpath } }`
- `Session.Message.ModelSelected`: `{ id: string; seq?: number; metadata?: Record<string, unknown>; time: { created }; type: "model-switched"; model: Model.Ref; previous?: Model.Ref }`
- `Session.Message.Shell`: `{ id, seq, metadata, time, type, shellID, command, status, exit, output }`
- `Session.Message.Skill`: `{ id: string; seq?: number; metadata?: Record<string, unknown>; time: { created }; type: "skill"; skill: string; name: string; text: string }`
- `Session.Message.Synthetic`: `{ id: string; seq?: number; metadata?: Record<string, unknown>; time: { created }; text: string; description?: string; type: "synthetic" }`
- `Session.Message.System`: `{ id: string; seq?: number; metadata?: Record<string, unknown>; time: { created }; type: "system"; text: string; description?: string }`
- `Session.Message.User`: `{ id: string; seq?: number; metadata?: Record<string, unknown>; time: { created }; text: string; files?: Prompt.FileAttachment[]; agents?: Prompt.AgentAttachment[]; skills?: Prompt.SkillAttachment[]; type: "user" }`
- `Session.StructuredError`: `{ type: string; message: string; status?: number; response?: { body }; retryAfterMs?: number }`
- `TokenUsage.Info`: `{ input: number; output: number; reasoning: number; cache: { read, write } }`
