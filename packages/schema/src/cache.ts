export * as CachePolicy from "./cache.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

/** Breakpoint selection for the conversation tail. */
export const Messages = Schema.Union([
  Schema.Literal("latest-user-message"),
  Schema.Literal("latest-assistant"),
  Schema.Struct({ tail: Schema.Number }),
]).annotate({ identifier: "CachePolicy.Messages" })

/**
 * Granular prompt-cache policy. `ttlSeconds` is the only provider-independent
 * knob; providers that support extended retention map `>= 3600` to their
 * long-lived bucket (Anthropic/Bedrock `1h`) and leave everything else at the
 * provider default.
 */
export const Object = Schema.Struct({
  tools: Schema.Boolean.pipe(optional),
  system: Schema.Boolean.pipe(optional),
  messages: Messages.pipe(optional),
  ttlSeconds: Schema.Number.pipe(optional),
}).annotate({ identifier: "CachePolicy.Object" })
export type Object = typeof Object.Type

/**
 * `undefined`/`"auto"` keeps the provider default (Anthropic 5m); `"none"`
 * disables automatic placement; the object form overrides individual choices.
 */
export const Policy = Schema.Union([Schema.Literal("auto"), Schema.Literal("none"), Object]).annotate({
  identifier: "CachePolicy",
})
export type Policy = typeof Policy.Type
