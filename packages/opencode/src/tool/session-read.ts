import { Effect, Schema } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import DESCRIPTION from "./session-read.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  sessionId: Schema.String.annotate({ description: "Session ID to read" }),
  beforeMessageId: Schema.optional(Schema.String).annotate({
    description: "Cursor: return messages before this message ID",
  }),
  offset: Schema.optional(Schema.Number).annotate({
    description: "Number of messages to skip from the start",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum messages to return (default: 50, max: 100)",
  }),
  withToolOutputs: Schema.optional(Schema.Boolean).annotate({
    description: "Include full tool call input/output. Default: false",
  }),
  withChildren: Schema.optional(Schema.Boolean).annotate({
    description: "Include child session messages. Default: false",
  }),
})

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

interface FileMeta {
  mime: string
  url: string
  filename?: string
}

interface ToolEntry {
  callID: string
  tool: string
  status: string
  input?: Record<string, unknown>
  output?: string
  error?: string
  title?: string
}

interface TranscriptEntry {
  messageId: string
  sessionId: string
  parentSessionId?: string
  role: "user" | "assistant"
  agent?: string
  content: string | null
  reasoning: string | null
  files: FileMeta[]
  toolCalls: ToolEntry[]
  model?: { providerID: string; modelID: string }
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  time: { created: number; completed?: number }
}

export const SessionReadTool = Tool.define(
  "session_read",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: {
          sessionId: string
          beforeMessageId?: string
          offset?: number
          limit?: number
          withToolOutputs?: boolean
          withChildren?: boolean
        },
        _ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const sessionInfo = yield* session.get(params.sessionId as SessionID).pipe(
            Effect.mapError(() => new Error(`Session not found: ${params.sessionId}`)),
          )

          const allMessages = yield* session.messages({ sessionID: sessionInfo.id })
          let entries = buildEntries(allMessages, sessionInfo.id, params.withToolOutputs)

          let childTotal = 0

          if (params.withChildren) {
            const childSessions = yield* session.children(sessionInfo.id)
            let childEntries: TranscriptEntry[] = []
            for (const child of childSessions) {
              const childMessages = yield* session.messages({ sessionID: child.id })
              childTotal += childMessages.length
              const entries = buildEntries(childMessages, child.id, params.withToolOutputs, sessionInfo.id)
              childEntries = childEntries.concat(entries)
            }
            childEntries.sort((a, b) => a.time.created - b.time.created)
            entries = mergeChildEntries(entries, childEntries)
          }

          const page = paginate(entries, {
            beforeMessageId: params.beforeMessageId,
            offset: params.offset ?? 0,
            limit: Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
          })

          const hasMore = entries.length > page.length + (params.offset ?? 0)

          const output = JSON.stringify(
            {
              sessionId: sessionInfo.id,
              sessionTitle: sessionInfo.title,
              messages: page,
              hasMore,
            },
            null,
            2,
          )

          return {
            title: sessionInfo.title,
            output,
            metadata: {
              messageCount: page.length,
              totalMessages: entries.length,
              hasMore,
              ...(params.withChildren && { childCount: childTotal }),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// ---- Helpers ----

function buildEntries(
  messages: SessionV1.WithParts[],
  sessionId: string,
  withToolOutputs: boolean | undefined,
  parentSessionId?: string,
): TranscriptEntry[] {
  return messages.map((msg) => normalizeMessage(msg, sessionId, withToolOutputs, parentSessionId))
}

function normalizeMessage(
  msg: SessionV1.WithParts,
  sessionId: string,
  withToolOutputs: boolean | undefined,
  parentSessionId?: string,
): TranscriptEntry {
  const info = msg.info

  let textContent: string | null = null
  let reasoningContent: string | null = null
  const files: FileMeta[] = []
  const toolCalls: ToolEntry[] = []

  for (const part of msg.parts) {
    if (part.type === "text") {
      const text = (part as SessionV1.TextPart).text
      textContent = textContent ? textContent + "\n" + text : text
      continue
    }
    if (part.type === "reasoning") {
      const text = (part as SessionV1.ReasoningPart).text
      reasoningContent = reasoningContent ? reasoningContent + "\n" + text : text
      continue
    }
    if (part.type === "file") {
      const filePart = part as SessionV1.FilePart
      files.push({
        mime: filePart.mime,
        url: filePart.url,
        filename: filePart.filename,
      })
      continue
    }
    if (part.type === "tool") {
      const toolPart = part as SessionV1.ToolPart
      const state = toolPart.state
      const entry: ToolEntry = {
        callID: toolPart.callID,
        tool: toolPart.tool,
        status: state.status,
      }
      if (withToolOutputs) {
        entry.input = state.input
        if (state.status === "completed") {
          entry.output = state.output
          entry.title = state.title
        }
        if (state.status === "error") {
          entry.error = state.error
        }
      }
      toolCalls.push(entry)
      continue
    }
  }

  const tokens = info.role === "assistant"
    ? {
        input: info.tokens.input,
        output: info.tokens.output,
        reasoning: info.tokens.reasoning,
        cache: {
          read: info.tokens.cache.read,
          write: info.tokens.cache.write,
        },
      }
    : undefined

  const model = info.role === "assistant"
    ? { providerID: info.providerID, modelID: info.modelID }
    : { providerID: info.model.providerID, modelID: info.model.modelID }

  const time =
    info.role === "assistant"
      ? { created: info.time.created, completed: info.time.completed }
      : { created: info.time.created }

  return {
    messageId: info.id,
    sessionId,
    ...(parentSessionId ? { parentSessionId } : {}),
    role: info.role,
    agent: info.agent,
    content: textContent,
    reasoning: reasoningContent,
    files,
    toolCalls,
    model,
    tokens,
    time,
  }
}

function mergeChildEntries(
  parentEntries: TranscriptEntry[],
  childEntries: TranscriptEntry[],
): TranscriptEntry[] {
  const all = [...parentEntries, ...childEntries]
  all.sort((a, b) => a.time.created - b.time.created)
  return all
}

function paginate(
  entries: TranscriptEntry[],
  params: { beforeMessageId?: string; offset: number; limit: number },
): TranscriptEntry[] {
  let result = entries

  if (params.beforeMessageId) {
    const idx = result.findIndex((e) => e.messageId === params.beforeMessageId)
    if (idx >= 0) {
      result = result.slice(0, idx)
    }
  }

  result = result.slice(params.offset)
  result = result.slice(0, params.limit)

  return result
}
