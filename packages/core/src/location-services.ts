import { Duration, Effect, Layer, LayerMap, Option, RcMap } from "effect"
import { existsSync } from "fs"
import path from "path"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Instance } from "./instance.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { AbsolutePath } from "./schema.js"

export { LocationServiceMap } from "./location-service-map.js"

export type LocationServices = Instance.Services
export type LocationError = Instance.Error

function canonicalize(ref: Location.Ref) {
  return Location.Ref.make({
    directory: AbsolutePath.make(process.platform === "win32" ? path.normalize(ref.directory) : ref.directory),
    workspaceID: ref.workspaceID,
  })
}

export function contextIfLoaded(
  locations: LayerMap.LayerMap<Location.Ref, Instance.Services, Instance.Error>,
  ref: Location.Ref,
) {
  return Effect.gen(function* () {
    const key = canonicalize(ref)
    if (!(yield* RcMap.has(locations.rcMap, key))) return Option.none()
    return Option.some(yield* RcMap.get(locations.rcMap, key))
  })
}

export function buildLocationServiceMap(
  replacements: LayerNode.Replacements = [],
): Layer.Layer<LocationServiceMap.Service> {
  // Structural Equal distinguishes optional-key shape and Windows separator style.
  // The RcMap caches the raw key before the build callback, so normalize both here.
  return Layer.effect(
    LocationServiceMap.Service,
    Effect.map(
      LayerMap.make((ref: Location.Ref) => Instance.layer(ref, { replacements }), {
        // Workspace-placed directories exist only inside the workspace, so a
        // local stat consults the wrong filesystem. Workspace liveness is
        // owned by placement; do not probe the sandbox here, which would
        // provision lazily-idle workspaces.
        idleTimeToLive: (ref) =>
          ref.workspaceID !== undefined || existsSync(ref.directory) ? Duration.infinity : Duration.zero,
      }),
      (inner) => ({
        ...inner,
        get: (ref: Location.Ref) => inner.get(canonicalize(ref)),
        contextEffect: (ref: Location.Ref) => inner.contextEffect(canonicalize(ref)),
        invalidate: (ref: Location.Ref) => inner.invalidate(canonicalize(ref)),
      }),
    ),
  )
}
