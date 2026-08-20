export * as Initialization from "./initialization"

import type { ServerReadyData } from "../../shared/ipc-contract"
import { Context, Deferred, Effect, Layer } from "effect"

export interface Interface {
  readonly await: Effect.Effect<ServerReadyData>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/Initialization") {}

export const layer = (initialization: Effect.Effect<ServerReadyData>) =>
  Layer.succeed(Service, Service.of({ await: initialization }))

export function forwardInitializationFailure<A>(initialization: Deferred.Deferred<A, unknown>) {
  return <B, E, R>(effect: Effect.Effect<B, E, R>) =>
    effect.pipe(Effect.tapCause((cause) => Deferred.failCause(initialization, cause)))
}
