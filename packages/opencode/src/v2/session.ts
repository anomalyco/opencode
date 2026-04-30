import { SessionMessageTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"
import { and, asc, desc, eq, gt, inArray, lt, or } from "@/storage/db"
import * as Database from "@/storage/db"
import { Context, Effect, Layer, Schema } from "effect"
import { SessionMessage } from "./session-message"
import type { Prompt } from "./session-prompt"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import type { Event } from "./event"

export const Delivery = Schema.Union([Schema.Literal("immediate"), Schema.Literal("deferred")]).annotate({
  identifier: "Session.Delivery",
})
export type Delivery = Schema.Schema.Type<typeof Delivery>

export const DefaultDelivery = "immediate" satisfies Delivery

export interface Interface {
  readonly messages: (input: {
    sessionID: SessionID
    limit?: number
    from?: "start" | "end"
    cursor?: {
      id: SessionMessage.ID
      time: number
    }
  }) => Effect.Effect<SessionMessage.Message[], never>
  readonly prompt: (input: {
    id?: Event.ID
    sessionID: SessionID
    prompt: Prompt
    delivery?: Delivery
  }) => Effect.Effect<SessionMessage.User, never>
  readonly compact: (sessionID: SessionID) => Effect.Effect<void, never>
  readonly wait: (sessionID: SessionID) => Effect.Effect<void, never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Session") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
    const decode = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type })

    const result: Interface = {
      messages: Effect.fn("V2Session.messages")(function* (input) {
        const from = input.from ?? (input.limit === undefined && input.cursor === undefined ? "start" : "end")
        const boundary = input.cursor
          ? from === "start"
            ? or(
                gt(SessionMessageTable.time_created, input.cursor.time),
                and(
                  eq(SessionMessageTable.time_created, input.cursor.time),
                  gt(SessionMessageTable.id, input.cursor.id),
                ),
              )
            : or(
                lt(SessionMessageTable.time_created, input.cursor.time),
                and(
                  eq(SessionMessageTable.time_created, input.cursor.time),
                  lt(SessionMessageTable.id, input.cursor.id),
                ),
              )
          : undefined
        const where = boundary
          ? and(eq(SessionMessageTable.session_id, input.sessionID), boundary)
          : eq(SessionMessageTable.session_id, input.sessionID)

        const rows = Database.use((db) => {
          if (from === "start") {
            const query = db
              .select()
              .from(SessionMessageTable)
              .where(where)
              .orderBy(asc(SessionMessageTable.time_created), asc(SessionMessageTable.id))
            return input.limit === undefined ? query.all() : query.limit(input.limit).all()
          }
          const idsQuery = db
            .select({ id: SessionMessageTable.id })
            .from(SessionMessageTable)
            .where(where)
            .orderBy(desc(SessionMessageTable.time_created), desc(SessionMessageTable.id))
          const ids = (input.limit === undefined ? idsQuery.all() : idsQuery.limit(input.limit).all()).map(
            (row) => row.id,
          )
          if (ids.length === 0) return []
          return db
            .select()
            .from(SessionMessageTable)
            .where(inArray(SessionMessageTable.id, ids))
            .orderBy(asc(SessionMessageTable.time_created), asc(SessionMessageTable.id))
            .all()
        })
        return rows.map((row) => decode(row))
      }),
      prompt: Effect.fn("V2Session.prompt")(function* (input) {
        const delivery = input.delivery ?? DefaultDelivery
        return {} as any
      }),
      compact: Effect.fn("V2Session.compact")(function* (sessionID) {}),
      wait: Effect.fn("V2Session.wait")(function* (sessionID) {}),
    }

    return Service.of(result)
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionPrompt.defaultLayer))

export * as SessionV2 from "./session"
