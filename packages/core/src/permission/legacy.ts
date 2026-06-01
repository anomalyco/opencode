export * as PermissionLegacy from "./legacy"

import { Schema } from "effect"

export const Action = Schema.Literals(["allow", "deny", "ask"]).annotate({ identifier: "Permission.Action" })
export type Action = typeof Action.Type

export const Rule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action,
}).annotate({ identifier: "Permission.Rule" })
export type Rule = typeof Rule.Type

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "Permission.Ruleset" })
export type Ruleset = typeof Ruleset.Type
