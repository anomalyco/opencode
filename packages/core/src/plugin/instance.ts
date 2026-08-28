export * as InstancePlugins from "./instance.js"

import type { Plugin } from "@opencode-ai/plugin/effect/plugin"
import { Context, Layer } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import type { Versioned } from "../plugin.js"

/**
 * Holds the plugins one instance is born with. Unlike the host-global
 * `SdkPlugins` store, this list is a birth argument of a single instance:
 * `Instance.layer` binds it through the replacement mechanism, so two
 * instances in one process can carry different plugins. The list is immutable
 * for the instance's lifetime; runtime dynamism lives inside plugins through
 * the container transform/reload APIs.
 *
 * Limitations, both shared with `SdkPlugins`: `vcs` marker declarations are
 * not seen by `ProjectMarkers` (it is global and runs during project
 * resolution, before the instance exists), and config plugin operations may
 * disable instance plugins by id.
 */
export type List = readonly Plugin[]

export interface Interface {
  readonly all: () => readonly Versioned[]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstancePlugins") {}

export const node = makeLocationNode({
  service: Service,
  layer: Layer.succeed(Service, Service.of({ all: () => [] })),
  deps: [],
})

// The constant version is load-bearing: the plugin registry treats an
// unchanged (id, version) pair as the same plugin across activations, which
// is only correct because a bound list never changes after creation.
// `source: "sdk"` means host-contributed; an instance list is the
// per-instance form of the same channel.
export function bound(plugins: List) {
  const duplicates = plugins.filter((plugin, index) => plugins.findIndex((other) => other.id === plugin.id) !== index)
  if (duplicates.length > 0) {
    throw new Error(`duplicate instance plugin ids: ${duplicates.map((plugin) => plugin.id).join(", ")}`)
  }
  const stamped = plugins.map(
    (plugin): Versioned => ({ ...plugin, version: "instance", source: { type: "sdk" } }),
  )
  return Layer.succeed(Service, Service.of({ all: () => stamped }))
}
