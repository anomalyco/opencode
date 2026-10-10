export * as CredentialRefresh from "./refresh.js"

import { Context, Effect, Fiber, Layer } from "effect"
import { Credential } from "@opencode/schema/credential"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

export interface Interface {
  readonly run: (
    id: Credential.ID,
    operation: Effect.Effect<Credential.OAuth | undefined, unknown>,
  ) => Effect.Effect<Credential.OAuth | undefined, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CredentialRefresh") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const pending = new Map<Credential.ID, Fiber.Fiber<Credential.OAuth | undefined, unknown>>()

    return Service.of({
      run: Effect.fn("CredentialRefresh.run")((id, operation) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const current = pending.get(id)
            if (current) return yield* restore(Fiber.join(current))
            // The global scope owns the refresh, not the first Session or Location waiting for it.
            const fiber = yield* operation.pipe(
              Effect.ensuring(Effect.sync(() => pending.delete(id))),
              Effect.forkIn(scope),
            )
            pending.set(id, fiber)
            return yield* restore(Fiber.join(fiber))
          }),
        ),
      ),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
