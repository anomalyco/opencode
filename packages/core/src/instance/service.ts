export * as Instance from "./service.js"
export type { Services } from "../instance.js"

import { Context, Effect, Layer, Option, Scope } from "effect"
import type { Session } from "@opencode-ai/schema/session"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import type { Services } from "../instance.js"
import { LocationServiceMap } from "../location-service-map.js"

/** Selects Session capabilities; implementations own caching and lifetime. */
export interface Interface {
  readonly provide: (
    session: Session.Info,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Services>>
  /** Borrow a cached instance without initializing one when it is absent. */
  readonly provideIfLoaded: (
    session: Session.Info,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<Option.Option<A>, E, Exclude<R, Services>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Instance") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return Service.of({
      provide: (session) => Effect.provide(locations.get(session.location)),
      provideIfLoaded: (session) => (effect) =>
        // Scope the borrowed reference without replacing the caller's Scope.
        Effect.scopedWith((scope) =>
          Effect.gen(function* () {
            const context = yield* locations.contextEffectOption(session.location).pipe(Scope.provide(scope))
            if (Option.isNone(context)) return Option.none()
            return Option.some(yield* effect.pipe(Effect.provide(context.value)))
          }),
        ),
    })
  }),
)

export const byLocationNode = makeGlobalNode({ service: Service, layer, deps: [LocationServiceMap.node] })
