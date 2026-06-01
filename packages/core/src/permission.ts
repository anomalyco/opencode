export * as PermissionV2 from "./permission"

import { Schema } from "effect"
import { Wildcard } from "./util/wildcard"
import { Identifier } from "./id/id"
import { Newtype } from "./schema"

export class PermissionID extends Newtype<PermissionID>()(
  "PermissionID",
  Schema.String.check(Schema.isStartsWith("per")),
) {
  static ascending(id?: string): PermissionID {
    return this.make(Identifier.ascending("permission", id))
  }
}

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

const EDIT_TOOLS = ["edit", "write", "apply_patch"]

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
      action: "ask",
      permission,
      pattern: "*",
    }
  )
}

export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  return new Set(
    tools.filter((tool) => {
      const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
      const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
      return rule?.pattern === "*" && rule.action === "deny"
    }),
  )
}
