import { Schema } from "effect"
import { Prompt } from "./session-prompt"
import { SessionEvent } from "./session-event"
import { EventV2 } from "./event"
import { ToolOutput } from "./tool-output"
import { V2Schema } from "./schema"
import { Modelv2 } from "./model"

export const ID = EventV2.ID
export type ID = Schema.Schema.Type<typeof ID>

const Base = {
  id: ID,
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  time: Schema.Struct({
    created: V2Schema.DateTimeUtcFromMillis,
  }),
}

export class AgentSwitched extends Schema.Class<AgentSwitched>("Session.Message.AgentSwitched")({
  ...Base,
  type: Schema.Literal("agent-switched"),
  agent: SessionEvent.AgentSwitched.fields.data.fields.agent,
}) {}

export class ModelSwitched extends Schema.Class<ModelSwitched>("Session.Message.ModelSwitched")({
  ...Base,
  type: Schema.Literal("model-switched"),
  model: Modelv2.Ref,
}) {}

export class User extends Schema.Class<User>("Session.Message.User")({
  ...Base,
  text: Prompt.fields.text,
  files: Prompt.fields.files,
  agents: Prompt.fields.agents,
  type: Schema.Literal("user"),
  time: Schema.Struct({
    created: V2Schema.DateTimeUtcFromMillis,
  }),
}) {}

export class Synthetic extends Schema.Class<Synthetic>("Session.Message.Synthetic")({
  ...Base,
  sessionID: SessionEvent.Synthetic.fields.data.fields.sessionID,
  text: SessionEvent.Synthetic.fields.data.fields.text,
  type: Schema.Literal("synthetic"),
}) {}

export class Shell extends Schema.Class<Shell>("Session.Message.Shell")({
  ...Base,
  type: Schema.Literal("shell"),
  callID: SessionEvent.Shell.Started.fields.data.fields.callID,
  command: SessionEvent.Shell.Started.fields.data.fields.command,
  output: Schema.String,
  time: Schema.Struct({
    created: V2Schema.DateTimeUtcFromMillis,
    completed: V2Schema.DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
}) {}

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
  error: SessionEvent.UnknownError,
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
    created: V2Schema.DateTimeUtcFromMillis,
    ran: V2Schema.DateTimeUtcFromMillis.pipe(Schema.optional),
    completed: V2Schema.DateTimeUtcFromMillis.pipe(Schema.optional),
    pruned: V2Schema.DateTimeUtcFromMillis.pipe(Schema.optional),
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
  cost: Schema.Finite.pipe(Schema.optional),
  tokens: Schema.Struct({
    input: Schema.Finite,
    output: Schema.Finite,
    reasoning: Schema.Finite,
    cache: Schema.Struct({
      read: Schema.Finite,
      write: Schema.Finite,
    }),
  }).pipe(Schema.optional),
  error: SessionEvent.Step.Failed.fields.data.fields.error.pipe(Schema.optional),
  time: Schema.Struct({
    created: V2Schema.DateTimeUtcFromMillis,
    completed: V2Schema.DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
}) {}

export class Compaction extends Schema.Class<Compaction>("Session.Message.Compaction")({
  type: Schema.Literal("compaction"),
  reason: SessionEvent.Compaction.Started.fields.data.fields.reason,
  summary: Schema.String,
  include: Schema.String.pipe(Schema.optional),
  ...Base,
}) {}

export const Message = Schema.Union([AgentSwitched, ModelSwitched, User, Synthetic, Shell, Assistant, Compaction])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Session.Message" })

export type Message = Schema.Schema.Type<typeof Message>

export type Type = Message["type"]

export * as SessionMessage from "./session-message"
