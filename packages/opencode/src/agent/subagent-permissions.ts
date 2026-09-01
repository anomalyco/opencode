import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Agent } from "./agent"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent session's deny rules and external_directory rules.
 *    Parent agent restrictions only govern that agent; the subagent's own
 *    permissions determine its capabilities.
 * 2. Default `todowrite` and `task` denies if the subagent's own ruleset
 *    doesn't already permit them.
 * 3. Optional allowed_tools / forbidden_tools overrides from the orchestrator.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
  allowed_tools?: string[]
  forbidden_tools?: string[]
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")

  const base: PermissionV1.Rule[] = [
    ...input.parentSessionPermission.filter(
      (rule) => rule.permission === "external_directory" || rule.action === "deny",
    ),
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
  ]

  // Compute tool restrictions. allowed_tools takes precedence over forbidden_tools.
  // These are appended LAST so they win via findLast() resolution.
  const toolRestrictions: PermissionV1.Rule[] = []
  if (input.allowed_tools && input.allowed_tools.length > 0) {
    // Deny everything first, then allow only the specified tools.
    // System denies (todowrite, task) remain enforced because they appear earlier.
    toolRestrictions.push({ permission: "*", pattern: "*", action: "deny" })
    for (const tool of input.allowed_tools) {
      toolRestrictions.push({ permission: tool, pattern: "*", action: "allow" })
    }
  } else if (input.forbidden_tools && input.forbidden_tools.length > 0) {
    for (const tool of input.forbidden_tools) {
      toolRestrictions.push({ permission: tool, pattern: "*", action: "deny" })
    }
  }

  return [...base, ...toolRestrictions]
}
