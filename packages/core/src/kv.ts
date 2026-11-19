export * as KV from "./kv.js"

import { and, asc, eq, gt, gte, lt, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Database } from "./database/database.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KVTable } from "./kv/sql.js"

const decodeJSON = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))

export type Value = Schema.Json

export interface Entry {
  readonly key: string
  readonly value: Value
}

export interface ScanOptions {
  readonly prefix: string
  readonly after?: string
  readonly limit?: number
}

export interface ScanResult {
  readonly entries: readonly Entry[]
  readonly next?: string
}

export interface Interface {
  readonly get: (key: string) => Effect.Effect<Value | undefined>
  readonly set: (key: string, value: Value) => Effect.Effect<void>
  readonly remove: (key: string) => Effect.Effect<void>
  readonly scan: (options: ScanOptions) => Effect.Effect<ScanResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/KV") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return Service.of({
      get: Effect.fn("KV.get")(function* (key) {
        // Read the column as text: the JSON column mode decodes inside the query, so one
        // malformed row would fail every read of the table with no way to recover.
        const row = yield* db
          .select({ value: sql<string>`${KVTable.value}` })
          .from(KVTable)
          .where(eq(KVTable.key, key))
          .get()
          .pipe(Effect.orDie)
        if (row === undefined) return undefined
        const value = decodeJSON(row.value)
        if (Option.isSome(value)) return value.value
        // The entry is unreadable, but it is not ours to drop: callers that own a cache
        // decide whether to discard it, and others may still recover it by hand.
        yield* Effect.logWarning("kv entry is not valid JSON", { key })
        return undefined
      }),
      set: Effect.fn("KV.set")(function* (key, value) {
        yield* db
          .insert(KVTable)
          .values({ key, value })
          .onConflictDoUpdate({ target: KVTable.key, set: { value, time_updated: Date.now() } })
          .run()
          .pipe(Effect.orDie)
      }),
      remove: Effect.fn("KV.remove")(function* (key) {
        yield* db.delete(KVTable).where(eq(KVTable.key, key)).run().pipe(Effect.orDie)
      }),
      scan: Effect.fn("KV.scan")(function* (options) {
        const limit = Number.isNaN(options.limit) ? 100 : Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 1000)
        const end = prefixEnd(options.prefix)
        const rows = yield* db
          .select({ key: KVTable.key, value: sql<string>`${KVTable.value}` })
          .from(KVTable)
          .where(
            and(
              options.prefix === "" ? undefined : gte(KVTable.key, options.prefix),
              end === undefined ? undefined : lt(KVTable.key, end),
              options.after === undefined ? undefined : gt(KVTable.key, options.after),
            ),
          )
          .orderBy(asc(KVTable.key))
          .limit(limit + 1)
          .all()
          .pipe(Effect.orDie)
        const page = rows.slice(0, limit)
        // An unreadable row is skipped instead of failing the whole page, and it still
        // advances the cursor so a scan never stops on it.
        const entries = page.flatMap((row) => {
          const value = decodeJSON(row.value)
          return Option.isSome(value) ? [{ key: row.key, value: value.value }] : []
        })
        if (rows.length <= limit) return { entries }
        return { entries, next: page[page.length - 1].key }
      }),
    })
  }),
)

function prefixEnd(prefix: string) {
  const points = Array.from(prefix)
  const index = points.findLastIndex((value) => value.codePointAt(0)! < 0x10ffff)
  if (index < 0) return undefined
  return `${points.slice(0, index).join("")}${String.fromCodePoint(points[index].codePointAt(0)! + 1)}`
}

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
