import { Context, Effect, Layer, LayerMap } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Node } from "@opencode-ai/util/effect/app-node"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import path from "path"
import { Location } from "./location.js"
import type { Instance } from "./instance.js"

export class Service extends Context.Service<
  Service,
  LayerMap.LayerMap<Location.Ref, Instance.Services, Instance.Error>
>()("@opencode/example/LocationServiceMap") {
  static get(ref: Location.Ref) {
    return Layer.unwrap(Effect.map(Service, (locations) => locations.get(ref)))
  }
}

export const node = LayerNode.unbound(Service, Node.tags.values.global)

/** Normalize equivalent placements before they become resource-cache keys. */
export function canonical(ref: Location.Ref) {
  return Location.Ref.make({
    directory: AbsolutePath.make(process.platform === "win32" ? path.normalize(ref.directory) : ref.directory),
    workspaceID: ref.workspaceID,
  })
}

export * as LocationServiceMap from "./location-service-map.js"
