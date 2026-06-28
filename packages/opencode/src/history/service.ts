import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session } from "@/session/session"
import { InstanceState } from "@/effect/instance-state"
import type { SessionID } from "../session/schema"
import * as Bm25 from "../memory/bm25"
import { ALL_KINDS, extract, renderPart, type Kind } from "./extract"

export type SearchHit = {
  part_id: string
  session_id: string
  message_id: string
  project_id: string
  kind: Kind
  tool_name: string | null
  snippet: string
  score: number
  time_created: number
}

export type MessagePart = {
  part_id: string
  type: string
  role: "user" | "assistant"
  tool_name: string | null
  text: string
}

export type MessageContext = {
  message_id: string
  matched: boolean
  time_created: number
  parts: MessagePart[]
}

export interface SearchInput {
  query: string
  scope?: "project" | "global"
  session_id?: string
  kind?: Kind | Kind[]
  tool_name?: string
  time_after?: number
  time_before?: number
  limit?: number
}

export interface AroundInput {
  message_id: string
  session_id?: string
  before?: number
  after?: number
}

export interface Interface {
  readonly search: (input: SearchInput) => Effect.Effect<SearchHit[]>
  readonly around: (input: AroundInput) => Effect.Effect<{ session_id: string; messages: MessageContext[] }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/History") {}

const HARD_CAP = 50

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service

    const sessionIds = Effect.fn("History.sessionIds")(function* (scope: "project" | "global") {
      if (scope === "global") {
        const list = yield* session.listGlobal().pipe(Effect.catch(() => Effect.succeed([])))
        return list.map((s) => s.id as SessionID)
      }
      const list = yield* session.list().pipe(Effect.catch(() => Effect.succeed([])))
      return list.map((s) => s.id)
    })

    const loadMessages = Effect.fn("History.loadMessages")(function* (sid: SessionID) {
      return yield* session
        .messages({ sessionID: sid })
        .pipe(Effect.catch(() => Effect.succeed([] as SessionV1.WithParts[])))
    })

    const search = Effect.fn("History.search")(function* (input: SearchInput) {
      const limit = Math.min(input.limit ?? 10, HARD_CAP)
      const scope = input.scope ?? "project"
      const enabled = new Set<Kind>(
        input.kind ? (Array.isArray(input.kind) ? input.kind : [input.kind]) : ALL_KINDS,
      )

      const ctx = yield* InstanceState.context
      let ids = yield* sessionIds(scope)
      if (input.session_id) ids = ids.filter((id) => id === input.session_id)

      const docs: Bm25.Doc[] = []
      const meta = new Map<string, Omit<SearchHit, "part_id" | "snippet" | "score">>()

      for (const sid of ids) {
        const msgs = yield* loadMessages(sid)
        for (const m of msgs) {
          const role = m.info.role
          const created = m.info.time.created
          if (input.time_after !== undefined && created < input.time_after) continue
          if (input.time_before !== undefined && created > input.time_before) continue
          for (const part of m.parts) {
            const ex = extract(part, role, enabled)
            if (!ex) continue
            if (input.tool_name && ex.tool_name !== input.tool_name) continue
            const partId = part.id
            docs.push({ path: partId, body: ex.body })
            meta.set(partId, {
              session_id: sid,
              message_id: m.info.id,
              project_id: scope === "project" ? ctx.project.id : "",
              kind: ex.kind,
              tool_name: ex.tool_name,
              time_created: created,
            })
          }
        }
      }

      const ranked = Bm25.search(docs, input.query, { limit })
      return ranked.map((r) => {
        const mm = meta.get(r.path)!
        return { part_id: r.path, ...mm, snippet: r.snippet, score: r.score }
      })
    })

    const locateSession = Effect.fn("History.locateSession")(function* (messageId: string) {
      for (const scope of ["project", "global"] as const) {
        const ids = yield* sessionIds(scope)
        for (const sid of ids) {
          const msgs = yield* loadMessages(sid)
          if (msgs.some((m) => m.info.id === messageId)) return sid
        }
      }
      return undefined
    })

    const around = Effect.fn("History.around")(function* (input: AroundInput) {
      const before = input.before ?? 5
      const after = input.after ?? 5

      const sessionId = (input.session_id as SessionID | undefined) ?? (yield* locateSession(input.message_id))
      if (!sessionId) return { session_id: "", messages: [] as MessageContext[] }

      const msgs = yield* loadMessages(sessionId)
      const idx = msgs.findIndex((m) => m.info.id === input.message_id)
      if (idx === -1) return { session_id: sessionId, messages: [] as MessageContext[] }

      const start = Math.max(0, idx - before)
      const end = Math.min(msgs.length, idx + after + 1)
      const out: MessageContext[] = msgs.slice(start, end).map((m) => ({
        message_id: m.info.id,
        matched: m.info.id === input.message_id,
        time_created: m.info.time.created,
        parts: m.parts.map((p) => {
          const r = renderPart(p)
          return {
            part_id: p.id,
            type: r.type,
            role: m.info.role,
            tool_name: r.tool_name,
            text: r.text,
          }
        }),
      }))

      return { session_id: sessionId, messages: out }
    })

    return Service.of({ search, around })
  }),
)

export const defaultLayer = Layer.suspend(() => layer.pipe(Layer.provide(Session.defaultLayer)))

export const node = LayerNode.make({ service: Service, layer, deps: [Session.node] })

export * as History from "./service"
