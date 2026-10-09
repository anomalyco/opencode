export * as ConfigCache from "./cache.js"

import { Schema } from "effect"
import { PromptCache } from "../prompt-cache.js"
import { optional } from "../schema.js"

export const When = Schema.Struct({
  agent: Schema.NonEmptyString.pipe(optional),
  model: Schema.NonEmptyString.pipe(optional),
  subagent: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Config.Cache.When" })
export interface When extends Schema.Schema.Type<typeof When> {}

export const Rule = Schema.Struct({
  when: When.pipe(optional),
  options: PromptCache.Options,
}).annotate({ identifier: "Config.Cache.Rule" })
export interface Rule extends Schema.Schema.Type<typeof Rule> {}

export const Info = Schema.Record(Schema.String, Schema.Array(Rule)).annotate({
  identifier: "Config.Cache",
  description:
    "Prompt cache rules keyed by configured provider ID. The unique most specific match wins, independently of order.",
})
export type Info = typeof Info.Type
