export * as SystemContextRegistry from "./system-context-registry"

import { Context, Effect, Layer, Ref, Scope } from "effect"
import { SystemContext } from "./system-context"

export interface Contribution {
  readonly key: SystemContext.Key
  readonly load: Effect.Effect<SystemContext.SystemContext>
}

export interface Interface {
  readonly contribute: (contribution: Contribution) => Effect.Effect<void, never, Scope.Scope>
  readonly load: () => Effect.Effect<SystemContext.SystemContext>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SystemContextRegistry") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const contributions = yield* Ref.make<ReadonlyArray<Contribution>>([])

    return Service.of({
      contribute: Effect.fn("SystemContextRegistry.contribute")(function* (contribution) {
        yield* Effect.acquireRelease(
          Ref.modify(contributions, (current) => {
            if (current.some((item) => item.key === contribution.key)) return [false, current]
            return [true, [...current, contribution]]
          }).pipe(
            Effect.flatMap((added) =>
              added ? Effect.void : Effect.die(`Duplicate system context contribution key: ${contribution.key}`),
            ),
            Effect.as(contribution),
          ),
          (entry) => Ref.update(contributions, (current) => current.filter((item) => item !== entry)),
        )
      }),
      load: Effect.fn("SystemContextRegistry.load")(function* () {
        const current = (yield* Ref.get(contributions)).toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        return SystemContext.combine(
          yield* Effect.forEach(current, (contribution) => contribution.load, { concurrency: "unbounded" }),
        )
      }),
    })
  }),
)
