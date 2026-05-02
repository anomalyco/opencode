import { Schema } from "effect"
import { SessionID } from "./schema"
import { ModelID, ProviderID } from "../provider/schema"
import { zod } from "@/util/effect-zod"
import { NonNegativeInt, withStatics } from "@/util/schema"
import { namedSchemaError } from "@/util/named-schema-error"

export const OutputLengthError = namedSchemaError("MessageOutputLengthError", {})
export const AuthError = namedSchemaError("ProviderAuthError", {
  providerID: Schema.String,
  message: Schema.String,
})

const AuthErrorEffect = Schema.Struct({
  name: Schema.Literal("ProviderAuthError"),
  data: Schema.Struct({
    providerID: Schema.String,
    message: Schema.String,
  }),
})

const OutputLengthErrorEffect = Schema.Struct({
  name: Schema.Literal("MessageOutputLengthError"),
  data: Schema.Struct({}),
})

const UnknownErrorEffect = Schema.Struct({
  name: Schema.Literal("UnknownError"),
  data: Schema.Struct({
    message: Schema.String,
  }),
})

export const ToolCall = Schema.Struct({
  state: Schema.Literal("call"),
  step: Schema.optional(NonNegativeInt),
  toolCallId: Schema.String,
  toolName: Schema.String,
  args: Schema.Unknown,
})
  .annotate({ identifier: "ToolCall" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ToolCall = Schema.Schema.Type<typeof ToolCall>

export const ToolPartialCall = Schema.Struct({
  state: Schema.Literal("partial-call"),
  step: Schema.optional(NonNegativeInt),
  toolCallId: Schema.String,
  toolName: Schema.String,
  args: Schema.Unknown,
})
  .annotate({ identifier: "ToolPartialCall" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ToolPartialCall = Schema.Schema.Type<typeof ToolPartialCall>

export const ToolResult = Schema.Struct({
  state: Schema.Literal("result"),
  step: Schema.optional(NonNegativeInt),
  toolCallId: Schema.String,
  toolName: Schema.String,
  args: Schema.Unknown,
  result: Schema.String,
})
  .annotate({ identifier: "ToolResult" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ToolResult = Schema.Schema.Type<typeof ToolResult>

export const ToolInvocation = Schema.Union([ToolCall, ToolPartialCall, ToolResult])
  .annotate({ identifier: "ToolInvocation", discriminator: "state" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ToolInvocation = Schema.Schema.Type<typeof ToolInvocation>

export const TextPart = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
})
  .annotate({ identifier: "TextPart" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type TextPart = Schema.Schema.Type<typeof TextPart>

export const ReasoningPart = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  providerMetadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
  .annotate({ identifier: "ReasoningPart" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ReasoningPart = Schema.Schema.Type<typeof ReasoningPart>

export const ToolInvocationPart = Schema.Struct({
  type: Schema.Literal("tool-invocation"),
  toolInvocation: ToolInvocation,
})
  .annotate({ identifier: "ToolInvocationPart" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ToolInvocationPart = Schema.Schema.Type<typeof ToolInvocationPart>

export const SourceUrlPart = Schema.Struct({
  type: Schema.Literal("source-url"),
  sourceId: Schema.String,
  url: Schema.String,
  title: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
  .annotate({ identifier: "SourceUrlPart" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type SourceUrlPart = Schema.Schema.Type<typeof SourceUrlPart>

export const FilePart = Schema.Struct({
  type: Schema.Literal("file"),
  mediaType: Schema.String,
  filename: Schema.optional(Schema.String),
  url: Schema.String,
})
  .annotate({ identifier: "FilePart" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type FilePart = Schema.Schema.Type<typeof FilePart>

export const StepStartPart = Schema.Struct({
  type: Schema.Literal("step-start"),
})
  .annotate({ identifier: "StepStartPart" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type StepStartPart = Schema.Schema.Type<typeof StepStartPart>

export const MessagePart = Schema.Union([
  TextPart,
  ReasoningPart,
  ToolInvocationPart,
  SourceUrlPart,
  FilePart,
  StepStartPart,
])
  .annotate({ identifier: "MessagePart", discriminator: "type" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type MessagePart = Schema.Schema.Type<typeof MessagePart>

export const Info = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  parts: Schema.Array(MessagePart),
  metadata: Schema.Struct({
    time: Schema.Struct({
      created: NonNegativeInt,
      completed: Schema.optional(NonNegativeInt),
    }),
    error: Schema.optional(Schema.Union([AuthErrorEffect, UnknownErrorEffect, OutputLengthErrorEffect])),
    sessionID: SessionID,
    tool: Schema.Record(
      Schema.String,
      Schema.StructWithRest(
        Schema.Struct({
          title: Schema.String,
          snapshot: Schema.optional(Schema.String),
          time: Schema.Struct({
            start: NonNegativeInt,
            end: NonNegativeInt,
          }),
        }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    ),
    assistant: Schema.optional(
      Schema.Struct({
        system: Schema.Array(Schema.String),
        modelID: ModelID,
        providerID: ProviderID,
        path: Schema.Struct({
          cwd: Schema.String,
          root: Schema.String,
        }),
        cost: Schema.Finite,
        summary: Schema.optional(Schema.Boolean),
        tokens: Schema.Struct({
          input: NonNegativeInt,
          output: NonNegativeInt,
          reasoning: NonNegativeInt,
          cache: Schema.Struct({
            read: NonNegativeInt,
            write: NonNegativeInt,
          }),
        }),
      }),
    ),
    snapshot: Schema.optional(Schema.String),
  }).annotate({ identifier: "MessageMetadata" }),
})
  .annotate({ identifier: "Message" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export * as Message from "./message"
