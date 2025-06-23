import z from "zod"
import { Bus } from "../bus"
import { Provider } from "../provider/provider"
import { NamedError } from "../util/error"

export namespace Message {
  export const ToolCall = z
    .object({
      state: z.literal("call"),
      step: z.number().optional(),
      toolCallId: z.string(),
      toolName: z.string(),
      args: z.custom<Required<unknown>>(),
    })
    .openapi({
      ref: "Message.ToolInvocation.ToolCall",
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
    .openapi({
      ref: "Message.ToolInvocation.ToolPartialCall",
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
    .openapi({
      ref: "Message.ToolInvocation.ToolResult",
    })
  export type ToolResult = z.infer<typeof ToolResult>

  export const ToolInvocation = z
    .discriminatedUnion("state", [ToolCall, ToolPartialCall, ToolResult])
    .openapi({
      ref: "Message.ToolInvocation",
    })
  export type ToolInvocation = z.infer<typeof ToolInvocation>

  export const TextPart = z
    .object({
      type: z.literal("text"),
      text: z.string(),
    })
    .openapi({
      ref: "Message.Part.Text",
    })
  export type TextPart = z.infer<typeof TextPart>

  export const ReasoningPart = z
    .object({
      type: z.literal("reasoning"),
      text: z.string(),
      providerMetadata: z.record(z.any()).optional(),
    })
    .openapi({
      ref: "Message.Part.Reasoning",
    })
  export type ReasoningPart = z.infer<typeof ReasoningPart>

  export const ToolInvocationPart = z
    .object({
      type: z.literal("tool-invocation"),
      toolInvocation: ToolInvocation,
    })
    .openapi({
      ref: "Message.Part.ToolInvocation",
    })
  export type ToolInvocationPart = z.infer<typeof ToolInvocationPart>

  export const SourceUrlPart = z
    .object({
      type: z.literal("source-url"),
      sourceId: z.string(),
      url: z.string(),
      title: z.string().optional(),
      providerMetadata: z.record(z.any()).optional(),
    })
    .openapi({
      ref: "Message.Part.SourceUrl",
    })
  export type SourceUrlPart = z.infer<typeof SourceUrlPart>

  export const FilePart = z
    .object({
      type: z.literal("file"),
      mediaType: z.string(),
      filename: z.string().optional(),
      url: z.string(),
    })
    .openapi({
      ref: "Message.Part.File",
    })
  export type FilePart = z.infer<typeof FilePart>

  export const StepStartPart = z
    .object({
      type: z.literal("step-start"),
    })
    .openapi({
      ref: "Message.Part.StepStart",
    })
  export type StepStartPart = z.infer<typeof StepStartPart>

  export const Part = z
    .discriminatedUnion("type", [
      TextPart,
      ReasoningPart,
      ToolInvocationPart,
      SourceUrlPart,
      FilePart,
      StepStartPart,
    ])
    .openapi({
      ref: "Message.Part",
    })
  export type Part = z.infer<typeof Part>

  export const Info = z
    .object({
      id: z.string(),
      role: z.enum(["user", "assistant"]),
      parts: z.array(Part),
      metadata: z
        .object({
          time: z.object({
            created: z.number(),
            completed: z.number().optional(),
          }),
          error: z
            .discriminatedUnion("name", [
              Provider.AuthError.Schema,
              NamedError.Unknown.Schema,
            ])
            .optional(),
          sessionID: z.string(),
          tool: z.record(
            z.string(),
            z
              .object({
                title: z.string(),
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
        })
        .openapi({ ref: "Message.Metadata" }),
    })
    .openapi({
      ref: "Message.Info",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: Bus.event(
      "message.updated",
      z.object({
        info: Info,
      }),
    ),
    PartUpdated: Bus.event(
      "message.part.updated",
      z.object({ part: Part, sessionID: z.string(), messageID: z.string() }),
    ),
  }
}
