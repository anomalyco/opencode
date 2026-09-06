export * as Sqlite from "./sqlite"

import { Effect, Schedule } from "effect"
import { Context } from "effect"
import type { drizzle } from "drizzle-orm/bun-sqlite"
import { SqlError } from "effect/unstable/sql/SqlError"

export type DrizzleClient = ReturnType<typeof drizzle>
export class Native extends Context.Service<Native, unknown>()("@opencode-ai/core/database/SqliteNative") {}
export class Drizzle extends Context.Service<Drizzle, DrizzleClient>()("@opencode-ai/core/database/SqliteDrizzle") {}

// SQLITE_BUSY means another process held the write lock past busy_timeout. The
// statement itself is fine — retrying with an async sleep lets the competing
// process finish so the next attempt can acquire the lock. Without this, one
// long write in a concurrent process kills another process's prompt.
export const retryLocked = <A, E>(effect: Effect.Effect<A, E, never>) =>
  effect.pipe(
    Effect.retry({
      while: (error) => error instanceof SqlError && error.reason._tag === "LockTimeoutError",
      schedule: Schedule.exponential(50, 2).pipe(
        Schedule.either(Schedule.spaced(250)),
        Schedule.jittered,
        Schedule.while((meta) => meta.elapsed < 30_000),
      ),
    }),
  )
