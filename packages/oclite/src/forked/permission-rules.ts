// forked-from: packages/opencode/src/permission/index.ts@ab6c8a6
// evaluate / fromConfig / expand only: importing the original loads InstanceState + EventV2Bridge (434 modules).
import os from "os"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import type { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"

export function evaluate(permission: string, pattern: string, ...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule {
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

export function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermissionV1.Info) {
  const ruleset: PermissionV1.Rule[] = []
  for (const [key, value] of Object.entries(permission)) {
    // oclite: config layers can leave a key undefined after merging; opencode's input never does.
    if (value === undefined) continue
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
    )
  }
  return ruleset
}
