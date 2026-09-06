import { buildLocationServiceMap } from "../location-services.js"
import { LocationServiceMap } from "../location-service-map.js"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Effect, Layer } from "effect"
import { Instance } from "../instance/service.js"

const instances = makeGlobalNode({
  service: Instance.Service,
  layer: Layer.effect(
    Instance.Service,
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      return Instance.Service.of({
        provide: (session) => Effect.provide(locations.get(session.location)),
      })
    }),
  ),
  deps: [LocationServiceMap.node],
})

export function build<A, E>(root: LayerNode.Graph<A, E>, replacements: LayerNode.Replacements = []) {
  const bindings = [Instance.node.replace(instances), ...replacements]
  return LayerNode.compile(root, {
    replacements: [LocationServiceMap.node.replace(buildLocationServiceMap(bindings)), ...bindings],
  })
}

export * as AppNodeBuilder from "./app-node-builder.js"
