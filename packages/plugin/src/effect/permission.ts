import type { PermissionApi } from "@opencode/client/effect/api"
import type { Agent } from "@opencode/schema/agent"
import type { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import type { Tool } from "@opencode/schema/tool"
import type { Effect } from "effect"
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
  /** Experimental: may change without compatibility guarantees. */
  readonly experimental?: {
    /**
     * True when the user's saved "always" approvals allow every resource of this request. A hook that asks only
     * because its own rules say so can leave `effect` alone then, so the user's saved answer stands. An `ask` a hook
     * sets is never overridden.
     */
    readonly approved: boolean
    /** True when every proposed save key was previously saved verbatim for this action. Does not change rule evaluation. */
    readonly approvedSave?: boolean
  }
}

/**
 * Runs whenever core builds the rules for one agent in one Session: for every permission check and every step. The
 * rules decide the agent's permission requests and what its steps list: a tool whose permission they deny outright is
 * not listed, and neither is a skill or MCP server they deny.
 *
 * A hook can only narrow them. Each entry it passes to `deny` becomes `{ action, resource, effect: "deny" }` after
 * every other rule, so it outranks every allow and ask; other fields of an entry are ignored. Core keeps each entry
 * itself, so no hook can remove another's. The event is frozen, and `rules` and `session` are copies: changing them
 * changes nothing. An entry that is not two strings fails the check or step that built the rules. The hook must be quick and must not request permissions itself (for example with `permission.assert`), which
 * would build the rules again and run the hook again without end. Experimental: may change without compatibility
 * guarantees.
 */
export interface PermissionRules {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  /** The agent's rules, then the Session's, as evaluated before any `deny` entry. */
  readonly rules: ReadonlyArray<Permission.Rule>
  /** The Session's own rules, which follow the agent's in `rules`. */
  readonly session: ReadonlyArray<Permission.Rule>
  /** Adds a deny after `rules`. Denies apply in the order the hooks add them. */
  readonly deny: (rule: { readonly action: string; readonly resource: string }) => void
}

export interface PermissionHooks {
  readonly evaluate: PermissionEvaluation
  readonly "experimental.rules": PermissionRules
}

export type PermissionDomain = Pick<PermissionApi<unknown>, "list" | "get" | "reply"> & {
  readonly hook: Hooks<PermissionHooks>
  /**
   * Evaluates the session's permission rules and, when approval is required, prompts the user and
   * waits for the reply. Succeeds when allowed. A deny rule or a rejection with feedback fails with a
   * `Tool.Error` carrying the reason; a plain rejection ends the current step.
   */
  readonly assert: (input: AssertInput) => Effect.Effect<void, Tool.Error>
}
