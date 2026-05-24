import { Database } from "bun:sqlite"
import { Sqlite } from "@opencode-ai/core/database/sqlite"
import { layer } from "@opencode-ai/core/database/sqlite.bun"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { Effect } from "effect"

export function init(path: string) {
  const runtime = makeRuntime(Sqlite.Native, layer({ filename: path }))
  const native = runtime.runSync((native) => Effect.succeed(native)) as Database
  return drizzle({ client: native })
}
