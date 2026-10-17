export * as Instance from "./service.js"
export type { Services } from "../instance.js"

import { Context, Effect, LayerMap, Option, RcMap } from "effect"
import type { Session } from "@opencode/schema/session"
import { Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import type { Services, Error } from "../instance.js"

/** Selects Session capabilities; implementations own caching and lifetime. */
export interface Interface {
  readonly provide: (
    session: Session.Info,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Error, Exclude<R, Services>>
  readonly provideCached: (
    session: Session.Info,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<Option.Option<A>, E | Error, Exclude<R, Services>>
}

/** Borrow an existing graph for the duration of a read without constructing a missing entry. */
export function cached<K>(map: LayerMap.LayerMap<K, Services, Error>, key: K) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* RcMap.getOption(map.rcMap, key)
        if (Option.isNone(context)) return Option.none<A>()
        return Option.some(yield* Effect.provide(effect, context.value))
      }),
    )
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Instance") {}

export const node = LayerNode.unbound(Service, Node.tags.values.global)
