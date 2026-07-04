export * as Tools from "./tools"

import { Context, Effect, Scope } from "effect"
import { Tool } from "./tool"

export type RegisterOptions = Tool.RegisterOptions

export interface Interface {
  readonly register: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
    options?: Tool.RegisterOptions,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
}

/** Narrow registration-only Location capability. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Tools") {}
