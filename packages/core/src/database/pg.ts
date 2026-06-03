export * as Pg from "./pg"

import { Context } from "effect"

export class Native extends Context.Service<Native, unknown>()("@opencode-ai/core/database/PgNative") {}
