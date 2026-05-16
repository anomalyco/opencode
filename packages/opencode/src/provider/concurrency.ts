import { Context, Effect, Layer, Scope, Semaphore } from "effect"
import type { ProviderID } from "./schema"

export interface Interface {
  readonly acquire: (
    providerID: ProviderID,
    maxConcurrency: number | undefined,
  ) => Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProviderConcurrency") {}

export const defaultLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const semaphores = new Map<ProviderID, Semaphore.Semaphore>()

    const get = (providerID: ProviderID, maxConcurrency: number) => {
      const existing = semaphores.get(providerID)
      if (existing) return existing
      const next = Semaphore.makeUnsafe(maxConcurrency)
      semaphores.set(providerID, next)
      return next
    }

    const acquire: Interface["acquire"] = (providerID, maxConcurrency) => {
      if (maxConcurrency === undefined) return Effect.void
      const sem = get(providerID, maxConcurrency)
      return Effect.asVoid(Effect.acquireRelease(sem.take(1), () => sem.release(1)))
    }

    return Service.of({ acquire })
  }),
)

export * as ProviderConcurrency from "./concurrency"
