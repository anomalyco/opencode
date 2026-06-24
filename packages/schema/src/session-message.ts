export * as SessionMessage from "./session-message"

import { Schema } from "effect"
import { ProviderMetadata, ToolContent } from "./llm"
import { Model } from "./model"
import { FileAttachment, Prompt } from "./prompt"
import { DateTimeUtcFromMillis } from "./schema"
import { SessionID } from "./session-id"
import { SessionMessageID } from "./session-message-id"

export const ID = SessionMessageID.ID
export type ID = SessionMessageID.ID

export interface UnknownError extends Schema.Schema.Type<typeof UnknownError> {}
export const UnknownError = Schema.Struct({
  type: Schema.Literal("unknown"),
  message: Schema.String,
}).annotate({ identifier: "Session.Error.Unknown" })

const Base = {
  id: ID,
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  time: Schema.Struct({ created: DateTimeUtcFromMillis }),
}

export interface AgentSwitched extends Schema.Schema.Type<typeof AgentSwitched> {}
export const AgentSwitched = Schema.Struct({
  ...Base,
  type: Schema.Literal("agent-switched"),
  agent: Schema.String,
}).annotate({ identifier: "Session.Message.AgentSwitched" })

export interface ModelSwitched extends Schema.Schema.Type<typeof ModelSwitched> {}
export const ModelSwitched = Schema.Struct({
  ...Base,
  type: Schema.Literal("model-switched"),
  model: Model.Ref,
}).annotate({ identifier: "Session.Message.ModelSwitched" })

export interface User extends Schema.Schema.Type<typeof User> {}
export const User = Schema.Struct({
  ...Base,
  text: Prompt.fields.text,
  files: Prompt.fields.files,
  agents: Prompt.fields.agents,
  type: Schema.Literal("user"),
}).annotate({ identifier: "Session.Message.User" })

export interface Synthetic extends Schema.Schema.Type<typeof Synthetic> {}
export const Synthetic = Schema.Struct({
  ...Base,
  sessionID: SessionID,
  text: Schema.String,
  type: Schema.Literal("synthetic"),
}).annotate({ identifier: "Session.Message.Synthetic" })

export interface System extends Schema.Schema.Type<typeof System> {}
export const System = Schema.Struct({
  ...Base,
  type: Schema.Literal("system"),
  text: Schema.String,
}).annotate({ identifier: "Session.Message.System" })

export interface Shell extends Schema.Schema.Type<typeof Shell> {}
export const Shell = Schema.Struct({
  ...Base,
  type: Schema.Literal("shell"),
  callID: Schema.String,
  command: Schema.String,
  output: Schema.String,
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    completed: DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
}).annotate({ identifier: "Session.Message.Shell" })

export interface ToolStatePending extends Schema.Schema.Type<typeof ToolStatePending> {}
export const ToolStatePending = Schema.Struct({
  status: Schema.Literal("pending"),
  input: Schema.String,
}).annotate({ identifier: "Session.Message.ToolState.Pending" })

export interface ToolStateRunning extends Schema.Schema.Type<typeof ToolStateRunning> {}
export const ToolStateRunning = Schema.Struct({
  status: Schema.Literal("running"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  structured: Schema.Record(Schema.String, Schema.Any),
  content: ToolContent.pipe(Schema.Array),
}).annotate({ identifier: "Session.Message.ToolState.Running" })

export interface ToolStateCompleted extends Schema.Schema.Type<typeof ToolStateCompleted> {}
export const ToolStateCompleted = Schema.Struct({
  status: Schema.Literal("completed"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  attachments: FileAttachment.pipe(Schema.Array, Schema.optional),
  content: ToolContent.pipe(Schema.Array),
  outputPaths: Schema.Array(Schema.String).pipe(Schema.optional),
  structured: Schema.Record(Schema.String, Schema.Any),
  result: Schema.Unknown.pipe(Schema.optional),
}).annotate({ identifier: "Session.Message.ToolState.Completed" })

export interface ToolStateError extends Schema.Schema.Type<typeof ToolStateError> {}
export const ToolStateError = Schema.Struct({
  status: Schema.Literal("error"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  content: ToolContent.pipe(Schema.Array),
  structured: Schema.Record(Schema.String, Schema.Any),
  error: UnknownError,
  result: Schema.Unknown.pipe(Schema.optional),
}).annotate({ identifier: "Session.Message.ToolState.Error" })

export const ToolState = Schema.Union([ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError]).pipe(
  Schema.toTaggedUnion("status"),
)
export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError

export interface AssistantTool extends Schema.Schema.Type<typeof AssistantTool> {}
export const AssistantTool = Schema.Struct({
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
    created: DateTimeUtcFromMillis,
    ran: DateTimeUtcFromMillis.pipe(Schema.optional),
    completed: DateTimeUtcFromMillis.pipe(Schema.optional),
    pruned: DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
}).annotate({ identifier: "Session.Message.Assistant.Tool" })

export interface AssistantText extends Schema.Schema.Type<typeof AssistantText> {}
export const AssistantText = Schema.Struct({
  type: Schema.Literal("text"),
  id: Schema.String,
  text: Schema.String,
}).annotate({ identifier: "Session.Message.Assistant.Text" })

export interface AssistantReasoning extends Schema.Schema.Type<typeof AssistantReasoning> {}
export const AssistantReasoning = Schema.Struct({
  type: Schema.Literal("reasoning"),
  id: Schema.String,
  text: Schema.String,
  providerMetadata: ProviderMetadata.pipe(Schema.optional),
}).annotate({ identifier: "Session.Message.Assistant.Reasoning" })

export const AssistantContent = Schema.Union([AssistantText, AssistantReasoning, AssistantTool]).pipe(
  Schema.toTaggedUnion("type"),
)
export type AssistantContent = AssistantText | AssistantReasoning | AssistantTool

export interface Assistant extends Schema.Schema.Type<typeof Assistant> {}
export const Assistant = Schema.Struct({
  ...Base,
  type: Schema.Literal("assistant"),
  agent: Schema.String,
  model: Model.Ref,
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
    cache: Schema.Struct({ read: Schema.Finite, write: Schema.Finite }),
  }).pipe(Schema.optional),
  error: UnknownError.pipe(Schema.optional),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    completed: DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
}).annotate({ identifier: "Session.Message.Assistant" })

export interface Compaction extends Schema.Schema.Type<typeof Compaction> {}
export const Compaction = Schema.Struct({
  type: Schema.Literal("compaction"),
  reason: Schema.Literals(["auto", "manual"]),
  summary: Schema.String,
  recent: Schema.String,
  ...Base,
}).annotate({ identifier: "Session.Message.Compaction" })

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
export type Message = AgentSwitched | ModelSwitched | User | Synthetic | System | Shell | Assistant | Compaction
export type Type = Message["type"]
