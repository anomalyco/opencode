import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Agent } from "./agent"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent session's effective deny rules and external_directory rules.
 *    Parent agent restrictions only govern that agent; the subagent's own
 *    permissions determine its capabilities.
 * 2. Default `todowrite` and `task` denies if the subagent's own ruleset
 *    doesn't already permit them.
 *
 * Session permission rules are append-only and evaluated last-match-wins, so
 * a deny that a later rule supersedes for the same permission and pattern is
 * no longer part of the parent's effective ceiling and must not be copied.
 * A parent whose history is `[bash deny, bash allow]` is effectively allowed;
 * copying the stale deny alone would leave every new subagent permanently
 * denied. Denies are still inherited whenever the superseding rule targets a
 * different pattern, keeping partial overrides conservative.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  const rules = input.parentSessionPermission
  return [
    ...rules.filter(
      (rule, index) =>
        rule.permission === "external_directory" ||
        (rule.action === "deny" &&
          !rules.some(
            (later, laterIndex) =>
              laterIndex > index && later.permission === rule.permission && later.pattern === rule.pattern,
          )),
    ),
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
  ]
}
