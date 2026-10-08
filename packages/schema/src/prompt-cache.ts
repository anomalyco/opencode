export * as PromptCache from "./prompt-cache.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export const Control = Schema.Struct({
  type: Schema.Literal("ephemeral"),
  ttl: Schema.Literals(["5m", "1h"]).pipe(optional),
}).annotate({ identifier: "PromptCache.Control", parseOptions: { onExcessProperty: "error" } })

export const Retention = Schema.Literals(["in_memory", "24h"]).annotate({ identifier: "PromptCache.Retention" })

export const Options = Schema.Struct({
  cache_control: Control.pipe(optional),
  prompt_cache_retention: Retention.pipe(optional),
}).annotate({ identifier: "PromptCache.Options", parseOptions: { onExcessProperty: "error" } })
export interface Options extends Schema.Schema.Type<typeof Options> {}
