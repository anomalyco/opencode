export * as Tool from "./tool"

import { Effect, Scope } from "effect"
import type { AnyTool, RegistrationError } from "../tool/tool"

export { Failure, RegistrationError, make } from "../tool/tool"
export type { AnyTool, Content, Context, Definition } from "../tool/tool"

export interface Interface {
  /**
   * Register same-process tools on this OpenCode instance for the current Scope.
   * Location tools with the same name take precedence where they are installed.
   * Closing the Scope removes the tools immediately, so calls that have not
   * started settling may fail because the tool is no longer available.
   */
  readonly register: (tools: Readonly<Record<string, AnyTool>>) => Effect.Effect<void, RegistrationError, Scope.Scope>
}
