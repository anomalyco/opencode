import { Context, Effect, Layer, LayerMap } from "effect"
import { LayerNode } from "./effect/layer-node"
import { Node } from "./effect/app-node"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import type { LocationError, LocationServices } from "./location-services"
import { AbsolutePath } from "./schema"

export class Service extends Context.Service<
  Service,
  LayerMap.LayerMap<Location.Ref, LocationServices, LocationError>
>()("@opencode/example/LocationServiceMap") {
  static get(ref: Location.Ref) {
    return Layer.unwrap(Effect.map(Service, (locations) => locations.get(ref)))
  }
}

export const node = LayerNode.unbound(Service, Node.tags.values.global)

export function normalize(ref: Location.Ref): Location.Ref {
  if (process.platform !== "win32") return ref
  const directory = FSUtil.normalizePath(ref.directory)
  if (directory === ref.directory) return ref
  return Location.Ref.make({
    directory: AbsolutePath.make(directory),
    workspaceID: ref.workspaceID,
  })
}

export * as LocationServiceMap from "./location-service-map"
