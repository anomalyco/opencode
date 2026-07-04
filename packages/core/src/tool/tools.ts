export * as Tools from "./tools"

import { Context, Effect, Scope } from "effect"
import { Tool } from "./tool"

export type CodeModeTools = Readonly<Record<string, Readonly<Record<string, Tool.AnyTool>>>>

export interface Interface {
  readonly register: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
  /**
   * Internal bridge until the plugin tool catalog can project tools registered by other plugins.
   * Do not expose this through PluginContext.
   */
  readonly codeMode: {
    readonly register: (tools: CodeModeTools) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
  }
}

/** Narrow registration-only Location capability. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Tools") {}
