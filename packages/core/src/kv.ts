export * as KV from "./kv.js"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database/database.js"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { KVTable } from "./kv/sql.js"

export type Value = Schema.Json

export interface Interface {
  readonly get: (key: string) => Effect.Effect<Value | undefined>
  readonly set: (key: string, value: Value) => Effect.Effect<void>
  readonly remove: (key: string) => Effect.Effect<void>
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
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
