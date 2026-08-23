import { Context, Duration, Effect, Layer, LayerMap, PubSub, Stream } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Node } from "@opencode-ai/util/effect/app-node"
import { Location } from "./location.js"
import type { LocationError, LocationServices } from "./location-services.js"

export interface Interface extends LayerMap.LayerMap<Location.Ref, LocationServices> {
  readonly booted: Stream.Stream<Location.Ref>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/example/LocationServiceMap") {
  static get(ref: Location.Ref) {
    return Layer.unwrap(Effect.map(Service, (locations) => locations.get(ref)))
  }
}

export function make<R>(
  lookup: (ref: Location.Ref) => Layer.Layer<LocationServices, LocationError, R>,
  options: {
    readonly canonical?: (ref: Location.Ref) => Location.Ref
  } = {},
) {
  return Effect.gen(function* () {
    const canonical = options.canonical ?? ((ref: Location.Ref) => ref)
    const booted = yield* PubSub.unbounded<Location.Ref>()
    yield* Effect.addFinalizer(() => PubSub.shutdown(booted))
    const locations = yield* LayerMap.make(
      (ref: Location.Ref) => lookup(ref).pipe(Layer.tap(() => PubSub.publish(booted, canonical(ref)))),
      { idleTimeToLive: Duration.infinity },
    )
    const contextEffect = (ref: Location.Ref) => {
      const value = canonical(ref)
      return locations.contextEffect(value).pipe(Effect.onError(() => locations.invalidate(value)))
    }

    return Service.of({
      ...locations,
      get: (ref) => Layer.effectContext(contextEffect(ref)),
      contextEffect,
      invalidate: (ref) => locations.invalidate(canonical(ref)),
      booted: Stream.fromPubSub(booted),
    })
  })
}

export const node = LayerNode.unbound(Service, Node.tags.values.global)

export * as LocationServiceMap from "./location-service-map.js"
