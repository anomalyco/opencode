export * as Sqlite from "./sqlite.js"

import { Context, Effect, Fiber, Scope, Semaphore, Stream } from "effect"
import { identity } from "effect/Function"
import { SqlClient, Statement } from "effect/sql"
import type { Connection } from "effect/sql/SqlConnection"
import type { SqlError } from "effect/sql/SqlError"

export type DrizzleClient = ReturnType<typeof drizzle>
export class Native extends Context.Service<Native, unknown>()("@bolt-ai/core/database/SqliteNative") {}
export class Drizzle extends Context.Service<Drizzle, DrizzleClient>()("@bolt-ai/core/database/SqliteDrizzle") {}
