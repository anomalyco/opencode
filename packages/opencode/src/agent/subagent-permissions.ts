import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Agent } from "./agent"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent session's external_directory rules, plus deny rules for
 *    write-capable permissions (edit, write, apply_patch, bash).
 *    Broadly inheriting ALL parent denies (as done prior to this fix) breaks
 *    subagents like `explore` that explicitly allow `bash` for read-only
 *    operations — their own permission rules are overridden by inherited denies.
 * 2. Default `todowrite` and `task` denies if the subagent's own ruleset
 *    doesn't already permit them.
 */
const WRITE_PERMISSIONS = new Set(["edit", "write", "apply_patch", "bash"])

export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  return [
    ...input.parentSessionPermission.filter(
      (rule) =>
        rule.permission === "external_directory" ||
        (rule.action === "deny" && WRITE_PERMISSIONS.has(rule.permission)),
    ),
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
  ]
}
