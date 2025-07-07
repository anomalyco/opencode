import z from "zod"
import { Bus } from "../bus"
import { Provider } from "../provider/provider"
import { NamedError } from "../util/error"
import { Message } from "./message"
import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai"

export namespace MessageV2 {
  export const OutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))

  export const ToolStatePending = z
    .object({
      status: z.literal("pending"),
    })
    .openapi({
      ref: "ToolStatePending",
    })

  export type ToolStatePending = z.infer<typeof ToolStatePending>

  export const ToolStateRunning = z
    .object({
      status: z.literal("running"),
      input: z.any(),
      title: z.string().optional(),
      metadata: z.record(z.any()).optional(),
      time: z.object({
        start: z.number(),
      }),
    })
    .openapi({
      ref: "ToolStateRunning",
    })
  export type ToolStateRunning = z.infer<typeof ToolStateRunning>

  export const ToolStateCompleted = z
    .object({
      status: z.literal("completed"),
      input: z.record(z.any()),
      output: z.string(),
      title: z.string(),
      metadata: z.record(z.any()),
      time: z.object({
        start: z.number(),
        end: z.number(),
      }),
    })
    .openapi({
      ref: "ToolStateCompleted",
    })
  export type ToolStateCompleted = z.infer<typeof ToolStateCompleted>

  export const ToolStateError = z
    .object({
      status: z.literal("error"),
      input: z.record(z.any()),
      error: z.string(),
      time: z.object({
        start: z.number(),
        end: z.number(),
      }),
    })
    .openapi({
      ref: "ToolStateError",
    })
  export type ToolStateError = z.infer<typeof ToolStateError>

  export const ToolState = z
    .discriminatedUnion("status", [ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError])
    .openapi({
      ref: "ToolState",
    })

  export const TextPart = z
    .object({
      type: z.literal("text"),
      text: z.string(),
    })
    .openapi({
      ref: "TextPart",
    })
  export type TextPart = z.infer<typeof TextPart>

  export const ToolPart = z
    .object({
      type: z.literal("tool"),
      id: z.string(),
      tool: z.string(),
      state: ToolState,
    })
    .openapi({
      ref: "ToolPart",
    })
  export type ToolPart = z.infer<typeof ToolPart>

  export const FilePart = z
    .object({
      type: z.literal("file"),
      mime: z.string(),
      filename: z.string().optional(),
      url: z.string(),
    })
    .openapi({
      ref: "FilePart",
    })
  export type FilePart = z.infer<typeof FilePart>

  export const StepStartPart = z
    .object({
      type: z.literal("step-start"),
    })
    .openapi({
      ref: "StepStartPart",
    })
  export type StepStartPart = z.infer<typeof StepStartPart>

  const Base = z.object({
    id: z.string(),
    sessionID: z.string(),
  })

  export const UserPart = z.discriminatedUnion("type", [TextPart, FilePart]).openapi({
    ref: "UserMessagePart",
  })
  export type UserPart = z.infer<typeof UserPart>

  export const User = Base.extend({
    role: z.literal("user"),
    parts: z.array(UserPart),
    time: z.object({
      created: z.number(),
    }),
  }).openapi({
    ref: "UserMessage",
  })
  export type User = z.infer<typeof User>

  export const AssistantPart = z.discriminatedUnion("type", [TextPart, ToolPart, StepStartPart]).openapi({
    ref: "AssistantMessagePart",
  })
  export type AssistantPart = z.infer<typeof AssistantPart>

  export const Assistant = Base.extend({
    role: z.literal("assistant"),
    parts: z.array(AssistantPart),
    time: z.object({
      created: z.number(),
      completed: z.number().optional(),
    }),
    error: z
      .discriminatedUnion("name", [Provider.AuthError.Schema, NamedError.Unknown.Schema, OutputLengthError.Schema])
      .optional(),
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
  }).openapi({
    ref: "AssistantMessage",
  })
  export type Assistant = z.infer<typeof Assistant>

  export const Info = z.discriminatedUnion("role", [User, Assistant]).openapi({
    ref: "Message",
  })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: Bus.event(
      "message.updated",
      z.object({
        info: Info,
      }),
    ),
    Removed: Bus.event(
      "message.removed",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
      }),
    ),
    PartUpdated: Bus.event(
      "message.part.updated",
      z.object({
        part: AssistantPart,
        sessionID: z.string(),
        messageID: z.string(),
      }),
    ),
  }

  export function fromV1(v1: Message.Info) {
    if (v1.role === "assistant") {
      const result: Assistant = {
        id: v1.id,
        sessionID: v1.metadata.sessionID,
        role: "assistant",
        time: {
          created: v1.metadata.time.created,
          completed: v1.metadata.time.completed,
        },
        cost: v1.metadata.assistant!.cost,
        path: v1.metadata.assistant!.path,
        summary: v1.metadata.assistant!.summary,
        tokens: v1.metadata.assistant!.tokens,
        modelID: v1.metadata.assistant!.modelID,
        providerID: v1.metadata.assistant!.providerID,
        system: v1.metadata.assistant!.system,
        error: v1.metadata.error,
        parts: v1.parts.flatMap((part): AssistantPart[] => {
          if (part.type === "text") {
            return [
              {
                type: "text",
                text: part.text,
              },
            ]
          }
          if (part.type === "step-start") {
            return [
              {
                type: "step-start",
              },
            ]
          }
          if (part.type === "tool-invocation") {
            return [
              {
                type: "tool",
                id: part.toolInvocation.toolCallId,
                tool: part.toolInvocation.toolName,
                state: (() => {
                  if (part.toolInvocation.state === "partial-call") {
                    return {
                      status: "pending",
                    }
                  }

                  const { title, time, ...metadata } = v1.metadata.tool[part.toolInvocation.toolCallId] ?? {}
                  if (part.toolInvocation.state === "call") {
                    return {
                      status: "running",
                      input: part.toolInvocation.args,
                      time: {
                        start: time?.start,
                      },
                    }
                  }

                  if (part.toolInvocation.state === "result") {
                    return {
                      status: "completed",
                      input: part.toolInvocation.args,
                      output: part.toolInvocation.result,
                      title,
                      time,
                      metadata,
                    }
                  }
                  throw new Error("unknown tool invocation state")
                })(),
              },
            ]
          }
          return []
        }),
      }
      return result
    }

    if (v1.role === "user") {
      const result: User = {
        id: v1.id,
        sessionID: v1.metadata.sessionID,
        role: "user",
        time: {
          created: v1.metadata.time.created,
        },
        parts: v1.parts.flatMap((part): UserPart[] => {
          if (part.type === "text") {
            return [
              {
                type: "text",
                text: part.text,
              },
            ]
          }
          if (part.type === "file") {
            return [
              {
                type: "file",
                mime: part.mediaType,
                filename: part.filename,
                url: part.url,
              },
            ]
          }
          return []
        }),
      }
      return result
    }
  }

  export function toModelMessage(input: Info[]): ModelMessage[] {
    const result: UIMessage[] = []

    for (const msg of input) {
      if (msg.parts.length === 0) continue
      if (msg.role === "user") {
        result.push({
          id: msg.id,
          role: "user",
          parts: msg.parts.flatMap((part): UIMessage["parts"] => {
            if (part.type === "text")
              return [
                {
                  type: "text",
                  text: part.text,
                },
              ]
            if (part.type === "file")
              return [
                {
                  type: "file",
                  url: part.url,
                  mediaType: part.mime,
                  filename: part.filename,
                },
              ]
            return []
          }),
        })
      }

      if (msg.role === "assistant") {
        result.push({
          id: msg.id,
          role: "assistant",
          parts: msg.parts.flatMap((part): UIMessage["parts"] => {
            if (part.type === "text")
              return [
                {
                  type: "text",
                  text: part.text,
                },
              ]
            if (part.type === "step-start")
              return [
                {
                  type: "step-start",
                },
              ]
            if (part.type === "tool") {
              if (part.state.status === "completed")
                return [
                  {
                    type: ("tool-" + part.tool) as `tool-${string}`,
                    state: "output-available",
                    toolCallId: part.id,
                    input: part.state.input,
                    output: part.state.output,
                  },
                ]
              if (part.state.status === "error")
                return [
                  {
                    type: ("tool-" + part.tool) as `tool-${string}`,
                    state: "output-error",
                    toolCallId: part.id,
                    input: part.state.input,
                    errorText: part.state.error,
                  },
                ]
            }

            return []
          }),
        })
      }
    }

    return convertToModelMessages(result)
  }
}
