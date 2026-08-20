export * as KV from "./kv.js"

import { and, asc, eq, gt, gte, lt } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database/database.js"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
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

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return Service.of({
      get: Effect.fn("KV.get")(function* (key) {
        return (yield* db
          .select({ value: KVTable.value })
          .from(KVTable)
          .where(eq(KVTable.key, key))
          .get()
          .pipe(Effect.orDie))?.value
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
          .select({ key: KVTable.key, value: KVTable.value })
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
        const entries = rows.slice(0, limit)
        if (rows.length <= limit) return { entries }
        return { entries, next: entries[entries.length - 1].key }
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
