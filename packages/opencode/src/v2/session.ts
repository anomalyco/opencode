import { SessionMessageTable, SessionTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"
import type { WorkspaceID } from "@/control-plane/schema"
import { and, asc, desc, eq, gt, gte, isNull, like, lt, or, type SQL } from "@/storage/db"
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
  readonly list: (input: {
    limit?: number
    order?: "asc" | "desc"
    directory?: string
    path?: string
    workspaceID?: WorkspaceID
    roots?: boolean
    start?: number
    search?: string
    cursor?: {
      id: SessionID
      time: number
      direction: "previous" | "next"
    }
  }) => Effect.Effect<Session.Info[], never>
  readonly messages: (input: {
    sessionID: SessionID
    limit?: number
    order?: "asc" | "desc"
    cursor?: {
      id: SessionMessage.ID
      time: number
      direction: "previous" | "next"
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
      list: Effect.fn("V2Session.list")(function* (input) {
        const direction = input.cursor?.direction ?? "next"
        let order = input.order ?? "desc"
        // Query the adjacent rows in reverse, then flip them back into the requested order below.
        if (direction === "previous" && order === "asc") order = "desc"
        if (direction === "previous" && order === "desc") order = "asc"
        const conditions: SQL[] = []
        if (input.directory) conditions.push(eq(SessionTable.directory, input.directory))
        if (input.path)
          conditions.push(or(eq(SessionTable.path, input.path), like(SessionTable.path, `${input.path}/%`))!)
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if (input.roots) conditions.push(isNull(SessionTable.parent_id))
        if (input.start) conditions.push(gte(SessionTable.time_created, input.start))
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.cursor) {
          conditions.push(
            order === "asc"
              ? or(
                  gt(SessionTable.time_created, input.cursor.time),
                  and(eq(SessionTable.time_created, input.cursor.time), gt(SessionTable.id, input.cursor.id)),
                )!
              : or(
                  lt(SessionTable.time_created, input.cursor.time),
                  and(eq(SessionTable.time_created, input.cursor.time), lt(SessionTable.id, input.cursor.id)),
                )!,
          )
        }
        const query = Database.Client()
          .select()
          .from(SessionTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            order === "asc" ? asc(SessionTable.time_created) : desc(SessionTable.time_created),
            order === "asc" ? asc(SessionTable.id) : desc(SessionTable.id),
          )

        const rows = input.limit === undefined ? query.all() : query.limit(input.limit).all()
        return (direction === "previous" ? rows.toReversed() : rows).map((row) => Session.fromRow(row))
      }),
      messages: Effect.fn("V2Session.messages")(function* (input) {
        const direction = input.cursor?.direction ?? "next"
        let order = input.order ?? "desc"
        // Query the adjacent rows in reverse, then flip them back into the requested order below.
        if (direction === "previous" && order === "asc") order = "desc"
        if (direction === "previous" && order === "desc") order = "asc"
        const boundary = input.cursor
          ? order === "asc"
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
          const query = db
            .select()
            .from(SessionMessageTable)
            .where(where)
            .orderBy(
              order === "asc" ? asc(SessionMessageTable.time_created) : desc(SessionMessageTable.time_created),
              order === "asc" ? asc(SessionMessageTable.id) : desc(SessionMessageTable.id),
            )
          const rows = input.limit === undefined ? query.all() : query.limit(input.limit).all()
          return direction === "previous" ? rows.toReversed() : rows
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
