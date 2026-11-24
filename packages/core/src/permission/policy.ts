export * as PermissionPolicy from "./policy.js"

import type { Permission } from "@opencode/schema/permission"
import { Wildcard } from "../util/wildcard.js"

/** Actions whose resources are file paths. */
export const pathActions = ["external_directory", "read", "edit"] as const

/** macOS volumes ignore case by default, so `.OPENCODE/x` opens `.opencode/x`; rules for file paths must match it too. */
export function ignoresCase(action: string) {
  return process.platform === "darwin" && pathActions.some((item) => item === action)
}

export interface Deny {
  readonly action: string
  readonly resource: string
}

/**
 * Composable permission policy separating three distinct semantics:
 * - `override`: ordered last-match-wins layers (defaults -> agent -> session)
 * - `restrict`: monotone deny-wins restrictions (cannot be undone by `fallback`)
 * - `fallback`: ask-settling layers (e.g. saved approvals), never overrides `deny` or `allow`
 */
export type Policy =
  | { readonly _tag: "rules"; readonly rules: Permission.Ruleset }
  | { readonly _tag: "override"; readonly base: Policy; readonly next: Permission.Ruleset }
  | { readonly _tag: "restrict"; readonly base: Policy; readonly denies: ReadonlyArray<Deny> }
  | { readonly _tag: "fallback"; readonly base: Policy; readonly secondary: Policy }

export const empty: Policy = { _tag: "rules", rules: [] }

export function fromRules(...rulesets: Permission.Ruleset[]): Policy {
  return { _tag: "rules", rules: rulesets.flat() }
}

/** Last-match-wins layer on top of `base`. */
export function override(base: Policy, ...rulesets: Permission.Ruleset[]): Policy {
  const next = rulesets.flat()
  if (next.length === 0) return base
  if (base._tag === "rules") return { _tag: "rules", rules: [...base.rules, ...next] }
  return { _tag: "override", base, next }
}

/** Monotone deny layer: matching `denies` always yield `deny` and cannot be undone by `fallback`. */
export function restrict(base: Policy, denies: ReadonlyArray<Deny>): Policy {
  if (denies.length === 0) return base
  return { _tag: "restrict", base, denies }
}

/** Settles `ask` results using `secondary`; `deny` and `allow` from `base` are preserved unchanged. */
export function fallback(base: Policy, secondary: Policy): Policy {
  return { _tag: "fallback", base, secondary }
}

function matchLast(rules: Permission.Ruleset, action: string, resource: string): Permission.Rule | undefined {
  const ignoreCase = ignoresCase(action)
  return rules.findLast(
    (rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource, ignoreCase),
  )
}

function evaluateOption(policy: Policy, action: string, resource: string): Permission.Rule | undefined {
  switch (policy._tag) {
    case "rules":
      return matchLast(policy.rules, action, resource)
    case "override":
      return matchLast(policy.next, action, resource) ?? evaluateOption(policy.base, action, resource)
    case "restrict": {
      const ignoreCase = ignoresCase(action)
      const denied = policy.denies.findLast(
        (rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource, ignoreCase),
      )
      if (denied) return { action: denied.action, resource: denied.resource, effect: "deny" }
      return evaluateOption(policy.base, action, resource)
    }
    case "fallback": {
      const primary = evaluateOption(policy.base, action, resource)
      if (primary !== undefined && primary.effect !== "ask") return primary
      return evaluateOption(policy.secondary, action, resource) ?? primary
    }
  }
}

export function evaluate(policy: Policy, action: string, resource: string): Permission.Rule {
  return evaluateOption(policy, action, resource) ?? { action, resource: "*", effect: "ask" }
}

/** Combines resource evaluations under the effect lattice (`deny > ask > allow`). */
export function evaluateAll(policy: Policy, action: string, resources: ReadonlyArray<string>): Permission.Effect {
  const effects = resources.map((resource) => evaluate(policy, action, resource).effect)
  if (effects.includes("deny")) return "deny"
  if (effects.includes("ask")) return "ask"
  return "allow"
}

function reduceActionDenied(initial: boolean, rules: Permission.Ruleset, action: string): boolean {
  return rules.reduce((denied, rule) => {
    if (!Wildcard.match(action, rule.action)) return denied
    if (rule.resource === "*") return rule.effect === "deny"
    return rule.effect === "deny" ? denied : false
  }, initial)
}

/**
 * Sound whole-action denial check: true only when every resource for `action` is guaranteed `deny`.
 * Narrow denies never undo a blanket deny and never wholly deny an otherwise reachable action.
 */
export function isActionDenied(policy: Policy, action: string): boolean {
  switch (policy._tag) {
    case "rules":
      return reduceActionDenied(false, policy.rules, action)
    case "override":
      return reduceActionDenied(isActionDenied(policy.base, action), policy.next, action)
    case "restrict":
      return (
        policy.denies.some((rule) => Wildcard.match(action, rule.action) && rule.resource === "*") ||
        isActionDenied(policy.base, action)
      )
    case "fallback":
      return isActionDenied(policy.base, action)
  }
}

/** True when any rule in `policy` can deny `action`. */
export function hasDeny(policy: Policy, action: string): boolean {
  switch (policy._tag) {
    case "rules":
      return policy.rules.some((rule) => rule.effect === "deny" && Wildcard.match(action, rule.action))
    case "override":
      return (
        policy.next.some((rule) => rule.effect === "deny" && Wildcard.match(action, rule.action)) ||
        hasDeny(policy.base, action)
      )
    case "restrict":
      return policy.denies.some((rule) => Wildcard.match(action, rule.action)) || hasDeny(policy.base, action)
    case "fallback":
      return hasDeny(policy.base, action) || hasDeny(policy.secondary, action)
  }
}

/** All rules matching `action` in evaluation order (for diagnostics and `BlockedError`). */
export function relevant(policy: Policy, action: string): Permission.Ruleset {
  switch (policy._tag) {
    case "rules":
      return policy.rules.filter((rule) => Wildcard.match(action, rule.action))
    case "override":
      return [...relevant(policy.base, action), ...policy.next.filter((rule) => Wildcard.match(action, rule.action))]
    case "restrict":
      return [
        ...relevant(policy.base, action),
        ...policy.denies.flatMap((rule) =>
          Wildcard.match(action, rule.action)
            ? [{ action: rule.action, resource: rule.resource, effect: "deny" as const }]
            : [],
        ),
      ]
    case "fallback":
      return [...relevant(policy.base, action), ...relevant(policy.secondary, action)]
  }
}

/** Resource-scoped rules (`resource !== "*"`) matching `action`, in evaluation order. */
export function scopedRules(policy: Policy, action: string): Permission.Ruleset {
  return relevant(policy, action).filter((rule) => rule.resource !== "*")
}
