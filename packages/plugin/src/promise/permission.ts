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
 * The rules for one agent in one Session. They decide its permission requests and what its steps list: a tool whose
 * permission they deny outright is not listed, and neither is a skill or MCP server they deny. Rules a hook appends
 * are evaluated after the Session's. Experimental: may change without compatibility guarantees.
 */
export interface PermissionRules {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  /** The Session's own rules, which follow the agent's in `rules`. */
  readonly session: ReadonlyArray<Permission.Rule>
  /** The agent's rules, then the Session's. */
  rules: Array<Permission.Rule>
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
