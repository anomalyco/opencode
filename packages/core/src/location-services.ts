import { Duration, Effect, Layer, LayerMap } from "effect"
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

export function buildLocationServiceMap(
  replacements: LayerNode.Replacements = [],
): Layer.Layer<LocationServiceMap.Service> {
  // Structural Equal distinguishes optional-key shape and Windows separator style.
  // The RcMap caches the raw key before the build callback, so normalize both here.
  const canonical = (ref: Location.Ref) =>
    Location.Ref.make({
      directory: AbsolutePath.make(process.platform === "win32" ? path.normalize(ref.directory) : ref.directory),
      workspaceID: ref.workspaceID,
    })
  return Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const inner = yield* LayerMap.make((ref: Location.Ref) => Instance.layer(ref, { replacements: bindings }), {
        // Workspace-placed directories exist only inside the workspace, so a
        // local stat consults the wrong filesystem. Workspace liveness is
        // owned by placement; do not probe the sandbox here, which would
        // provision lazily-idle workspaces.
        idleTimeToLive: (ref) =>
          ref.workspaceID !== undefined || existsSync(ref.directory) ? Duration.infinity : Duration.zero,
      })
      const map = {
        ...inner,
        get: (ref: Location.Ref) => inner.get(canonical(ref)),
        contextEffect: (ref: Location.Ref) => inner.contextEffect(canonical(ref)),
        contextEffectOption: (ref: Location.Ref) => inner.contextEffectOption(canonical(ref)),
        invalidate: (ref: Location.Ref) => inner.invalidate(canonical(ref)),
      }
      // Cached instances borrow their owner instead of retaining its Layer scope.
      const bindings: LayerNode.Replacements = [
        Instance.node.replace(
          Layer.succeed(Instance.Service, {
            provide: (session) => Effect.provide(map.get(session.location)),
          }),
        ),
        ...replacements,
        LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
      ]
      return map
    }),
  )
}
