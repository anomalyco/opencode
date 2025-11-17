import z from "zod"
import { Bus } from "../bus"
import { NamedError } from "../util/error"
import { Message } from "./message"
import { APICallError, convertToModelMessages, LoadAPIKeyError, type ModelMessage, type UIMessage } from "ai"
import { Identifier } from "../id/id"
import { LSP } from "../lsp"
import { Snapshot } from "@/snapshot"
import { fn } from "@/util/fn"
import { Storage } from "@/storage/storage"

export namespace MessageV2 {
  export const OutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))
  export const AbortedError = NamedError.create("MessageAbortedError", z.object({ message: z.string() }))
  export const AuthError = NamedError.create(
    "ProviderAuthError",
    z.object({
      providerID: z.string(),
      message: z.string(),
    }),
  )
  export const APIError = NamedError.create(
    "APIError",
    z.object({
      message: z.string(),
      statusCode: z.number().optional(),
      isRetryable: z.boolean(),
      responseHeaders: z.record(z.string(), z.string()).optional(),
      responseBody: z.string().optional(),
    }),
  )
  export type APIError = z.infer<typeof APIError.Schema>

  // TODO: Apply branded types for type-safe ID handling
  // After migration:
  // - id: PartID (branded string)
  // - sessionID: SessionID (branded string)
  // - messageID: MessageID (branded string)
  // See src/util/branded-types.ts for branded type utilities
  const PartBase = z.object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
  })

  export const SnapshotPart = PartBase.extend({
    type: z.literal("snapshot"),
    snapshot: z.string(),
  }).meta({
    ref: "SnapshotPart",
  })
  export type SnapshotPart = z.infer<typeof SnapshotPart>

  export const PatchPart = PartBase.extend({
    type: z.literal("patch"),
    hash: z.string(),
    files: z.string().array(),
  }).meta({
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
    metadata: z.record(z.string(), z.any()).optional(),
  }).meta({
    ref: "TextPart",
  })
  export type TextPart = z.infer<typeof TextPart>

  export const ReasoningPart = PartBase.extend({
    type: z.literal("reasoning"),
    text: z.string(),
    metadata: z.record(z.string(), z.any()).optional(),
    time: z.object({
      start: z.number(),
      end: z.number().optional(),
    }),
  }).meta({
    ref: "ReasoningPart",
  })
  export type ReasoningPart = z.infer<typeof ReasoningPart>

  const FilePartSourceBase = z.object({
    text: z
      .object({
        value: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      })
      .meta({
        ref: "FilePartSourceText",
      }),
  })

  export const FileSource = FilePartSourceBase.extend({
    type: z.literal("file"),
    path: z.string(),
  }).meta({
    ref: "FileSource",
  })

  export const SymbolSource = FilePartSourceBase.extend({
    type: z.literal("symbol"),
    path: z.string(),
    range: LSP.Range,
    name: z.string(),
    kind: z.number().int(),
  }).meta({
    ref: "SymbolSource",
  })

  export const FilePartSource = z.discriminatedUnion("type", [FileSource, SymbolSource]).meta({
    ref: "FilePartSource",
  })

  export const FilePart = PartBase.extend({
    type: z.literal("file"),
    mime: z.string(),
    filename: z.string().optional(),
    url: z.string(),
    source: FilePartSource.optional(),
  }).meta({
    ref: "FilePart",
  })
  export type FilePart = z.infer<typeof FilePart>

  export const AgentPart = PartBase.extend({
    type: z.literal("agent"),
    name: z.string(),
    source: z
      .object({
        value: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      })
      .optional(),
  }).meta({
    ref: "AgentPart",
  })
  export type AgentPart = z.infer<typeof AgentPart>

  export const RetryPart = PartBase.extend({
    type: z.literal("retry"),
    attempt: z.number(),
    error: APIError.Schema,
    time: z.object({
      created: z.number(),
    }),
  }).meta({
    ref: "RetryPart",
  })
  export type RetryPart = z.infer<typeof RetryPart>

  export const StepStartPart = PartBase.extend({
    type: z.literal("step-start"),
    snapshot: z.string().optional(),
  }).meta({
    ref: "StepStartPart",
  })
  export type StepStartPart = z.infer<typeof StepStartPart>

  export const StepFinishPart = PartBase.extend({
    type: z.literal("step-finish"),
    reason: z.string(),
    snapshot: z.string().optional(),
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
  }).meta({
    ref: "StepFinishPart",
  })
  export type StepFinishPart = z.infer<typeof StepFinishPart>

  export const ToolStatePending = z
    .object({
      status: z.literal("pending"),
      input: z.record(z.string(), z.any()),
      raw: z.string(),
    })
    .meta({
      ref: "ToolStatePending",
    })

  export type ToolStatePending = z.infer<typeof ToolStatePending>

  export const ToolStateRunning = z
    .object({
      status: z.literal("running"),
      input: z.record(z.string(), z.any()),
      title: z.string().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      time: z.object({
        start: z.number(),
      }),
    })
    .meta({
      ref: "ToolStateRunning",
    })
  export type ToolStateRunning = z.infer<typeof ToolStateRunning>

  export const ToolStateCompleted = z
    .object({
      status: z.literal("completed"),
      input: z.record(z.string(), z.any()),
      output: z.string(),
      title: z.string(),
      metadata: z.record(z.string(), z.any()),
      time: z.object({
        start: z.number(),
        end: z.number(),
        compacted: z.number().optional(),
      }),
      attachments: FilePart.array().optional(),
    })
    .meta({
      ref: "ToolStateCompleted",
    })
  export type ToolStateCompleted = z.infer<typeof ToolStateCompleted>

  export const ToolStateError = z
    .object({
      status: z.literal("error"),
      input: z.record(z.string(), z.any()),
      error: z.string(),
      metadata: z.record(z.string(), z.any()).optional(),
      time: z.object({
        start: z.number(),
        end: z.number(),
      }),
    })
    .meta({
      ref: "ToolStateError",
    })
  export type ToolStateError = z.infer<typeof ToolStateError>

  export const ToolState = z
    .discriminatedUnion("status", [ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError])
    .meta({
      ref: "ToolState",
    })

  // TODO: callID should use ToolCallID branded type
  // After migration: callID: ToolCallID (branded string)
  export const ToolPart = PartBase.extend({
    type: z.literal("tool"),
    callID: z.string(),
    tool: z.string(),
    state: ToolState,
    metadata: z.record(z.string(), z.any()).optional(),
  }).meta({
    ref: "ToolPart",
  })
  export type ToolPart = z.infer<typeof ToolPart>

  // TODO: Apply branded types for type-safe ID handling
  // After migration:
  // - id: MessageID (branded string)
  // - sessionID: SessionID (branded string)
  // See src/util/branded-types.ts for branded type utilities
  const Base = z.object({
    id: z.string(),
    sessionID: z.string(),
  })

  export const User = Base.extend({
    role: z.literal("user"),
    time: z.object({
      created: z.number(),
    }),
    summary: z
      .object({
        title: z.string().optional(),
        body: z.string().optional(),
        diffs: Snapshot.FileDiff.array(),
      })
      .optional(),
    priority: z.enum(["red", "amber", "green", "none"]).optional(),
  }).meta({
    ref: "UserMessage",
  })
  export type User = z.infer<typeof User>

  export const Part = z
    .discriminatedUnion("type", [
      TextPart,
      ReasoningPart,
      FilePart,
      ToolPart,
      StepStartPart,
      StepFinishPart,
      SnapshotPart,
      PatchPart,
      AgentPart,
      RetryPart,
    ])
    .meta({
      ref: "Part",
    })
  export type Part = z.infer<typeof Part>

  // TODO: parentID should use MessageID branded type
  // After migration: parentID: MessageID (branded string)
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
        APIError.Schema,
      ])
      .optional(),
    parentID: z.string(),
    modelID: z.string(),
    providerID: z.string(),
    mode: z.string(),
    path: z.object({
      cwd: z.string(),
      root: z.string(),
    }),
    summary: z.boolean().optional(),
    priority: z.enum(["red", "amber", "green", "none"]).optional(),
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
  }).meta({
    ref: "AssistantMessage",
  })
  export type Assistant = z.infer<typeof Assistant>

  export const Info = z.discriminatedUnion("role", [User, Assistant]).meta({
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
        delta: z.string().optional(),
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

  export const WithParts = z.object({
    info: Info,
    parts: z.array(Part),
  })
  export type WithParts = z.infer<typeof WithParts>

  export function fromV1(v1: Message.Info) {
    if (v1.role === "assistant") {
      const info: Assistant = {
        id: v1.id,
        parentID: "",
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
        mode: "general",
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
                    input: {},
                    raw: "",
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
            // text/plain and directory files are converted into text parts, ignore them
            if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory")
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
                  providerMetadata: part.metadata,
                },
              ]
            if (part.type === "step-start")
              return [
                {
                  type: "step-start",
                },
              ]
            if (part.type === "tool") {
              if (part.state.status === "completed") {
                if (part.state.attachments?.length) {
                  result.push({
                    id: Identifier.ascending("message"),
                    role: "user",
                    parts: [
                      {
                        type: "text",
                        text: `Tool ${part.tool} returned an attachment:`,
                      },
                      ...part.state.attachments.map((attachment) => ({
                        type: "file" as const,
                        url: attachment.url,
                        mediaType: attachment.mime,
                        filename: attachment.filename,
                      })),
                    ],
                  })
                }
                return [
                  {
                    type: ("tool-" + part.tool) as `tool-${string}`,
                    state: "output-available",
                    toolCallId: part.callID,
                    input: part.state.input,
                    output: part.state.time.compacted ? "[Old tool result content cleared]" : part.state.output,
                    callProviderMetadata: part.metadata,
                  },
                ]
              }
              if (part.state.status === "error")
                return [
                  {
                    type: ("tool-" + part.tool) as `tool-${string}`,
                    state: "output-error",
                    toolCallId: part.callID,
                    input: part.state.input,
                    errorText: part.state.error,
                    callProviderMetadata: part.metadata,
                  },
                ]
            }
            if (part.type === "reasoning") {
              // Provider APIs reject reasoning content in prompts, so skip it
              return []
            }

            return []
          }),
        })
      }
    }

    return convertToModelMessages(result)
  }

  export const stream = fn(Identifier.schema("session"), async function* (sessionID) {
    const list = await Array.fromAsync(await Storage.list(["message", sessionID]))
    for (let i = list.length - 1; i >= 0; i--) {
      yield await get({
        sessionID,
        messageID: list[i][2],
      })
    }
  })

  export const parts = fn(Identifier.schema("message"), async (messageID) => {
    const result = [] as MessageV2.Part[]
    for (const item of await Storage.list(["part", messageID])) {
      const read = await Storage.read<MessageV2.Part>(item)
      result.push(read)
    }
    result.sort((a, b) => (a.id > b.id ? 1 : -1))
    return result
  })

  export const get = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
    }),
    async (input) => {
      return {
        info: await Storage.read<MessageV2.Info>(["message", input.sessionID, input.messageID]),
        parts: await parts(input.messageID),
      }
    },
  )

  export async function filterCompacted(stream: AsyncIterable<MessageV2.WithParts>) {
    const result = [] as MessageV2.WithParts[]
    let foundSummary = false
    for await (const msg of stream) {
      // Always include red and amber priority messages, even after summary
      if (msg.info.priority === "red" || msg.info.priority === "amber") {
        result.push(msg)
        continue
      }
      // Skip green priority messages after summary (these get removed during compaction)
      if (foundSummary && msg.info.priority === "green") {
        continue
      }
      result.push(msg)
      if (msg.info.role === "assistant" && msg.info.summary === true) {
        foundSummary = true
        break
      }
    }
    result.reverse()
    return result
  }

  export function fromError(e: unknown, ctx: { providerID: string }) {
    switch (true) {
      case e instanceof DOMException && e.name === "AbortError":
        return new MessageV2.AbortedError(
          { message: e.message },
          {
            cause: e,
          },
        ).toObject()
      case MessageV2.OutputLengthError.isInstance(e):
        return e
      case LoadAPIKeyError.isInstance(e):
        return new MessageV2.AuthError(
          {
            providerID: ctx.providerID,
            message: e.message,
          },
          { cause: e },
        ).toObject()
      case APICallError.isInstance(e):
        return new MessageV2.APIError(
          {
            message: e.message,
            statusCode: e.statusCode,
            isRetryable: e.isRetryable,
            responseHeaders: e.responseHeaders,
            responseBody: e.responseBody,
          },
          { cause: e },
        ).toObject()
      case e instanceof Error:
        return new NamedError.Unknown({ message: e.toString() }, { cause: e }).toObject()
      default:
        return new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e })
    }
  }

  // Type guard functions for Part discriminated union
  export function isTextPart(part: Part): part is TextPart {
    return part.type === "text"
  }

  export function isReasoningPart(part: Part): part is ReasoningPart {
    return part.type === "reasoning"
  }

  export function isFilePart(part: Part): part is FilePart {
    return part.type === "file"
  }

  export function isToolPart(part: Part): part is ToolPart {
    return part.type === "tool"
  }

  export function isStepStartPart(part: Part): part is StepStartPart {
    return part.type === "step-start"
  }

  export function isStepFinishPart(part: Part): part is StepFinishPart {
    return part.type === "step-finish"
  }

  export function isSnapshotPart(part: Part): part is SnapshotPart {
    return part.type === "snapshot"
  }

  export function isPatchPart(part: Part): part is PatchPart {
    return part.type === "patch"
  }

  export function isAgentPart(part: Part): part is AgentPart {
    return part.type === "agent"
  }

  export function isRetryPart(part: Part): part is RetryPart {
    return part.type === "retry"
  }

  // Type guard functions for Message roles
  export function isUserMessage(msg: Info): msg is User {
    return msg.role === "user"
  }

  export function isAssistantMessage(msg: Info): msg is Assistant {
    return msg.role === "assistant"
  }

  // Type guard functions for ToolState discriminated union
  export function isToolStatePending(state: z.infer<typeof ToolState>): state is ToolStatePending {
    return state.status === "pending"
  }

  export function isToolStateRunning(state: z.infer<typeof ToolState>): state is ToolStateRunning {
    return state.status === "running"
  }

  export function isToolStateCompleted(state: z.infer<typeof ToolState>): state is ToolStateCompleted {
    return state.status === "completed"
  }

  export function isToolStateError(state: z.infer<typeof ToolState>): state is ToolStateError {
    return state.status === "error"
  }

  // Helper functions for extracting specific parts
  export function getTextParts(parts: Part[]): TextPart[] {
    return parts.filter(isTextPart)
  }

  export function getReasoningParts(parts: Part[]): ReasoningPart[] {
    return parts.filter(isReasoningPart)
  }

  export function getFileParts(parts: Part[]): FilePart[] {
    return parts.filter(isFilePart)
  }

  export function getToolParts(parts: Part[]): ToolPart[] {
    return parts.filter(isToolPart)
  }

  export function getStepStartParts(parts: Part[]): StepStartPart[] {
    return parts.filter(isStepStartPart)
  }

  export function getStepFinishParts(parts: Part[]): StepFinishPart[] {
    return parts.filter(isStepFinishPart)
  }

  export function getSnapshotParts(parts: Part[]): SnapshotPart[] {
    return parts.filter(isSnapshotPart)
  }

  export function getPatchParts(parts: Part[]): PatchPart[] {
    return parts.filter(isPatchPart)
  }

  export function getAgentParts(parts: Part[]): AgentPart[] {
    return parts.filter(isAgentPart)
  }

  export function getRetryParts(parts: Part[]): RetryPart[] {
    return parts.filter(isRetryPart)
  }

  // Helper to get the first part of a specific type
  export function getFirstTextPart(parts: Part[]): TextPart | undefined {
    return parts.find(isTextPart)
  }

  export function getFirstToolPart(parts: Part[]): ToolPart | undefined {
    return parts.find(isToolPart)
  }

  export function getFirstFilePart(parts: Part[]): FilePart | undefined {
    return parts.find(isFilePart)
  }

  // Helper to check if parts contain a specific type
  export function hasTextPart(parts: Part[]): boolean {
    return parts.some(isTextPart)
  }

  export function hasToolPart(parts: Part[]): boolean {
    return parts.some(isToolPart)
  }

  export function hasFilePart(parts: Part[]): boolean {
    return parts.some(isFilePart)
  }

  export function hasReasoningPart(parts: Part[]): boolean {
    return parts.some(isReasoningPart)
  }

  // Helper to get completed tool parts
  export function getCompletedToolParts(parts: Part[]): ToolPart[] {
    return getToolParts(parts).filter((part) => part.state.status === "completed")
  }

  // Helper to get error tool parts
  export function getErrorToolParts(parts: Part[]): ToolPart[] {
    return getToolParts(parts).filter((part) => part.state.status === "error")
  }

  // Helper to get running tool parts
  export function getRunningToolParts(parts: Part[]): ToolPart[] {
    return getToolParts(parts).filter((part) => part.state.status === "running")
  }

  // Helper to get pending tool parts
  export function getPendingToolParts(parts: Part[]): ToolPart[] {
    return getToolParts(parts).filter((part) => part.state.status === "pending")
  }
}
