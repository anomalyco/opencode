export * as Tools from "./tools"

import { Context, Effect, Scope } from "effect"
import { Tool } from "./tool"

export type ExecutePath = readonly [namespace: string, name: string]

export interface RegisterOptions {
  /** Internal projection metadata. The tool remains one canonical registration. */
  readonly execute?: Readonly<Record<string, ExecutePath>>
}

export interface Interface {
  readonly register: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
    options?: RegisterOptions,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
}

/** Narrow registration-only Location capability. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Tools") {}
