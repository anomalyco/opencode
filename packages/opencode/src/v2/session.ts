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

export type MessagesCursor = {
  id: SessionMessage.ID
  time: number
}

export type MessagesInput = {
  sessionID: SessionID
  limit?: number
  cursor?: MessagesCursor
  direction?: "before" | "after"
}

const older = (item: MessagesCursor) =>
  or(
    lt(SessionMessageTable.time_created, item.time),
    and(eq(SessionMessageTable.time_created, item.time), lt(SessionMessageTable.id, item.id)),
  )

const newer = (item: MessagesCursor) =>
  or(
    gt(SessionMessageTable.time_created, item.time),
    and(eq(SessionMessageTable.time_created, item.time), gt(SessionMessageTable.id, item.id)),
  )

export interface Interface {
  readonly messages: (input: MessagesInput) => Effect.Effect<SessionMessage.Message[], never>
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
        if (input.limit === undefined) {
          const rows = Database.use((db) =>
            db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.session_id, input.sessionID))
              .orderBy(asc(SessionMessageTable.time_created), asc(SessionMessageTable.id))
              .all(),
          )
          return rows.map((row) => decode(row))
        }

        const limit = input.limit
        const direction = input.direction ?? "before"
        const where = input.cursor
          ? and(
              eq(SessionMessageTable.session_id, input.sessionID),
              direction === "after" ? newer(input.cursor) : older(input.cursor),
            )
          : eq(SessionMessageTable.session_id, input.sessionID)
        const rows = Database.use((db) => {
          if (direction === "after") {
            return db
              .select()
              .from(SessionMessageTable)
              .where(where)
              .orderBy(asc(SessionMessageTable.time_created), asc(SessionMessageTable.id))
              .limit(limit)
              .all()
          }
          const ids = db
            .select({ id: SessionMessageTable.id })
            .from(SessionMessageTable)
            .where(where)
            .orderBy(desc(SessionMessageTable.time_created), desc(SessionMessageTable.id))
            .limit(limit)
            .all()
            .map((row) => row.id)
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
