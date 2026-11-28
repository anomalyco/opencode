export * as PermissionPolicy from "./policy.js"

import type { Permission } from "@opencode/schema/permission"
import { Wildcard } from "../util/wildcard.js"

/** Actions whose resources are file paths. */
export const pathActions = ["external_directory", "read", "edit"] as const

/** macOS volumes ignore case by default, so `.OPENCODE/x` opens `.opencode/x`; rules for file paths must match it too. */
export function ignoresCase(action: string, resource?: string) {
  if (!pathActions.some((item) => item === action)) return false
  // A Windows machine's paths (`win:C:/…`, `win://server/…`) ignore case too, whatever this server runs on.
  return process.platform === "darwin" || (resource !== undefined && WINDOWS_MACHINE_PATH.test(resource))
}

const WINDOWS_MACHINE_PATH = /^[a-z][a-z0-9-]{1,62}:(?:[A-Za-z]:\/|\/\/)/

/**
 * True when `pattern` matches every possible string under `Wildcard.match`:
 * one or more `*`, optionally followed by trailing ` *` (which compiles to `( .*)?`).
 */
export function isUniversalPattern(pattern: string): boolean {
  return /^\*+(?: \*)?$/.test(pattern)
}

export interface Deny {
  readonly action: string
  readonly resource: string
}

/**
 * Composable permission policy separating three distinct semantics:
 * - `override`: ordered last-match-wins layers (defaults -> agent -> session)
 * - `restrict`: monotone deny-wins restrictions (floats above `override` and cannot be undone by `fallback`)
 * - `fallback`: ask-settling layers (e.g. saved approvals), never overrides `deny` or `allow`
 */
export type Policy =
  | { readonly _tag: "rules"; readonly rules: Permission.Ruleset }
  | { readonly _tag: "override"; readonly base: Policy; readonly next: Permission.Ruleset }
  | { readonly _tag: "restrict"; readonly base: Policy; readonly denies: ReadonlyArray<Deny> }
  | { readonly _tag: "fallback"; readonly base: Policy; readonly secondary: Policy }

export const empty: Policy = { _tag: "rules", rules: [] }

function isEmpty(policy: Policy): boolean {
  return policy._tag === "rules" && policy.rules.length === 0
}

export function fromRules(...rulesets: Permission.Ruleset[]): Policy {
  return { _tag: "rules", rules: rulesets.flat() }
}

/** Last-match-wins layer on top of `base`; preserves inner `restrict` monotonicity. */
export function override(base: Policy, ...rulesets: Permission.Ruleset[]): Policy {
  const next = rulesets.flat()
  if (next.length === 0) return base
  if (base._tag === "rules") return { _tag: "rules", rules: [...base.rules, ...next] }
  if (base._tag === "restrict") return { _tag: "restrict", base: override(base.base, next), denies: base.denies }
  return { _tag: "override", base, next }
}

/** Monotone deny layer: matching `denies` always yield `deny` and cannot be undone by `override` or `fallback`. */
export function restrict(base: Policy, denies: ReadonlyArray<Deny>): Policy {
  if (denies.length === 0) return base
  const copied = denies.map((rule) => ({ action: rule.action, resource: rule.resource }))
  if (base._tag === "restrict") return { _tag: "restrict", base: base.base, denies: [...base.denies, ...copied] }
  return { _tag: "restrict", base, denies: copied }
}

/** Settles `ask` results using `secondary`; `deny` and `allow` from `base` are preserved unchanged. */
export function fallback(base: Policy, secondary: Policy): Policy {
  if (isEmpty(base)) return secondary
  if (isEmpty(secondary)) return base
  if (base._tag === "restrict") return { _tag: "restrict", base: fallback(base.base, secondary), denies: base.denies }
  return { _tag: "fallback", base, secondary }
}

function matchLast(rules: Permission.Ruleset, action: string, resource: string): Permission.Rule | undefined {
  const ignoreCase = ignoresCase(action, resource)
  return rules.findLast(
    (rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource, ignoreCase),
  )
}

function evaluateRule(policy: Policy, action: string, resource: string): Permission.Rule | undefined {
  switch (policy._tag) {
    case "rules":
      return matchLast(policy.rules, action, resource)
    case "override":
      return matchLast(policy.next, action, resource) ?? evaluateRule(policy.base, action, resource)
    case "restrict": {
      const ignoreCase = ignoresCase(action, resource)
      const denied = policy.denies.findLast(
        (rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource, ignoreCase),
      )
      if (denied) return { action: denied.action, resource: denied.resource, effect: "deny" }
      return evaluateRule(policy.base, action, resource)
    }
    case "fallback": {
      const primary = evaluateRule(policy.base, action, resource)
      if (primary !== undefined && primary.effect !== "ask") return primary
      return evaluateRule(policy.secondary, action, resource) ?? primary
    }
  }
}

