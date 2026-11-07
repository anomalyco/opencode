import type { PermissionApi } from "@Mackery6969/client/effect/api"
import type { Agent } from "@Mackery6969/schema/agent"
import type { Permission } from "@Mackery6969/schema/permission"
import type { Session } from "@Mackery6969/schema/session"
import type { Tool } from "@Mackery6969/schema/tool"
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
}

export interface PermissionHooks {
  readonly evaluate: PermissionEvaluation
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
