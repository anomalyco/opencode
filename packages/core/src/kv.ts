export * as KV from "./kv.js"

import { and, asc, eq, gt, gte, lt, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Database } from "./database/database.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KVTable } from "./kv/sql.js"

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

// The json column mode parses during the row read, so one malformed row would throw for every reader.
// Read the raw text and decode it here instead, treating an undecodable value as missing.
const raw = sql<string>`${KVTable.value}`
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return Service.of({
      get: Effect.fn("KV.get")(function* (key) {
        const row = yield* db.select({ value: raw }).from(KVTable).where(eq(KVTable.key, key)).get().pipe(Effect.orDie)
        if (!row) return
        const value = decode(row.value)
        if (Option.isSome(value)) return value.value
        yield* Effect.logWarning("Ignoring malformed KV value", { key })
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
          .select({ key: KVTable.key, value: raw })
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
        const page = rows.slice(0, limit).map((row) => ({ key: row.key, value: decode(row.value) }))
        const entries = page.flatMap((row) =>
          Option.isSome(row.value) ? [{ key: row.key, value: row.value.value }] : [],
        )
        const skipped = page.filter((row) => Option.isNone(row.value)).map((row) => row.key)
        if (skipped.length > 0) yield* Effect.logWarning("Skipping malformed KV values", { keys: skipped })
        if (rows.length <= limit) return { entries }
        // Page from the raw rows so a skipped value never stalls or repeats the cursor.
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
