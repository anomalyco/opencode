export * as ServiceInstance from "./service-instance.js"

import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "./database/database.js"
import { ServiceInstanceTable } from "./session/sql.js"

/**
 * Stable identity of THIS service's database (random, created on first use). Two services on one host can both hold a
 * session with the same ID; a caller that fenced one of them can use this to prove it was the one that took the send.
 */
export const id = Effect.fn("ServiceInstance.id")(function* () {
  const { db } = yield* Database.Service
  const existing = yield* db.select().from(ServiceInstanceTable).where(eq(ServiceInstanceTable.key, "instance")).get().pipe(Effect.orDie)
  if (existing) return existing.value
  const created = `svc_${crypto.randomUUID().replaceAll("-", "")}`
  yield* db.insert(ServiceInstanceTable).values({ key: "instance", value: created }).onConflictDoNothing().run().pipe(Effect.orDie)
  const stored = yield* db.select().from(ServiceInstanceTable).where(eq(ServiceInstanceTable.key, "instance")).get().pipe(Effect.orDie)
  return stored?.value ?? created
})

export class MismatchError extends Schema.TaggedError<MismatchError>()("ServiceInstance.MismatchError", {
  expected: Schema.String,
  actual: Schema.String,
}) {}

/**
 * Enforced by the service itself on the requests that matter (submit, fenced cancel, message lookup): a caller that
 * names the database it believes it is talking to is rejected, with no side effect, if this is a different one. This
 * binds identity to the operation, not to a separate earlier request.
 */
export const require = Effect.fn("ServiceInstance.require")(function* (expected: string | undefined) {
  if (expected === undefined) return
  const actual = yield* id()
  if (actual !== expected) return yield* new MismatchError({ expected, actual })
})
