export * as SessionMessage from "./session-message.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { ProviderMetadata, ToolContent } from "./llm.js"
import { Model } from "./model.js"
import { FileAttachment, Prompt } from "./prompt.js"
import { DateTimeUtcFromMillis, RelativePath, statics } from "./schema.js"
import { SessionID } from "./session-id.js"
import { ascending } from "./identifier.js"
import { Event } from "./event.js"
import { Shell as ShellSchema } from "./shell.js"

export const ID = Schema.String.check(Schema.isStartsWith("msg_")).pipe(
  Schema.brand("Session.Message.ID"),
  statics((schema) => ({
    create: () => schema.make("msg_" + ascending()),
    fromEvent: (eventID: Event.ID) => schema.make(eventID.replace(/^evt_/, "msg_")),
  })),
)
export type ID = typeof ID.Type

export interface UnknownError extends Schema.Schema.Type<typeof UnknownError> {}
export const UnknownError = Schema.Struct({
  type: Schema.Literal("unknown"),
  message: Schema.String,
}).annotate({ identifier: "Session.Error.Unknown" })

const Base = {
  id: ID,
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
  time: Schema.Struct({ created: DateTimeUtcFromMillis }),
}

export interface AgentSelected extends Schema.Schema.Type<typeof AgentSelected> {}
export const AgentSelected = Schema.Struct({
  ...Base,
  type: Schema.Literal("agent-switched"),
  agent: Schema.String,
}).annotate({ identifier: "Session.Message.AgentSelected" })

export interface ModelSelected extends Schema.Schema.Type<typeof ModelSelected> {}
export const ModelSelected = Schema.Struct({
  ...Base,
  type: Schema.Literal("model-switched"),
  model: Model.Ref,
}).annotate({ identifier: "Session.Message.ModelSelected" })

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
  description: Schema.String.pipe(optional),
  type: Schema.Literal("synthetic"),
}).annotate({ identifier: "Session.Message.Synthetic" })

export interface System extends Schema.Schema.Type<typeof System> {}
export const System = Schema.Struct({
  ...Base,
  type: Schema.Literal("system"),
  text: Schema.String,
}).annotate({ identifier: "Session.Message.System" })

export interface Skill extends Schema.Schema.Type<typeof Skill> {}
export const Skill = Schema.Struct({
  ...Base,
  type: Schema.Literal("skill"),
  name: Schema.String,
  text: Schema.String,
}).annotate({ identifier: "Session.Message.Skill" })

export interface Shell extends Schema.Schema.Type<typeof Shell> {}
export const Shell = Schema.Struct({
  ...Base,
  type: Schema.Literal("shell"),
  shell: ShellSchema.Info,
  output: ShellSchema.Output.pipe(optional),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    completed: DateTimeUtcFromMillis.pipe(optional),
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
  structured: Schema.Record(Schema.String, Schema.Unknown),
  content: ToolContent.pipe(Schema.Array),
}).annotate({ identifier: "Session.Message.ToolState.Running" })

export interface ToolStateCompleted extends Schema.Schema.Type<typeof ToolStateCompleted> {}
export const ToolStateCompleted = Schema.Struct({
  status: Schema.Literal("completed"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  attachments: FileAttachment.pipe(Schema.Array, optional),
  content: ToolContent.pipe(Schema.Array),
  outputPaths: Schema.Array(Schema.String).pipe(optional),
  structured: Schema.Record(Schema.String, Schema.Unknown),
  result: Schema.Unknown.pipe(optional),
}).annotate({ identifier: "Session.Message.ToolState.Completed" })

export interface ToolStateError extends Schema.Schema.Type<typeof ToolStateError> {}
export const ToolStateError = Schema.Struct({
  status: Schema.Literal("error"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  content: ToolContent.pipe(Schema.Array),
  structured: Schema.Record(Schema.String, Schema.Unknown),
  error: UnknownError,
  result: Schema.Unknown.pipe(optional),
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
    metadata: ProviderMetadata.pipe(optional),
    resultMetadata: ProviderMetadata.pipe(optional),
  }).pipe(optional),
  state: ToolState,
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    ran: DateTimeUtcFromMillis.pipe(optional),
    completed: DateTimeUtcFromMillis.pipe(optional),
    pruned: DateTimeUtcFromMillis.pipe(optional),
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
  providerMetadata: ProviderMetadata.pipe(optional),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    completed: DateTimeUtcFromMillis.pipe(optional),
  }).pipe(optional),
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
    start: Schema.String.pipe(optional),
    end: Schema.String.pipe(optional),
    files: Schema.Array(RelativePath).pipe(optional),
  }).pipe(optional),
  finish: Schema.String.pipe(optional),
  cost: Schema.Finite.pipe(optional),
  tokens: Schema.Struct({
    input: Schema.Finite,
    output: Schema.Finite,
    reasoning: Schema.Finite,
    cache: Schema.Struct({ read: Schema.Finite, write: Schema.Finite }),
  }).pipe(optional),
  error: UnknownError.pipe(optional),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    completed: DateTimeUtcFromMillis.pipe(optional),
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
  AgentSelected,
  ModelSelected,
  User,
  Synthetic,
  System,
  Skill,
  Shell,
  Assistant,
  Compaction,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Session.Message" })
export type Message = AgentSelected | ModelSelected | User | Synthetic | System | Skill | Shell | Assistant | Compaction
export type Type = Message["type"]
