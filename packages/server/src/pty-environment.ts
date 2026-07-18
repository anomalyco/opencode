export * as PtyEnvironment from "./pty-environment"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@kancode/core/effect/app-node"

export interface Interface {
  readonly get: (input: { directory: string; cwd: string }) => Effect.Effect<Record<string, string>>
}

export class Service extends Context.Service<Service, Interface>()("@kancode/ServerPtyEnvironment") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    get: () => Effect.succeed({}),
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
