export * as InstancePlugins from "./instance.js"

import type { Plugin } from "@opencode-ai/plugin/effect/plugin"
import { Context, Layer } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import type { Generation } from "../plugin.js"

/**
 * Holds the plugins one instance is born with. Unlike the host-global
 * `SdkPlugins` store, this list is a birth argument of a single instance:
 * `Instance.layer` binds it through the replacement mechanism, so two
 * instances in one process can carry different plugins. The list is immutable
 * for the instance's lifetime; runtime dynamism lives inside plugins through
 * the container transform/reload APIs.
 *
 * Config plugin operations may disable instance plugins by id, matching
 * `SdkPlugins` behavior.
 */
export type List = readonly Plugin[]

export interface Interface {
  readonly all: () => readonly Generation[]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstancePlugins") {}

export const node = makeLocationNode({
  service: Service,
  layer: bound([]),
  deps: [],
})

// The constant revision is load-bearing: the plugin registry treats an
// unchanged (id, revision) pair as the same plugin across activations, which
// is only correct because a bound list never changes after creation.
// `source: "sdk"` means host-contributed; an instance list is the
// per-instance form of the same channel.
export function bound(plugins: List) {
  const duplicates = plugins.filter((plugin, index) => plugins.findIndex((other) => other.id === plugin.id) !== index)
  if (duplicates.length > 0) {
    throw new Error(`duplicate instance plugin ids: ${duplicates.map((plugin) => plugin.id).join(", ")}`)
  }
  const stamped = plugins.map((plugin): Generation => ({ ...plugin, revision: "instance", source: { type: "sdk" } }))
  return Layer.succeed(Service, Service.of({ all: () => stamped }))
}
