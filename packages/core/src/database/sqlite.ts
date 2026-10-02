export * as Sqlite from "./sqlite"

import { Context, Effect, Schedule } from "effect"
import type { drizzle } from "drizzle-orm/bun-sqlite"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"

export type DrizzleClient = ReturnType<typeof drizzle>
export class Native extends Context.Service<Native, unknown>()("@opencode-ai/core/database/SqliteNative") {}
export class Drizzle extends Context.Service<Drizzle, DrizzleClient>()("@opencode-ai/core/database/SqliteDrizzle") {}

export function statementError(cause: unknown) {
  // node:sqlite exposes errcode; Effect's classifier reads code/errno instead.
  // Do not expose native messages, SQL or bound values in the visible error.
  const code = sqliteCode(cause)
  const normalized =
    code !== undefined && typeof cause === "object" && cause !== null
      ? { ...cause, errno: code, message: "message" in cause ? cause.message : undefined }
      : cause
  const reason = classifySqliteError(normalized, { operation: "execute" })
  return new SqlError({
    reason: Object.assign(reason, {
      cause,
      message: `Failed to execute statement (${reason._tag}${code === undefined ? "" : `; SQLite ${code}`})`,
    }),
  })
}

function sqliteCode(cause: unknown) {
  if (typeof cause !== "object" || cause === null) return undefined
  if ("errcode" in cause && typeof cause.errcode === "number") return cause.errcode
  if ("errno" in cause && typeof cause.errno === "number") return cause.errno
  if ("code" in cause && typeof cause.code === "number") return cause.code
  return undefined
}

export const retryLocked = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.retry({
      while: (error) => {
        if (!(error instanceof SqlError) || error.reason._tag !== "LockTimeoutError") return false
        const cause = error.reason.cause
        // A stale WAL snapshot needs a transaction restart, not a statement retry.
        if (sqliteCode(cause) === 517) return false
        if (typeof cause === "object" && cause !== null) {
          if ("code" in cause && cause.code === "SQLITE_BUSY_SNAPSHOT") return false
        }
        return true
      },
      schedule: Schedule.exponential(50, 2).pipe(
        Schedule.either(Schedule.spaced(250)),
        Schedule.jittered,
        Schedule.while((meta) => meta.elapsed < 30_000),
      ),
    }),
  )
