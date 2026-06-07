import { Effect, Scope } from "effect"

export { Failure, RegistrationError, make } from "../tool/tool"
export type { AnyTool, Content, Context, Tool } from "../tool/tool"

export interface Service {
  /**
   * Register same-process tools on this OpenCode instance for the current Scope.
   * Location tools with the same name take precedence where they are installed.
   * Closing the Scope removes the tools immediately, so calls that have not
   * started settling may fail because the tool is no longer available.
   */
  readonly register: (
    tools: Readonly<Record<string, import("../tool/tool").AnyTool>>,
  ) => Effect.Effect<void, import("../tool/tool").RegistrationError, Scope.Scope>
}
