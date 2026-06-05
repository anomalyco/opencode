export * as Tool from "./tool"

import { Effect, Scope } from "effect"
import type { NativeTool } from "../tool/native"

export { Failure, make } from "../tool/native"
export type { Any, Content, Context, Executable } from "../tool/native"

export interface Service {
  /**
   * Attach same-process tools to this OpenCode instance for the current Scope.
   * Location tools with the same name take precedence where they are installed.
   * Closing the Scope removes the tools immediately, so calls that have not
   * started settling may fail because the tool is no longer available.
   */
  readonly attach: (
    tools: Readonly<Record<string, NativeTool.Any>>,
  ) => Effect.Effect<void, never, Scope.Scope>
}
