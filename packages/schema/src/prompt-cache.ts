export * as PromptCache from "./prompt-cache.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export const Control = Schema.Struct({
  type: Schema.Literal("ephemeral"),
  ttl: Schema.Literals(["5m", "1h"]).pipe(optional),
}).annotate({ identifier: "PromptCache.Control" })

export const Retention = Schema.Literals(["in_memory", "24h"]).annotate({ identifier: "PromptCache.Retention" })

export const OpenAIOptions = Schema.Struct({
  mode: Schema.Literals(["implicit", "explicit"]).pipe(optional),
  ttl: Schema.Literal("30m").pipe(optional),
}).annotate({ identifier: "PromptCache.OpenAIOptions" })
export interface OpenAIOptions extends Schema.Schema.Type<typeof OpenAIOptions> {}

export const Options = Schema.Struct({
  cache_control: Control.pipe(optional),
  prompt_cache_retention: Retention.pipe(optional),
  prompt_cache_options: OpenAIOptions.pipe(optional),
}).annotate({ identifier: "PromptCache.Options" })
export interface Options extends Schema.Schema.Type<typeof Options> {}
