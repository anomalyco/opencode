export * as Sqlite from "./sqlite"

import { Context } from "effect"
import type { drizzle } from "drizzle-orm/bun-sqlite"

export type DrizzleClient = ReturnType<typeof drizzle>
export class Native extends Context.Service<Native, unknown>()("@opencode-ai/core/database/SqliteNative") {}
export class Drizzle extends Context.Service<Drizzle, DrizzleClient>()("@opencode-ai/core/database/SqliteDrizzle") {}

export function executeErrorMessage(cause: unknown) {
  const fallback = "Failed to execute statement"
  if (!(cause instanceof Error)) return fallback
  const code = "code" in cause && typeof cause.code === "string" ? cause.code : undefined
  const errcode = "errcode" in cause && typeof cause.errcode === "number" ? cause.errcode : undefined
  if (code === "SQLITE_FULL" || (errcode !== undefined && (errcode & 0xff) === 13))
    return `${fallback}: database or disk is full`
  if (!code) return fallback
  if (/^(?:SQLITE|ERR_SQLITE)_[A-Z0-9_]+$/.test(code)) return `${fallback} (${code})`
  return fallback
}
