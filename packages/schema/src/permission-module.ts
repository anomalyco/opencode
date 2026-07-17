export * as PermissionModule from "./permission-module"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema"

/** Built-in permission module id for the LLM permission classifier. */
export const CRUISE_CONTROL = "cruise_control" as const

export const Fallback = Schema.Literals(["ask", "deny"]).annotate({
  identifier: "PermissionModule.Fallback",
})
export type Fallback = typeof Fallback.Type

/** Structured classifier instructions for cruise_control (and similar modules). */
export interface Instructions extends Schema.Schema.Type<typeof Instructions> {}
export const Instructions = Schema.Struct({
  background: Schema.Array(Schema.String).pipe(optional).annotate({
    description: "Context about the user's setup that helps the classifier decide",
  }),
  allow: Schema.Array(Schema.String).pipe(optional).annotate({
    description: "Specific actions that should be permitted",
  }),
  conditional: Schema.Array(Schema.String).pipe(optional).annotate({
    description: "Conditions under which certain actions are allowed or denied",
  }),
  deny: Schema.Array(Schema.String).pipe(optional).annotate({
    description: "Specific actions that should be explicitly denied",
  }),
}).annotate({ identifier: "PermissionModule.Instructions" })

/**
 * Per-prompt dynamic allow/deny action-list options for cruise_control.
 * Lists are in-memory and cleared on each new user prompt — not persisted to config.
 */
export interface DynamicList extends Schema.Schema.Type<typeof DynamicList> {}
export const DynamicList = Schema.Struct({
  enabled: Schema.Boolean.pipe(optional).annotate({
    description: "When false, skip dynamic allow/deny lookup and learning (default: true)",
  }),
  max_size: NonNegativeInt.pipe(optional).annotate({
    description: "Max entries per allow/deny list within a prompt turn (default: 256); oldest evicted",
  }),
}).annotate({ identifier: "PermissionModule.DynamicList" })

/** Options for a named permission module (e.g. cruise_control). */
export interface Options extends Schema.Schema.Type<typeof Options> {}
export const Options = Schema.Struct({
  model: Schema.String.pipe(optional).annotate({
    description: "Provider/model ref used to classify tool permissions, e.g. opencode/deepseek-v4-flash",
  }),
  instructions: Instructions.pipe(optional).annotate({
    description:
      "Structured classifier instructions (background/allow/conditional/deny); seeded with defaults when unset",
  }),
  fallback: Fallback.pipe(optional).annotate({
    description:
      "Requested outcome when classification fails or times out; built-in cruise_control always fails closed to deny",
  }),
  /** Max classify attempts including the first (default 3 when unset). Each attempt gets its own timeout_ms. */
  retries: NonNegativeInt.pipe(optional).annotate({
    description:
      "Max classifier attempts including the first (default: 3). Each attempt gets its own timeout_ms budget. Not applied when the model is unset.",
  }),
  retry_interval_ms: NonNegativeInt.pipe(optional).annotate({
    description:
      "Delay between classifier retry attempts in milliseconds (default: 2000). Use 0 for immediate retries. Not applied when the model is unset.",
  }),
  timeout_ms: Schema.Number.pipe(optional).annotate({
    description: "Per-attempt classifier deadline in milliseconds (default: 8000)",
  }),
  allowlist: Schema.Array(Schema.String).pipe(optional).annotate({
    description: "Permission keys the module may auto-allow; omit for built-in defaults, use [] to disable auto-allow",
  }),
  never_auto: Schema.Array(Schema.String).pipe(optional).annotate({
    description:
      "Permission keys that must never resolve to allow from the module; built-in cruise_control denies candidate allows for these keys",
  }),
  dynamic_list: DynamicList.pipe(optional).annotate({
    description:
      "Workspace/session/prompt-scoped learned allow/deny action lists (in-memory; cleared on each new user prompt). Reduces repeated classifier calls within one turn.",
  }),
  parallel_classify: Schema.Boolean.pipe(optional).annotate({
    description:
      "When true, allow concurrent cruise_control LLM classify calls. When false or omitted (default), serialize classify so only one runs at a time. Deterministic rails and dynamic-list hits bypass the queue.",
  }),
}).annotate({ identifier: "PermissionModule.Options" })

/** Top-level map of permission module id → options. */
export const Info = Schema.Record(Schema.String, Options).annotate({
  identifier: "PermissionModule.Info",
  description: "Per-module options keyed by module id (built-in: cruise_control)",
})
export type Info = typeof Info.Type

/** Generic host-facing module decision. Built-in cruise_control uses only allow or deny. */
export const Decision = Schema.Literals(["allow", "deny", "ask"]).annotate({
  identifier: "PermissionModule.Decision",
})
export type Decision = typeof Decision.Type
