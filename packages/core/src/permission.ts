export * as PermissionV2 from "./permission"

import { Schema } from "effect"
import { Wildcard } from "./util/wildcard"

export const Action = Schema.Literals(["allow", "deny", "ask"]).annotate({ identifier: "PermissionV2.Action" })
export type Action = typeof Action.Type

export const Rule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action,
}).annotate({ identifier: "PermissionV2.Rule" })
export type Rule = typeof Rule.Type

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "PermissionV2.Ruleset" })
export type Ruleset = typeof Ruleset.Type

const EDIT_TOOLS = ["edit", "write", "apply_patch"]

/**
 * Resolve the effective rule for a (permission, pattern) pair.
 *
 * Rules are flattened across rulesets and the LAST matching rule wins
 * ("last match wins"), so more specific or later rules override earlier ones.
 * A rule matches when both its `permission` glob matches `permission` AND its
 * `pattern` glob matches `pattern`. When nothing matches, the default is `ask`.
 */
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

/**
 * Determine which tools should be fully hidden/disabled in the UI.
 *
 * INTENTIONAL semantics (see permission-task.test.ts): a tool is disabled only
 * when the LAST rule whose `permission` glob matches the tool is a blanket deny
 * (`pattern === "*" && action === "deny"`). Consequences worth knowing:
 * - A narrower allow that comes AFTER a blanket deny re-enables the tool
 *   (the last matching rule is no longer the `*` deny).
 * - Conversely, narrower allows that come BEFORE a trailing blanket `*` deny do
 *   NOT keep the tool enabled — the blanket deny still hides it, even though
 *   `evaluate()` may still permit specific patterns at call time. This asymmetry
 *   with `evaluate()` is deliberate: `disabled()` is a coarse UI gate, while
 *   `evaluate()` is the precise per-call check.
 * Edit-family tools (edit/write/apply_patch) are collapsed onto the `edit`
 * permission before matching.
 */
export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  return new Set(
    tools.filter((tool) => {
      const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
      const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
      return rule?.pattern === "*" && rule.action === "deny"
    }),
  )
}