export function evaluate(policy: Policy, action: string, resource: string): Permission.Rule {
  return evaluateRule(policy, action, resource) ?? { action, resource: "*", effect: "ask" }
}

/** Combines resource evaluations under the effect lattice (`deny > ask > allow`). */
export function evaluateAll(policy: Policy, action: string, resources: ReadonlyArray<string>): Permission.Effect {
  const effects = resources.map((resource) => evaluate(policy, action, resource).effect)
  if (effects.includes("deny")) return "deny"
  if (effects.includes("ask")) return "ask"
  return "allow"
}

function foldReachable(
  initial: ReadonlySet<Permission.Effect>,
  rules: Permission.Ruleset,
  action: string,
): Set<Permission.Effect> {
  const reachable = new Set<Permission.Effect>(initial)
  for (const rule of rules) {
    if (!Wildcard.match(action, rule.action)) continue
    if (isUniversalPattern(rule.resource)) {
      reachable.clear()
      reachable.add(rule.effect)
      continue
    }
    reachable.add(rule.effect)
  }
  return reachable
}

/**
 * Sound over-approximation of effects `evaluate(policy, action, r)` can return for any resource `r`.
 * Every concrete `evaluate` outcome is guaranteed to be a member of the returned set.
 */
export function reachableEffects(policy: Policy, action: string): ReadonlySet<Permission.Effect> {
  switch (policy._tag) {
    case "rules":
      return foldReachable(new Set<Permission.Effect>(["ask"]), policy.rules, action)
    case "override":
      return foldReachable(reachableEffects(policy.base, action), policy.next, action)
    case "restrict": {
      const matching = policy.denies.filter((rule) => Wildcard.match(action, rule.action))
      if (matching.length === 0) return reachableEffects(policy.base, action)
      if (matching.some((rule) => isUniversalPattern(rule.resource))) return new Set<Permission.Effect>(["deny"])
      const result = new Set<Permission.Effect>(reachableEffects(policy.base, action))
      result.add("deny")
      return result
    }
    case "fallback": {
      const base = reachableEffects(policy.base, action)
      if (!base.has("ask")) return base
      const result = new Set<Permission.Effect>(base)
      result.delete("ask")
      for (const effect of reachableEffects(policy.secondary, action)) result.add(effect)
      return result
    }
  }
}

/**
 * Sound whole-action denial check: true only when every resource for `action` is guaranteed `deny`.
 * Narrow denies never undo a blanket deny and never wholly deny an otherwise reachable action.
 */
export function isActionDenied(policy: Policy, action: string): boolean {
  const effects = reachableEffects(policy, action)
  return effects.size === 1 && effects.has("deny")
}

/** Sound check for whether any resource of `action` can evaluate to `deny`. */
export function hasDeny(policy: Policy, action: string): boolean {
  return reachableEffects(policy, action).has("deny")
}

/**
 * Diagnostic list of rules matching `action` for error reporting (`BlockedError.rules`).
 * For `fallback`, lower-precedence `secondary` rules appear before `base` (and are omitted when `base` cannot ask);
 * note that a general `fallback` cannot be losslessly flattened into a last-match-wins ruleset.
 */
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
    case "fallback": {
      const base = relevant(policy.base, action)
      if (!reachableEffects(policy.base, action).has("ask")) return base
      return [...relevant(policy.secondary, action), ...base]
    }
  }
}

function liveScoped(initial: Permission.Ruleset, rules: Permission.Ruleset, action: string): Permission.Ruleset {
  return rules.reduce<Permission.Rule[]>(
    (acc, rule) => {
      if (!Wildcard.match(action, rule.action)) return acc
      if (isUniversalPattern(rule.resource)) return []
      acc.push(rule)
      return acc
    },
    [...initial],
  )
}

/**
 * Live non-universal rules matching `action` that have not been superseded by a later universal rule.
 * Used to preserve scoped `ask`/`deny` constraints without resurrecting overridden rules.
 */
export function scopedRules(policy: Policy, action: string): Permission.Ruleset {
  switch (policy._tag) {
    case "rules":
      return liveScoped([], policy.rules, action)
    case "override":
      return liveScoped(scopedRules(policy.base, action), policy.next, action)
    case "restrict": {
      const matching = policy.denies.filter((rule) => Wildcard.match(action, rule.action))
      if (matching.some((rule) => isUniversalPattern(rule.resource))) return []
      return [
        ...scopedRules(policy.base, action),
        ...matching.map((rule) => ({ action: rule.action, resource: rule.resource, effect: "deny" as const })),
      ]
    }
    case "fallback": {
      const base = scopedRules(policy.base, action)
      if (!reachableEffects(policy.base, action).has("ask")) return base
      return [...scopedRules(policy.secondary, action), ...base]
    }
  }
}
