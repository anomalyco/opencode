export * as ShellEnvironment from "./shell-environment"

import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly get: (input: {
    directory: string
    cwd: string
    sessionID?: string
    callID?: string
  }) => Effect.Effect<Record<string, string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ShellEnvironment") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    get: () => Effect.succeed({}),
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
