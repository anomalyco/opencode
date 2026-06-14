export * as PtyEnvironment from "./pty-environment"

import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly get: (input: { directory: string; cwd: string }) => Effect.Effect<Record<string, string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ServerPtyEnvironment") {}

export const defaultLayer = Layer.succeed(
  Service,
  Service.of({
    get: () => Effect.succeed({}),
  }),
)
