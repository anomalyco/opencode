export * as PermissionModule from "./permission-module"

import { Schema } from "effect"
import { optional } from "./schema"

/** Built-in permission module id for the LLM permission classifier. */
export const CRUISE_CONTROL = "cruise_control" as const

export const ReservedAction = Schema.Literals(["allow", "deny", "ask"]).annotate({
  identifier: "PermissionModule.ReservedAction",
})
export type ReservedAction = typeof ReservedAction.Type

export const Fallback = Schema.Literals(["ask", "deny"]).annotate({
  identifier: "PermissionModule.Fallback",
})
export type Fallback = typeof Fallback.Type

/** Options for a named permission module (e.g. cruise_control). */
export interface Options extends Schema.Schema.Type<typeof Options> {}
export const Options = Schema.Struct({
  model: Schema.String.pipe(optional).annotate({
    description: "Provider/model ref used to classify tool permissions, e.g. opencode/deepseek-v4-flash",
  }),
  fallback: Fallback.pipe(optional).annotate({
    description: "Outcome when classification fails or is uncertain (default: deny)",
  }),
  timeout_ms: Schema.Number.pipe(optional).annotate({
    description: "Classifier deadline in milliseconds (default: 8000)",
  }),
  allowlist: Schema.Array(Schema.String).pipe(optional).annotate({
    description: "Permission keys the module may auto-allow; empty means no auto-allow",
  }),
  never_auto: Schema.Array(Schema.String).pipe(optional).annotate({
    description: "Permission keys that must never resolve to allow from the module",
  }),
}).annotate({ identifier: "PermissionModule.Options" })

/** Top-level map of permission module id → options. */
export const Info = Schema.Record(Schema.String, Options).annotate({
  identifier: "PermissionModule.Info",
  description: "Per-module options keyed by module id (built-in: cruise_control)",
})
export type Info = typeof Info.Type

export const Decision = Schema.Literals(["allow", "deny", "ask"]).annotate({
  identifier: "PermissionModule.Decision",
})
export type Decision = typeof Decision.Type
