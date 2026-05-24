import { DatabaseSync } from "node:sqlite"
import { Sqlite } from "@opencode-ai/core/database/sqlite"
import { layer } from "@opencode-ai/core/database/sqlite.node"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { drizzle } from "drizzle-orm/node-sqlite"
import { Effect } from "effect"

export function init(path: string) {
  const runtime = makeRuntime(Sqlite.Native, layer({ filename: path }))
  const native = runtime.runSync((native) => Effect.succeed(native)) as DatabaseSync
  return drizzle({ client: native })
}
