export * as Tool from "./tool"

import { Effect, Scope } from "effect"
import type { ApplicationTool } from "../tool/application"
import { ApplicationToolRegistry } from "../tool/application-registry"

export { Failure, make } from "../tool/application"
export type { Any, Content, Context } from "../tool/application"

export const NameConflictError = ApplicationToolRegistry.NameConflictError
export type NameConflictError = ApplicationToolRegistry.NameConflictError

export interface Service {
  /**
   * Attach same-process tools to this OpenCode instance for the current Scope.
   * Location tools with the same name take precedence where they are installed.
   */
  readonly attach: (
    tools: Readonly<Record<string, ApplicationTool.Any>>,
  ) => Effect.Effect<void, NameConflictError, Scope.Scope>
}
