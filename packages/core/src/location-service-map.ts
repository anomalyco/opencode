import { Context, Effect, Layer, LayerMap } from "effect"
import { LayerNode } from "./effect/layer-node"
import { Node } from "./effect/node"
import { Location } from "./location"
import type { LocationError, LocationServices } from "./location-layer"

export class LocationServiceMap extends Context.Service<
  LocationServiceMap,
  LayerMap.LayerMap<Location.Ref, LocationServices, LocationError>
>()("@opencode/example/LocationServiceMap") {
  static get(ref: Location.Ref) {
    return Layer.unwrap(Effect.map(LocationServiceMap, (locations) => locations.get(ref)))
  }
}

export const node = LayerNode.unbound(LocationServiceMap, Node.tags.values.global)
