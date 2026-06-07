import { Schema } from "effect"
import { Effect } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import DESCRIPTION from "./session-tail.txt"
import * as Tool from "./tool"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export const Parameters = Schema.Struct({
  sessionId: Schema.String.annotate({ description: "Session ID to read" }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum messages to return (default: 20, max: 50)",
  }),
  withChildren: Schema.optional(Schema.Boolean).annotate({
    description: "Include child session messages. Default: false",
  }),
})

interface TailEntry {
  role: string
  text: string
  agent: string
  createdAt: number
  messageId: string
}

function extractText(msg: SessionV1.WithParts): string {
  let text = ""
  for (const part of msg.parts) {
    if (part.type === "text") {
      const t = (part as SessionV1.TextPart).text
      text = text ? text + "\n" + t : t
    }
  }
  return text
}

function toEntry(msg: SessionV1.WithParts): TailEntry {
  return {
    role: msg.info.role,
    text: extractText(msg),
    agent: msg.info.agent,
    createdAt: msg.info.time.created,
    messageId: msg.info.id,
  }
}

export const SessionTailTool = Tool.define(
  "session_tail",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { sessionId: string; limit?: number; withChildren?: boolean }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const limit = Math.min(Math.max(1, params.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
          const withChildren = params.withChildren ?? false

          const sessionInfo = yield* session.get(params.sessionId as SessionID).pipe(
            Effect.mapError(() => new Error(`Session not found: ${params.sessionId}`)),
          )

          // session.messages returns oldest-first; take last `limit` and reverse for newest-first
          const parentMessages = yield* session.messages({ sessionID: sessionInfo.id, limit })
          const parentEntries = parentMessages.map(toEntry).slice(-limit).reverse()

          let entries = parentEntries

          if (withChildren) {
            const children = yield* session.children(sessionInfo.id)
            const childEntries: TailEntry[] = []
            for (const child of children) {
              const childMessages = yield* session.messages({ sessionID: child.id, limit })
              childEntries.push(...childMessages.map(toEntry))
            }
            const merged = parentEntries.concat(childEntries)
            merged.sort((a, b) => b.createdAt - a.createdAt)
            entries = merged.slice(0, limit)
          }

          return {
            title: sessionInfo.title,
            output: JSON.stringify(entries, null, 2),
            metadata: {
              messageCount: entries.length,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
