export * as SessionV1 from "./session"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema"
import { NamedError } from "../util/error"

export {
  AgentPart,
  AgentPartInput,
  Assistant,
  CompactionPart,
  Event,
  FilePart,
  FilePartInput,
  FilePartSource,
  FileSource,
  Format,
  Info,
  MessageID,
  OutputFormatJsonSchema,
  OutputFormatText,
  Part,
  PartID,
  PatchPart,
  Range,
  ReasoningPart,
  ResourceSource,
  RetryPart,
  SessionInfo,
  SnapshotPart,
  StepFinishPart,
  StepStartPart,
  SubtaskPart,
  SubtaskPartInput,
  SymbolSource,
  TextPart,
  TextPartInput,
  ToolPart,
  ToolState,
  ToolStateCompleted,
  ToolStateError,
  ToolStatePending,
  ToolStateRunning,
  User,
  WithParts,
} from "@opencode-ai/schema/session-v1"

export const OutputLengthError = NamedError.create("MessageOutputLengthError", {})
export const AuthError = NamedError.create("ProviderAuthError", { providerID: Schema.String, message: Schema.String })
export const AbortedError = NamedError.create("MessageAbortedError", { message: Schema.String })
export const StructuredOutputError = NamedError.create("StructuredOutputError", {
  message: Schema.String,
  retries: NonNegativeInt,
})
export const APIError = NamedError.create("APIError", {
  message: Schema.String,
  statusCode: Schema.optional(NonNegativeInt),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  responseBody: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export type APIError = Schema.Schema.Type<typeof APIError.Schema>
export const ContextOverflowError = NamedError.create("ContextOverflowError", {
  message: Schema.String,
  responseBody: Schema.optional(Schema.String),
})
export const ContentFilterError = NamedError.create("ContentFilterError", { message: Schema.String })
