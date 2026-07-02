export * as SessionContextEntry from "./context-entry"

import { and, asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { SessionContextEntry } from "@opencode-ai/schema/session-context-entry"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { SystemContext } from "../system-context/index"
import { SessionSchema } from "./schema"
import { SessionContextEntryTable } from "./sql"

export const Key = SessionContextEntry.Key
export type Key = typeof Key.Type
export const Info = SessionContextEntry.Info
export type Info = typeof Info.Type

export interface Interface {
  readonly list: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
  readonly put: (input: {
    readonly sessionID: SessionSchema.ID
    readonly key: Key
    readonly value: Schema.Json
  }) => Effect.Effect<void>
  readonly remove: (input: { readonly sessionID: SessionSchema.ID; readonly key: Key }) => Effect.Effect<void>
  /** Produces one SystemContext source per stored entry, keyed `api/<key>`. */
  readonly load: (sessionID: SessionSchema.ID) => Effect.Effect<SystemContext.SystemContext>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionContextEntry") {}

const renderValue = (value: Schema.Json) => (typeof value === "string" ? value : JSON.stringify(value, null, 2))

const renderBlock = (key: Key, value: Schema.Json) =>
  [`<context key="${key}">`, renderValue(value), "</context>"].join("\n")

const source = (entry: Info) =>
  SystemContext.make({
    key: SystemContext.Key.make(`api/${entry.key}`),
    codec: Schema.toCodecJson(Schema.Json),
    load: Effect.succeed(entry.value),
    baseline: (value) =>
      [
        `An API client attached the following context to this session under "${entry.key}":`,
        renderBlock(entry.key, value),
      ].join("\n"),
    update: (_previous, value) =>
      [
        `The attached context "${entry.key}" changed. This value supersedes the previous one:`,
        renderBlock(entry.key, value),
      ].join("\n"),
    removed: () => `The attached context "${entry.key}" was removed. Disregard it.`,
  })

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const list = Effect.fn("SessionContextEntry.list")(function* (sessionID: SessionSchema.ID) {
      const rows = yield* db
        .select()
        .from(SessionContextEntryTable)
        .where(eq(SessionContextEntryTable.session_id, sessionID))
        .orderBy(asc(SessionContextEntryTable.key))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => ({ key: row.key, value: row.value }))
    })

    const put = Effect.fn("SessionContextEntry.put")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly key: Key
      readonly value: Schema.Json
    }) {
      yield* db
        .insert(SessionContextEntryTable)
        .values({ session_id: input.sessionID, key: input.key, value: input.value })
        .onConflictDoUpdate({
          target: [SessionContextEntryTable.session_id, SessionContextEntryTable.key],
          set: { value: input.value, time_updated: Date.now() },
        })
        .run()
        .pipe(Effect.orDie)
    })

    const remove = Effect.fn("SessionContextEntry.remove")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly key: Key
    }) {
      yield* db
        .delete(SessionContextEntryTable)
        .where(
          and(eq(SessionContextEntryTable.session_id, input.sessionID), eq(SessionContextEntryTable.key, input.key)),
        )
        .run()
        .pipe(Effect.orDie)
    })

    const load = Effect.fn("SessionContextEntry.load")(function* (sessionID: SessionSchema.ID) {
      const entries = yield* list(sessionID)
      return SystemContext.combine(entries.map(source))
    })

    return Service.of({ list, put, remove, load })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node] })
