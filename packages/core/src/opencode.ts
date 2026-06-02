export * as OpenCode from "./opencode"

import { Context, Effect, Layer } from "effect"
import { SessionV2 } from "./session"

export interface Interface {
  readonly sessions: SessionV2.Interface
}

/** Public embedded OpenCode API for Effect-native applications. */
export class Service extends Context.Service<Service, Interface>()("@opencode/OpenCode") {}

// TODO: Accept explicit storage so tests and embeddings can select disposable or application-owned persistence.
export const layer = () =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      return Service.of({ sessions: yield* SessionV2.Service })
    }),
  ).pipe(Layer.provide(SessionV2.defaultLayer))

// TODO: Add OpenCode.create(...) as the Promise facade over the same embedded API semantics.
