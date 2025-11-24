import z from "zod"
import { NamedError } from "@opencode-ai/util/error"

export namespace Message {
  export const OutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))
  export const AuthError = NamedError.create(
    "ProviderAuthError",
    z.object({
      providerID: z.string(),
      message: z.string(),
    }),
  )

  export const ToolCall = z
    .object({
      state: z.literal("call"),
      step: z.number().optional(),
      toolCallId: z.string(),
      toolName: z.string(),
      args: z.custom<Required<unknown>>(),
    })
    .meta({
      ref: "ToolCall",
    })
  export type ToolCall = z.infer<typeof ToolCall>

  export const ToolPartialCall = z
    .object({
      state: z.literal("partial-call"),
      step: z.number().optional(),
      toolCallId: z.string(),
      toolName: z.string(),
      args: z.custom<Required<unknown>>(),
    })
    .meta({
      ref: "ToolPartialCall",
    })
  export type ToolPartialCall = z.infer<typeof ToolPartialCall>

  export const ToolResult = z
    .object({
      state: z.literal("result"),
      step: z.number().optional(),
      toolCallId: z.string(),
      toolName: z.string(),
      args: z.custom<Required<unknown>>(),
      result: z.string(),
    })
    .meta({
      ref: "ToolResult",
    })
  export type ToolResult = z.infer<typeof ToolResult>

  export const ToolInvocation = z.discriminatedUnion("state", [ToolCall, ToolPartialCall, ToolResult]).meta({
    ref: "ToolInvocation",
  })
  export type ToolInvocation = z.infer<typeof ToolInvocation>

  export const TextPart = z
    .object({
      type: z.literal("text"),
      text: z.string(),
    })
    .meta({
      ref: "TextPart",
    })
  export type TextPart = z.infer<typeof TextPart>

  export const ReasoningPart = z
    .object({
      type: z.literal("reasoning"),
      text: z.string(),
      providerMetadata: z.record(z.string(), z.any()).optional(),
    })
    .meta({
      ref: "ReasoningPart",
    })
  export type ReasoningPart = z.infer<typeof ReasoningPart>

  export const ToolInvocationPart = z
    .object({
      type: z.literal("tool-invocation"),
      toolInvocation: ToolInvocation,
    })
    .meta({
      ref: "ToolInvocationPart",
    })
  export type ToolInvocationPart = z.infer<typeof ToolInvocationPart>

  export const SourceUrlPart = z
    .object({
      type: z.literal("source-url"),
      sourceId: z.string(),
      url: z.string(),
      title: z.string().optional(),
      providerMetadata: z.record(z.string(), z.any()).optional(),
    })
    .meta({
      ref: "SourceUrlPart",
    })
  export type SourceUrlPart = z.infer<typeof SourceUrlPart>

  export const FilePart = z
    .object({
      type: z.literal("file"),
      mediaType: z.string(),
      filename: z.string().optional(),
      url: z.string(),
    })
    .meta({
      ref: "FilePart",
    })
  export type FilePart = z.infer<typeof FilePart>

  export const StepStartPart = z
    .object({
      type: z.literal("step-start"),
    })
    .meta({
      ref: "StepStartPart",
    })
  export type StepStartPart = z.infer<typeof StepStartPart>

  export const MessagePart = z
    .discriminatedUnion("type", [TextPart, ReasoningPart, ToolInvocationPart, SourceUrlPart, FilePart, StepStartPart])
    .meta({
      ref: "MessagePart",
    })
  export type MessagePart = z.infer<typeof MessagePart>

  export const Info = z
    .object({
      id: z.string(),
      role: z.enum(["user", "assistant"]),
      parts: z.array(MessagePart),
      metadata: z
        .object({
          time: z.object({
            created: z.number(),
            completed: z.number().optional(),
          }),
          error: z
            .discriminatedUnion("name", [AuthError.Schema, NamedError.Unknown.Schema, OutputLengthError.Schema])
            .optional(),
          sessionID: z.string(),
          tool: z.record(
            z.string(),
            z
              .object({
                title: z.string(),
                snapshot: z.string().optional(),
                time: z.object({
                  start: z.number(),
                  end: z.number(),
                }),
              })
              .catchall(z.any()),
          ),
          assistant: z
            .object({
              system: z.string().array(),
              modelID: z.string(),
              providerID: z.string(),
              path: z.object({
                cwd: z.string(),
                root: z.string(),
              }),
              cost: z.number(),
              summary: z.boolean().optional(),
              tokens: z.object({
                input: z.number(),
                output: z.number(),
                reasoning: z.number(),
                cache: z.object({
                  read: z.number(),
                  write: z.number(),
                }),
              }),
            })
            .optional(),
          snapshot: z.string().optional(),
        })
        .meta({ ref: "MessageMetadata" }),
    })
    .meta({
      ref: "Message",
    })
  export type Info = z.infer<typeof Info>
}
