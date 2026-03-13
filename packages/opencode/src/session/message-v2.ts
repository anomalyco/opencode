import { BusEvent } from "@/bus/bus-event"
import { SessionID, MessageID, PartID } from "./schema"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { APICallError, convertToModelMessages, LoadAPIKeyError, type ModelMessage, type UIMessage } from "ai"
import { LSP } from "../lsp"
import { Snapshot } from "@/snapshot"
import { fn } from "@/util/fn"
import { Database, eq, desc, inArray } from "@/storage/db"
import { MessageTable, PartTable } from "./session.sql"
import { ProviderTransform } from "@/provider/transform"
import { STATUS_CODES } from "http"
import { Storage } from "@/storage/storage"
import { ProviderError } from "@/provider/error"
import { iife } from "@/util/iife"
import { type SystemError } from "bun"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"

export namespace MessageV2 {
  export function isMedia(mime: string) {
    return mime.startsWith("image/") || mime === "application/pdf"
  }

  export const OutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))
  export const AbortedError = NamedError.create("MessageAbortedError", z.object({ message: z.string() }))
  export const StructuredOutputError = NamedError.create(
    "StructuredOutputError",
    z.object({
      message: z.string(),
      retries: z.number(),
    }),
  )
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
      metadata: z.record(z.string(), z.string()).optional(),
    }),
  )
  export type APIError = z.infer<typeof APIError.Schema>
  export const ContextOverflowError = NamedError.create(
    "ContextOverflowError",
    z.object({ message: z.string(), responseBody: z.string().optional() }),
  )

  export const OutputFormatText = z
    .object({
      type: z.literal("text"),
    })
    .meta({
      ref: "OutputFormatText",
    })

  export const OutputFormatJsonSchema = z
    .object({
      type: z.literal("json_schema"),
      schema: z.record(z.string(), z.any()).meta({ ref: "JSONSchema" }),
      retryCount: z.number().int().min(0).default(2),
    })
    .meta({
      ref: "OutputFormatJsonSchema",
    })

  export const Format = z.discriminatedUnion("type", [OutputFormatText, OutputFormatJsonSchema]).meta({
    ref: "OutputFormat",
  })
  export type OutputFormat = z.infer<typeof Format>

  const PartBase = z.object({
    id: PartID.zod,
    sessionID: SessionID.zod,
    messageID: MessageID.zod,
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
    ignored: z.boolean().optional(),
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

  export const ResourceSource = FilePartSourceBase.extend({
    type: z.literal("resource"),
    clientName: z.string(),
    uri: z.string(),
  }).meta({
    ref: "ResourceSource",
  })

  export const FilePartSource = z.discriminatedUnion("type", [FileSource, SymbolSource, ResourceSource]).meta({
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

  export const CompactionPart = PartBase.extend({
    type: z.literal("compaction"),
    auto: z.boolean(),
    overflow: z.boolean().optional(),
  }).meta({
    ref: "CompactionPart",
  })
  export type CompactionPart = z.infer<typeof CompactionPart>

  export const SubtaskPart = PartBase.extend({
    type: z.literal("subtask"),
    prompt: z.string(),
    description: z.string(),
    agent: z.string(),
    model: z
      .object({
        providerID: ProviderID.zod,
        modelID: ModelID.zod,
      })
      .optional(),
    command: z.string().optional(),
  }).meta({
    ref: "SubtaskPart",
  })
  export type SubtaskPart = z.infer<typeof SubtaskPart>

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
      total: z.number().optional(),
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

  const Base = z.object({
    id: MessageID.zod,
    sessionID: SessionID.zod,
  })

  export const User = Base.extend({
    role: z.literal("user"),
    time: z.object({
      created: z.number(),
    }),
    format: Format.optional(),
    summary: z
      .object({
        title: z.string().optional(),
        body: z.string().optional(),
        diffs: Snapshot.FileDiff.array(),
      })
      .optional(),
    agent: z.string(),
    model: z.object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    }),
    system: z.string().optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    variant: z.string().optional(),
  }).meta({
    ref: "UserMessage",
  })
  export type User = z.infer<typeof User>

  export const Part = z
    .discriminatedUnion("type", [
      TextPart,
      SubtaskPart,
      ReasoningPart,
      FilePart,
      ToolPart,
      StepStartPart,
      StepFinishPart,
      SnapshotPart,
      PatchPart,
      AgentPart,
      RetryPart,
      CompactionPart,
    ])
    .meta({
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
        StructuredOutputError.Schema,
        ContextOverflowError.Schema,
        APIError.Schema,
      ])
      .optional(),
    parentID: MessageID.zod,
    modelID: ModelID.zod,
    providerID: ProviderID.zod,
    /**
     * @deprecated
     */
    mode: z.string(),
    agent: z.string(),
    path: z.object({
      cwd: z.string(),
      root: z.string(),
    }),
    summary: z.boolean().optional(),
    cost: z.number(),
    tokens: z.object({
      total: z.number().optional(),
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
    }),
    structured: z.any().optional(),
    variant: z.string().optional(),
    finish: z.string().optional(),
  }).meta({
    ref: "AssistantMessage",
  })
  export type Assistant = z.infer<typeof Assistant>

  export const Info = z.discriminatedUnion("role", [User, Assistant]).meta({
    ref: "Message",
  })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "message.updated",
      z.object({
        info: Info,
      }),
    ),
    Removed: BusEvent.define(
      "message.removed",
      z.object({
        sessionID: SessionID.zod,
        messageID: MessageID.zod,
      }),
    ),
    PartUpdated: BusEvent.define(
      "message.part.updated",
      z.object({
        part: Part,
      }),
    ),
    PartDelta: BusEvent.define(
      "message.part.delta",
      z.object({
        sessionID: SessionID.zod,
        messageID: MessageID.zod,
        partID: PartID.zod,
        field: z.string(),
        delta: z.string(),
      }),
    ),
    PartRemoved: BusEvent.define(
      "message.part.removed",
      z.object({
        sessionID: SessionID.zod,
        messageID: MessageID.zod,
        partID: PartID.zod,
      }),
    ),
  }

  export const WithParts = z.object({
    info: Info,
    parts: z.array(Part),
  })
  export type WithParts = z.infer<typeof WithParts>

  export function toModelMessages(
    input: WithParts[],
    model: Provider.Model,
    options?: { stripMedia?: boolean },
  ): ModelMessage[] {
    // Solution A: the agent prompts (see session/prompt/*) now explicitly
    // tell the model to start each `<tool_call>` on a fresh line.  This helps
    // avoid the problem in the first place.
    // Solution B: some tool callers still forget and stick the tag immediately
    // after text. the underlying parser in the AI SDK only recognizes a tool
    // call if it begins on a new line, so we sanitize the text by inserting a
    // newline whenever a tool call tag appears immediately after non-newline
    // content.
    const msgs = input.map((m) => ({ ...m, parts: [...m.parts] }))
    for (const msg of msgs) {
      for (const part of msg.parts) {
        if (part.type === "text" && typeof part.text === "string") {
          part.text = part.text.replace(/([^\n])(<tool_call>)/g, "$1\n$2")
        }
      }
    }

    const result: UIMessage[] = []
    const names = new Set<string>()
    // Track media from tool results that need to be injected as user messages
    // for providers that don't support media in tool results.
    //
    // OpenAI-compatible APIs only support string content in tool results, so we need
    // to extract media and inject as user messages. Other SDKs (anthropic, google,
    // bedrock) handle type: "content" with media parts natively.
    //
    // Only apply this workaround if the model actually supports image input -
    // otherwise there's no point extracting images.
    const supportsMediaInToolResults = (() => {
      if (model.api.npm === "@ai-sdk/anthropic") return true
      if (model.api.npm === "@ai-sdk/openai") return true
      if (model.api.npm === "@ai-sdk/amazon-bedrock") return true
      if (model.api.npm === "@ai-sdk/google-vertex/anthropic") return true
      if (model.api.npm === "@ai-sdk/google") {
        const id = model.api.id.toLowerCase()
        return id.includes("gemini-3") && !id.includes("gemini-2")
      }
      return false
    })()

    const toModelOutput = (output: unknown) => {
      if (typeof output === "string") {
        return { type: "text", value: output }
      }

      if (typeof output === "object") {
        const outputObject = output as {
          text: string
          attachments?: Array<{ mime: string; url: string }>
        }
        const attachments = (outputObject.attachments ?? []).filter((attachment) => {
          return attachment.url.startsWith("data:") && attachment.url.includes(",")
        })

        return {
          type: "content",
          value: [
            { type: "text", text: outputObject.text },
            ...attachments.map((attachment) => ({
              type: "media",
              mediaType: attachment.mime,
              data: iife(() => {
                const commaIndex = attachment.url.indexOf(",")
                return commaIndex === -1 ? attachment.url : attachment.url.slice(commaIndex + 1)
              }),
            })),
          ],
        }
      }

      return { type: "json", value: output as never }
    }

    for (const msg of msgs) {
      if (msg.parts.length === 0) continue

      if (msg.info.role === "user") {
        let content: string | Array<{ type: string; [key: string]: unknown }> | undefined
        for (const p of msg.parts) {
          if (p.type === "text" && !p.ignored) {
            content = content === undefined ? p.text : (typeof content === "string" ? content + p.text : [...content, { type: "text", text: p.text }])
          }
          if (p.type === "file" && p.mime !== "text/plain" && p.mime !== "application/x-directory") {
            const txt = options?.stripMedia && isMedia(p.mime) ? `[Attached ${p.mime}: ${p.filename ?? "file"}]` : undefined
            const file = txt ? undefined : { type: "file" as const, url: p.url, mediaType: p.mime, filename: p.filename }
            if (txt) {
              content = content === undefined ? txt : (typeof content === "string" ? content + txt : [...content, { type: "text", text: txt }])
            }
            if (file) {
              content = content === undefined ? [file] : (typeof content === "string" ? [{ type: "text", text: content }, file] : [...content, file])
            }
          }
          if (p.type === "compaction") {
            const txt = "What did we do so far?"
            content = content === undefined ? txt : (typeof content === "string" ? content + txt : [...content, { type: "text", text: txt }])
          }
          if (p.type === "subtask") {
            const txt = "The following tool was executed by the user"
            content = content === undefined ? txt : (typeof content === "string" ? content + txt : [...content, { type: "text", text: txt }])
          }
        }
        if (content !== undefined) {
          result.push({ id: msg.info.id, role: "user", content })
        }
      }

      if (msg.info.role === "assistant") {
        const diff = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
        const media: Array<{ mime: string; url: string }> = []

        if (msg.info.error && !(MessageV2.AbortedError.isInstance(msg.info.error) && msg.parts.some((p) => p.type !== "step-start" && p.type !== "reasoning"))) {
          continue
        }

        const msg_out: UIMessage = { id: msg.info.id, role: "assistant", content: [] }
        for (const p of msg.parts) {
          if (p.type === "text") {
            msg_out.content.push({ type: "text", text: p.text, ...(diff ? {} : { providerMetadata: p.metadata }) })
          }
          if (p.type === "step-start") {
            msg_out.content.push({ type: "step-start" })
          }
          if (p.type === "tool") {
            names.add(p.tool)
            if (p.state.status === "completed") {
              const txt = p.state.time.compacted ? "[Old tool result content cleared]" : p.state.output
              const attach = p.state.time.compacted || options?.stripMedia ? [] : (p.state.attachments ?? [])
              const media_attach = attach.filter((a) => isMedia(a.mime))
              const no_media = attach.filter((a) => !isMedia(a.mime))
              if (!supportsMediaInToolResults && media_attach.length > 0) {
                media.push(...media_attach)
              }
              const final = supportsMediaInToolResults ? attach : no_media
              const out = final.length > 0 ? { text: txt, attachments: final } : txt
              msg_out.content.push({
                type: (`tool-${p.tool}`) as `tool-${string}`,
                state: "output-available",
                toolCallId: p.callID,
                input: p.state.input,
                output: out,
                ...(diff ? {} : { callProviderMetadata: p.metadata }),
              })
            }
            if (p.state.status === "error") {
              msg_out.content.push({
                type: (`tool-${p.tool}`) as `tool-${string}`,
                state: "output-error",
                toolCallId: p.callID,
                input: p.state.input,
                errorText: p.state.error,
                ...(diff ? {} : { callProviderMetadata: p.metadata }),
              })
            }
            if (p.state.status === "pending" || p.state.status === "running") {
              msg_out.content.push({
                type: (`tool-${p.tool}`) as `tool-${string}`,
                state: "output-error",
                toolCallId: p.callID,
                input: p.state.input,
                errorText: "[Tool execution was interrupted]",
                ...(diff ? {} : { callProviderMetadata: p.metadata }),
              })
            }
          }
          if (p.type === "reasoning") {
            msg_out.content.push({ type: "reasoning", text: p.text, ...(diff ? {} : { providerMetadata: p.metadata }) })
          }
        }
        if (Array.isArray(msg_out.content) && msg_out.content.length > 0) {
          result.push(msg_out)
          if (media.length > 0) {
            result.push({
              id: MessageID.ascending(),
              role: "user",
              content: [{ type: "text", text: "Attached image(s) from tool result:" }, ...media.map((a) => ({ type: "file" as const, url: a.url, mediaType: a.mime }))],
            })
          }
        }
      }
    }

    const tools = Object.fromEntries(Array.from(names).map((name) => [name, { toModelOutput }]))
    const isValid = (msg: UIMessage) => {
      const c = msg.content
      return c !== undefined && (typeof c === "string" ? c.length > 0 : Array.isArray(c) && c.length > 0 && c.some((p) => p.type !== "step-start"))
    }
    return convertToModelMessages(result.filter(isValid), {
      //@ts-expect-error
      tools,
    })
  }

  export const stream = fn(SessionID.zod, async function* (sessionID) {
    const size = 50
    let offset = 0
    while (true) {
      const rows = Database.use((db) =>
        db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.session_id, sessionID))
          .orderBy(desc(MessageTable.time_created))
          .limit(size)
          .offset(offset)
          .all(),
      )
      if (rows.length === 0) break

      const ids = rows.map((row) => row.id)
      const partsByMessage = new Map<string, MessageV2.Part[]>()
      if (ids.length > 0) {
        const partRows = Database.use((db) =>
          db
            .select()
            .from(PartTable)
            .where(inArray(PartTable.message_id, ids))
            .orderBy(PartTable.message_id, PartTable.id)
            .all(),
        )
        for (const row of partRows) {
          const part = {
            ...row.data,
            id: row.id,
            sessionID: row.session_id,
            messageID: row.message_id,
          } as MessageV2.Part
          const list = partsByMessage.get(row.message_id)
          if (list) list.push(part)
          else partsByMessage.set(row.message_id, [part])
        }
      }

      for (const row of rows) {
        const info = { ...row.data, id: row.id, sessionID: row.session_id } as MessageV2.Info
        yield {
          info,
          parts: partsByMessage.get(row.id) ?? [],
        }
      }

      offset += rows.length
      if (rows.length < size) break
    }
  })

  export const parts = fn(MessageID.zod, async (message_id) => {
    const rows = Database.use((db) =>
      db.select().from(PartTable).where(eq(PartTable.message_id, message_id)).orderBy(PartTable.id).all(),
    )
    return rows.map(
      (row) => ({ ...row.data, id: row.id, sessionID: row.session_id, messageID: row.message_id }) as MessageV2.Part,
    )
  })

  export const get = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
    }),
    async (input): Promise<WithParts> => {
      const row = Database.use((db) => db.select().from(MessageTable).where(eq(MessageTable.id, input.messageID)).get())
      if (!row) throw new Error(`Message not found: ${input.messageID}`)
      const info = { ...row.data, id: row.id, sessionID: row.session_id } as MessageV2.Info
      return {
        info,
        parts: await parts(input.messageID),
      }
    },
  )

  export async function filterCompacted(stream: AsyncIterable<MessageV2.WithParts>) {
    const result = [] as MessageV2.WithParts[]
    const completed = new Set<string>()
    for await (const msg of stream) {
      result.push(msg)
      if (
        msg.info.role === "user" &&
        completed.has(msg.info.id) &&
        msg.parts.some((part) => part.type === "compaction")
      )
        break
      if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish && !msg.info.error)
        completed.add(msg.info.parentID)
    }
    result.reverse()
    return result
  }

  export function fromError(e: unknown, ctx: { providerID: ProviderID }): NonNullable<Assistant["error"]> {
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
      case (e as SystemError)?.code === "ECONNRESET":
        return new MessageV2.APIError(
          {
            message: "Connection reset by server",
            isRetryable: true,
            metadata: {
              code: (e as SystemError).code ?? "",
              syscall: (e as SystemError).syscall ?? "",
              message: (e as SystemError).message ?? "",
            },
          },
          { cause: e },
        ).toObject()
      case APICallError.isInstance(e):
        const parsed = ProviderError.parseAPICallError({
          providerID: ctx.providerID,
          error: e,
        })
        if (parsed.type === "context_overflow") {
          return new MessageV2.ContextOverflowError(
            {
              message: parsed.message,
              responseBody: parsed.responseBody,
            },
            { cause: e },
          ).toObject()
        }

        return new MessageV2.APIError(
          {
            message: parsed.message,
            statusCode: parsed.statusCode,
            isRetryable: parsed.isRetryable,
            responseHeaders: parsed.responseHeaders,
            responseBody: parsed.responseBody,
            metadata: parsed.metadata,
          },
          { cause: e },
        ).toObject()
      case e instanceof Error:
        return new NamedError.Unknown({ message: e.toString() }, { cause: e }).toObject()
      default:
        try {
          const parsed = ProviderError.parseStreamError(e)
          if (parsed) {
            if (parsed.type === "context_overflow") {
              return new MessageV2.ContextOverflowError(
                {
                  message: parsed.message,
                  responseBody: parsed.responseBody,
                },
                { cause: e },
              ).toObject()
            }
            return new MessageV2.APIError(
              {
                message: parsed.message,
                isRetryable: parsed.isRetryable,
                responseBody: parsed.responseBody,
              },
              {
                cause: e,
              },
            ).toObject()
          }
        } catch {}
        return new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e }).toObject()
    }
  }
}
