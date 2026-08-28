import { Duration, Effect, Layer, LayerMap } from "effect"
import { existsSync } from "fs"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Instance } from "./instance.js"
import { InstanceMap } from "./instance-map.js"
import { Entry, fromMap } from "./instance-map/internal.js"

export { InstanceMap } from "./instance-map.js"

export type LocationServices = Instance.Services
export type LocationError = Instance.Error

export function buildInstanceMap(replacements: LayerNode.Replacements = []): Layer.Layer<InstanceMap.Service> {
  return Layer.effect(
    InstanceMap.Service,
    Effect.map(
      LayerMap.make((entry: Entry) => Instance.layer(entry.location, { replacements }), {
        // Workspace-placed directories exist only inside the workspace, so a
        // local stat consults the wrong filesystem. Workspace liveness is
        // owned by placement; do not probe the sandbox here, which would
        // provision lazily-idle workspaces.
        idleTimeToLive: (entry) =>
          entry.location.workspaceID !== undefined || existsSync(entry.location.directory)
            ? Duration.infinity
            : Duration.zero,
      }),
      fromMap,
    ),
  )
}
