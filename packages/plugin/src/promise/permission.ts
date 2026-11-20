import type { PermissionApi } from "@opencode/client/promise/api"
import type { Agent } from "@opencode/schema/agent"
import type { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import type { AssertInput } from "../permission.js"
import type { Hooks } from "./registration.js"

export interface PermissionEvaluation {
  readonly sessionID: Session.ID
  readonly agent?: Agent.ID
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
  readonly source?: Permission.Source
  effect: Permission.Effect
  message?: string
}

/**
 * Runs whenever core builds the rules for an agent in a Session: for every permission check, every step's listing of
 * tools, skills and MCP servers, and every unattended automation run. A hook can only narrow them. Each `deny` adds
 * `{ action, resource, effect: "deny" }` after the agent's and the Session's rules, so it wins over any configured
 * `allow` or `ask`, and `evaluate` hooks do not run for a request it refuses. `rules` and `session` are frozen copies
 * and core keeps the added denies, so no hook can allow, edit, reorder or remove a rule or another hook's deny. A deny
 * that is not two strings, or a hook that throws, fails the check or step instead of proceeding without it. Keep the
 * hook fast and do not request a permission from it (such as `permission.assert`), which runs it again. Until a
 * plugin has registered the hook, rules are built without it. Experimental.
 */
export interface PermissionRules {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  /** The agent's rules, then the Session's, before any hook's deny. */
  readonly rules: ReadonlyArray<Permission.Rule>
  /** The Session's own rules, which also end `rules`. */
  readonly session: ReadonlyArray<Permission.Rule>
  /** Adds a deny after `rules`. Denies apply in the order hooks add them. */
  readonly deny: (rule: { readonly action: string; readonly resource: string }) => void
}

export interface PermissionHooks {
  readonly evaluate: PermissionEvaluation
  readonly "experimental.rules": PermissionRules
}

export type PermissionDomain = Pick<PermissionApi, "list" | "get" | "reply"> & {
  readonly hook: Hooks<PermissionHooks>
  /**
   * Evaluates the session's permission rules and, when approval is required, prompts the user and
   * waits for the reply. Resolves when allowed. A deny rule or a rejection with feedback rejects with
   * a `Tool.Error` carrying the reason. A plain rejection rejects with an error that ends the current
   * step; rethrow it rather than returning it as tool output.
   */
  readonly assert: (input: typeof AssertInput.Encoded) => Promise<void>
}
