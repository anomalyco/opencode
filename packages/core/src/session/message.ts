export * as SessionMessage from "./message"

import { Schema } from "effect"
import { ProviderMetadata } from "@opencode-ai/llm"
import { ModelV2 } from "../model"
import { ToolOutput } from "../tool-output"
import { V2Schema } from "../v2-schema"
import { SessionEvent } from "./event"
import { Prompt } from "./prompt"
import { SessionMessageID } from "./message-id"

export const ID = SessionMessageID.ID
export type ID = typeof ID.Type

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
  agent: SessionEvent.AgentSwitched.data.fields.agent,
}) {}

export class ModelSwitched extends Schema.Class<ModelSwitched>("Session.Message.ModelSwitched")({
  ...Base,
  type: Schema.Literal("model-switched"),
  model: ModelV2.Ref,
}) {}

export class User extends Schema.Class<User>("Session.Message.User")({
  ...Base,
  text: Prompt.fields.text,
  files: Prompt.fields.files,
  agents: Prompt.fields.agents,
  references: Prompt.fields.references,
  type: Schema.Literal("user"),
  time: Schema.Struct({
    created: V2Schema.DateTimeUtcFromMillis,
  }),
}) {}

export class Synthetic extends Schema.Class<Synthetic>("Session.Message.Synthetic")({
  ...Base,
  sessionID: SessionEvent.Synthetic.data.fields.sessionID,
  text: SessionEvent.Synthetic.data.fields.text,
  type: Schema.Literal("synthetic"),
}) {}

export class System extends Schema.Class<System>("Session.Message.System")({
  ...Base,
  type: Schema.Literal("system"),
  text: SessionEvent.ContextUpdated.data.fields.text,
}) {}

export class Shell extends Schema.Class<Shell>("Session.Message.Shell")({
  ...Base,
  type: Schema.Literal("shell"),
  callID: SessionEvent.Shell.Started.data.fields.callID,
  command: SessionEvent.Shell.Started.data.fields.command,
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
  result: SessionEvent.Tool.Success.data.fields.result,
}) {}

export class ToolStateError extends Schema.Class<ToolStateError>("Session.Message.ToolState.Error")({
  status: Schema.Literal("error"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  content: ToolOutput.Content.pipe(Schema.Array),
  structured: ToolOutput.Structured,
  error: SessionEvent.UnknownError,
  result: SessionEvent.Tool.Failed.data.fields.result,
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
    metadata: ProviderMetadata.pipe(Schema.optional),
    resultMetadata: ProviderMetadata.pipe(Schema.optional),
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
  id: Schema.String,
  text: Schema.String,
}) {}

export class AssistantReasoning extends Schema.Class<AssistantReasoning>("Session.Message.Assistant.Reasoning")({
  type: Schema.Literal("reasoning"),
  id: Schema.String,
  text: Schema.String,
  providerMetadata: ProviderMetadata.pipe(Schema.optional),
}) {}

export const AssistantContent = Schema.Union([AssistantText, AssistantReasoning, AssistantTool]).pipe(
  Schema.toTaggedUnion("type"),
)
export type AssistantContent = Schema.Schema.Type<typeof AssistantContent>

export class Assistant extends Schema.Class<Assistant>("Session.Message.Assistant")({
  ...Base,
  type: Schema.Literal("assistant"),
  agent: Schema.String,
  model: SessionEvent.Step.Started.data.fields.model,
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
  error: SessionEvent.Step.Failed.data.fields.error.pipe(Schema.optional),
  time: Schema.Struct({
    created: V2Schema.DateTimeUtcFromMillis,
    completed: V2Schema.DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
}) {}

export class Compaction extends Schema.Class<Compaction>("Session.Message.Compaction")({
  type: Schema.Literal("compaction"),
  reason: SessionEvent.Compaction.Started.data.fields.reason,
  summary: Schema.String,
  recent: Schema.String,
  ...Base,
}) {}

export const Message = Schema.Union([
  AgentSwitched,
  ModelSwitched,
  User,
  Synthetic,
  System,
  Shell,
  Assistant,
  Compaction,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Session.Message" })

export type Message = Schema.Schema.Type<typeof Message>

export type Type = Message["type"]
