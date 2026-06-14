import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Agent } from "./agent"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool or the subtask (@agent) path. This function is the SINGLE
 * source of the task/todowrite auto-denies (task.ts keeps only the
 * `experimental.primary_tools` denies). Combines:
 *
 * 1. The parent session's deny rules and external_directory rules.
 *    Parent agent restrictions only govern that agent; the subagent's own
 *    permissions determine its capabilities. Inherited denies are monotone
 *    ceilings: a deny on level ≤ n can never evaluate to allow on level n+1.
 * 2. A default `todowrite` deny if the subagent's own ruleset doesn't
 *    already permit it (unchanged by nesting).
 * 3. Depth gating (design-final §4.1, defense line 1): the `task` deny is
 *    added ONLY for a child at the maximum nesting depth
 *    (childDepth >= maxDepth) — the last level is a pure work level that
 *    never spawns, regardless of the agent's own config. Below the limit no
 *    auto-deny is emitted; spawn capability is governed by the agent's
 *    permission via the runtime merge (tools.ts / llm/request.ts), so the
 *    default wildcard `'*': allow` suffices and no exact `task` rule is
 *    required anymore. Because the auto-deny only ever lands on the
 *    never-spawning last level, it cannot be wrongly re-inherited down a
 *    spawning chain (the former sticky-deny problem).
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
  /** Depth of the child session being spawned (the root session is depth 1). */
  childDepth: number
  /** Effective maximum nesting depth — resolve via `SubagentLimits.maxDepth(cfg)`. */
  maxDepth: number
}): PermissionV1.Ruleset {
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  const atLimit = input.childDepth >= input.maxDepth
  return [
    ...input.parentSessionPermission.filter(
      (rule) => rule.permission === "external_directory" || rule.action === "deny",
    ),
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(atLimit ? [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }] : []),
  ]
}
