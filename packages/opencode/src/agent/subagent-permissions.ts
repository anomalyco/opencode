import type { Permission } from "../permission"
import type { Agent } from "./agent"
import { HashSet, Result, pipe, Iterable, Array } from "effect"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent **agent's** edit-class deny rules that the subagent lacks (more
 *    in 'Note' below); Plan Mode's file-edit restriction lives on the agent ruleset,
 *    not on the session.
 * 2. The parent **session's** deny rules and external_directory rules.
 * 3. Default `todowrite` and `task` denies if the subagent's own ruleset
 *    doesn't already permit them.
 *
 * **Note**: Mutual edit permissions between parent agent and subagent
 * are ignored to avoid blocking glob patterns like `*`. E.g., a `plan`
 * agent and a `research` agent could write to `.opencode/plans` and
 * `.opencode/research`, respectively, and both have edit permission
 * `"*": "deny"`. If `plan` would delegate work to `research`, `research`
 * would lose it's permission to write to `.opencode/research` due to the
 * nature of permission rule evaluation (last match applies).
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: Permission.Ruleset
  parentAgent: Agent.Info | undefined
  subagent: Agent.Info
}): Permission.Ruleset {
  const { parentSessionPermission, parentAgent, subagent } = input
  const canTask = subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = subagent.permission.some((rule) => rule.permission === "todowrite")

  const sessionPermission = parentSessionPermission.filter(
    (rule) => rule.permission === "external_directory" || rule.action === "deny",
  )

  const overridingParentPermissions = inheritParentPermissions(parentAgent?.permission ?? [], subagent.permission, {
    permission: "edit",
    action: "deny",
  })
  return [
    ...overridingParentPermissions,
    ...sessionPermission,
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
  ]
}

function inheritParentPermissions(
  parent: Permission.Ruleset,
  child: Permission.Ruleset,
  opts: Omit<Permission.Rule, "pattern">,
): Permission.Ruleset {
  const { permission, action } = opts
  const f = (p: Permission.Rule) =>
    p.permission === permission && p.action === action ? Result.succeed(p.pattern) : Result.failVoid

  const parentPermissions = HashSet.fromIterable(Iterable.filterMap(parent, f))
  const childPermissions = HashSet.fromIterable(Iterable.filterMap(child, f))

  const diff = HashSet.difference(parentPermissions, childPermissions)

  return pipe(
    parent,
    Iterable.filter((p) => p.permission === permission && HashSet.has(diff, p.pattern)),
    Array.fromIterable,
  )
}
