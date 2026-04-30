import { Schema } from "effect"
import { Prompt } from "./session-prompt"
import { SessionEvent } from "./session-event"
import { Event } from "./event"
import { ToolOutput } from "./tool-output"

export const ID = Event.ID
export type ID = Schema.Schema.Type<typeof ID>

const Base = {
  id: ID,
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  time: Schema.Struct({
    created: Schema.DateTimeUtcFromMillis,
  }),
}

export class User extends Schema.Class<User>("Session.Message.User")({
  ...Base,
  text: Prompt.fields.text,
  files: Prompt.fields.files,
  agents: Prompt.fields.agents,
  type: Schema.Literal("user"),
  time: Schema.Struct({
    created: Schema.DateTimeUtcFromMillis,
  }),
}) {
  static fromEvent(event: SessionEvent.Prompted) {
    return new User({
      id: event.data.id,
      type: "user",
      metadata: event.metadata,
      text: event.data.prompt.text,
      files: event.data.prompt.files,
      agents: event.data.prompt.agents,
      time: { created: event.data.timestamp },
    })
  }
}

export class Synthetic extends Schema.Class<Synthetic>("Session.Message.Synthetic")({
  ...Base,
  sessionID: SessionEvent.Synthetic.fields.data.fields.sessionID,
  text: SessionEvent.Synthetic.fields.data.fields.text,
  type: Schema.Literal("synthetic"),
}) {
  static fromEvent(event: SessionEvent.Synthetic) {
    return new Synthetic({
      sessionID: event.data.sessionID,
      text: event.data.text,
      id: event.data.id,
      type: "synthetic",
      time: { created: event.data.timestamp },
    })
  }
}

export class ToolStatePending extends Schema.Class<ToolStatePending>("Session.Message.ToolState.Pending")({
  status: Schema.Literal("pending"),
  input: Schema.String,
}) {}

export class ToolStateRunning extends Schema.Class<ToolStateRunning>("Session.Message.ToolState.Running")({
  status: Schema.Literal("running"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  structured: ToolOutput.Structured,
  content: ToolOutput.Content.pipe(Schema.Array),
}) {}

export class ToolStateCompleted extends Schema.Class<ToolStateCompleted>("Session.Message.ToolState.Completed")({
  status: Schema.Literal("completed"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  attachments: SessionEvent.FileAttachment.pipe(Schema.Array, Schema.optional),
  content: ToolOutput.Content.pipe(Schema.Array),
  structured: ToolOutput.Structured,
}) {}

export class ToolStateError extends Schema.Class<ToolStateError>("Session.Message.ToolState.Error")({
  status: Schema.Literal("error"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  content: ToolOutput.Content.pipe(Schema.Array),
  structured: ToolOutput.Structured,
  error: Schema.Struct({
    type: Schema.String,
    message: Schema.String,
  }),
}) {}

export const ToolState = Schema.Union([ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError]).pipe(
  Schema.toTaggedUnion("status"),
)
export type ToolState = Schema.Schema.Type<typeof ToolState>

export class AssistantTool extends Schema.Class<AssistantTool>("Session.Message.Assistant.Tool")({
  type: Schema.Literal("tool"),
  id: Schema.String,
  name: Schema.String,
  provider: Schema.Struct({
    executed: Schema.Boolean,
    metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  }).pipe(Schema.optional),
  state: ToolState,
  time: Schema.Struct({
    created: Schema.DateTimeUtcFromMillis,
    ran: Schema.DateTimeUtcFromMillis.pipe(Schema.optional),
    completed: Schema.DateTimeUtcFromMillis.pipe(Schema.optional),
    pruned: Schema.DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
}) {}

export class AssistantText extends Schema.Class<AssistantText>("Session.Message.Assistant.Text")({
  type: Schema.Literal("text"),
  text: Schema.String,
}) {}

export class AssistantReasoning extends Schema.Class<AssistantReasoning>("Session.Message.Assistant.Reasoning")({
  type: Schema.Literal("reasoning"),
  id: Schema.String,
  text: Schema.String,
}) {}

export const AssistantContent = Schema.Union([AssistantText, AssistantReasoning, AssistantTool]).pipe(
  Schema.toTaggedUnion("type"),
)
export type AssistantContent = Schema.Schema.Type<typeof AssistantContent>

export class Assistant extends Schema.Class<Assistant>("Session.Message.Assistant")({
  ...Base,
  type: Schema.Literal("assistant"),
  agent: Schema.String,
  model: SessionEvent.Step.Started.fields.data.fields.model,
  content: AssistantContent.pipe(Schema.Array),
  snapshot: Schema.Struct({
    start: Schema.String.pipe(Schema.optional),
    end: Schema.String.pipe(Schema.optional),
  }).pipe(Schema.optional),
  finish: Schema.String.pipe(Schema.optional),
  cost: Schema.Number.pipe(Schema.optional),
  tokens: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    reasoning: Schema.Number,
    cache: Schema.Struct({
      read: Schema.Number,
      write: Schema.Number,
    }),
  }).pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
  time: Schema.Struct({
    created: Schema.DateTimeUtcFromMillis,
    completed: Schema.DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
}) {
  static fromEvent(event: SessionEvent.Step.Started) {
    return new Assistant({
      id: event.data.id,
      type: "assistant",
      agent: event.data.agent,
      model: event.data.model,
      time: {
        created: event.data.timestamp,
      },
      content: [],
      snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
    })
  }
}

export class Compaction extends Schema.Class<Compaction>("Session.Message.Compaction")({
  type: Schema.Literal("compaction"),
  reason: SessionEvent.Compaction.Started.fields.data.fields.reason,
  summary: Schema.String,
  include: Schema.String.pipe(Schema.optional),
  ...Base,
}) {
  static fromEvent(event: SessionEvent.Compaction.Started) {
    return new Compaction({
      id: event.data.id,
      type: "compaction",
      metadata: event.metadata,
      reason: event.data.reason,
      summary: "",
      time: { created: event.data.timestamp },
    })
  }
}

export const Message = Schema.Union([User, Synthetic, Assistant, Compaction])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Session.Message" })

export type Message = Schema.Schema.Type<typeof Message>

export type Type = Message["type"]

export * as SessionMessage from "./session-message"
