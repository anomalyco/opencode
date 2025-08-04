import z from "zod"
import { Bus } from "../bus"
import { NamedError } from "../util/error"
import { Message } from "./message"
import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai"
import { Identifier } from "../id/id"
import { LSP } from "../lsp"

export namespace MessageV2 {
  export const OutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))
  export const AbortedError = NamedError.create("MessageAbortedError", z.object({}))
  export const AuthError = NamedError.create(
    "ProviderAuthError",
    z.object({
      providerID: z.string(),
      message: z.string(),
    }),
  )

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

  const PartBase = z.object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
  })

  export const SnapshotPart = PartBase.extend({
    type: z.literal("snapshot"),
    snapshot: z.string(),
  }).openapi({
    ref: "SnapshotPart",
  })
  export type SnapshotPart = z.infer<typeof SnapshotPart>

  export const PatchPart = PartBase.extend({
    type: z.literal("patch"),
    hash: z.string(),
    files: z.string().array(),
  }).openapi({
    ref: "PatchPart",
  })
  export type PatchPart = z.infer<typeof PatchPart>

  export const TextPart = PartBase.extend({
    type: z.literal("text"),
    text: z.string(),
    synthetic: z.boolean().optional(),
    time: z
      .object({
        start: z.number(),
        end: z.number().optional(),
      })
      .optional(),
  }).openapi({
    ref: "TextPart",
  })
  export type TextPart = z.infer<typeof TextPart>

  export const ToolPart = PartBase.extend({
    type: z.literal("tool"),
    callID: z.string(),
    tool: z.string(),
    state: ToolState,
  }).openapi({
    ref: "ToolPart",
  })
  export type ToolPart = z.infer<typeof ToolPart>

  const FilePartSourceBase = z.object({
    text: z
      .object({
        value: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      })
      .openapi({
        ref: "FilePartSourceText",
      }),
  })

  export const FileSource = FilePartSourceBase.extend({
    type: z.literal("file"),
    path: z.string(),
  }).openapi({
    ref: "FileSource",
  })

  export const SymbolSource = FilePartSourceBase.extend({
    type: z.literal("symbol"),
    path: z.string(),
    range: LSP.Range,
    name: z.string(),
    kind: z.number().int(),
  }).openapi({
    ref: "SymbolSource",
  })

  export const FilePartSource = z.discriminatedUnion("type", [FileSource, SymbolSource]).openapi({
    ref: "FilePartSource",
  })

  export const FilePart = PartBase.extend({
    type: z.literal("file"),
    mime: z.string(),
    filename: z.string().optional(),
    url: z.string(),
    source: FilePartSource.optional(),
  }).openapi({
    ref: "FilePart",
  })
  export type FilePart = z.infer<typeof FilePart>

  export const StepStartPart = PartBase.extend({
    type: z.literal("step-start"),
  }).openapi({
    ref: "StepStartPart",
  })
  export type StepStartPart = z.infer<typeof StepStartPart>

  export const StepFinishPart = PartBase.extend({
    type: z.literal("step-finish"),
    cost: z.number(),
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
    ref: "StepFinishPart",
  })
  export type StepFinishPart = z.infer<typeof StepFinishPart>

  const Base = z.object({
    id: z.string(),
    sessionID: z.string(),
  })

  export const User = Base.extend({
    role: z.literal("user"),
    time: z.object({
      created: z.number(),
    }),
  }).openapi({
    ref: "UserMessage",
  })
  export type User = z.infer<typeof User>

  export const Part = z
    .discriminatedUnion("type", [TextPart, FilePart, ToolPart, StepStartPart, StepFinishPart, SnapshotPart, PatchPart])
    .openapi({
      ref: "Part",
    })
  export type Part = z.infer<typeof Part>

  export const Assistant = Base.extend({
    role: z.literal("assistant"),
    time: z.object({
      created: z.number(),
      completed: z.number().optional(),
    }),
    error: z
      .discriminatedUnion("name", [
        AuthError.Schema,
        NamedError.Unknown.Schema,
        OutputLengthError.Schema,
        AbortedError.Schema,
      ])
      .optional(),
    system: z.string().array(),
    modelID: z.string(),
    providerID: z.string(),
    mode: z.string(),
    path: z.object({
      cwd: z.string(),
      root: z.string(),
    }),
    summary: z.boolean().optional(),
    cost: z.number(),
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
        part: Part,
      }),
    ),
    PartRemoved: Bus.event(
      "message.part.removed",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
        partID: z.string(),
      }),
    ),
  }

  export function fromV1(v1: Message.Info) {
    if (v1.role === "assistant") {
      const info: Assistant = {
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
        mode: "build",
        error: v1.metadata.error,
      }
      const parts = v1.parts.flatMap((part): Part[] => {
        const base = {
          id: Identifier.ascending("part"),
          messageID: v1.id,
          sessionID: v1.metadata.sessionID,
        }
        if (part.type === "text") {
          return [
            {
              ...base,
              type: "text",
              text: part.text,
            },
          ]
        }
        if (part.type === "step-start") {
          return [
            {
              ...base,
              type: "step-start",
            },
          ]
        }
        if (part.type === "tool-invocation") {
          return [
            {
              ...base,
              type: "tool",
              callID: part.toolInvocation.toolCallId,
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
      })
      return {
        info,
        parts,
      }
    }

    if (v1.role === "user") {
      const info: User = {
        id: v1.id,
        sessionID: v1.metadata.sessionID,
        role: "user",
        time: {
          created: v1.metadata.time.created,
        },
      }
      const parts = v1.parts.flatMap((part): Part[] => {
        const base = {
          id: Identifier.ascending("part"),
          messageID: v1.id,
          sessionID: v1.metadata.sessionID,
        }
        if (part.type === "text") {
          return [
            {
              ...base,
              type: "text",
              text: part.text,
            },
          ]
        }
        if (part.type === "file") {
          return [
            {
              ...base,
              type: "file",
              mime: part.mediaType,
              filename: part.filename,
              url: part.url,
            },
          ]
        }
        return []
      })
      return { info, parts }
    }

    throw new Error("unknown message type")
  }

  export function toModelMessage(
    input: {
      info: Info
      parts: Part[]
    }[],
  ): ModelMessage[] {
    const result: UIMessage[] = []

    for (const msg of input) {
      if (msg.parts.length === 0) continue

      if (msg.info.role === "user") {
        result.push({
          id: msg.info.id,
          role: "user",
          parts: msg.parts.flatMap((part): UIMessage["parts"] => {
            if (part.type === "text")
              return [
                {
                  type: "text",
                  text: part.text,
                },
              ]
            // text/plain files are converted into text parts, ignore them
            if (part.type === "file" && part.mime !== "text/plain")
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

      if (msg.info.role === "assistant") {
        result.push({
          id: msg.info.id,
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
                    toolCallId: part.callID,
                    input: part.state.input,
                    output: part.state.output,
                  },
                ]
              if (part.state.status === "error")
                return [
                  {
                    type: ("tool-" + part.tool) as `tool-${string}`,
                    state: "output-error",
                    toolCallId: part.callID,
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
