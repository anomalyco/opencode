import { buildLocationServiceMap } from "../location-services.js"
import { LocationServiceMap } from "../location-service-map.js"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { LocationActivity } from "../location-activity.js"

export function build<A, E>(root: LayerNode.Node<A, E, any>, replacements: LayerNode.Replacements = []) {
  // Only build the location service map if it's actually needed
  if (!LayerNode.hasUnbound(root, LocationServiceMap.node)) return LayerNode.compile(root, replacements)

  const next = hasReplacement(replacements, LocationServiceMap.node)
    ? replacements
    : ([
        ...replacements,
        [
          LocationServiceMap.node,
          makeGlobalNode({
            service: LocationServiceMap.Service,
            layer: buildLocationServiceMap(replacements),
            deps: [],
          }),
        ] as const,
      ] as const)
  return LayerNode.compile(LayerNode.group([root, LocationActivity.node]), next)
}

function hasReplacement(replacements: LayerNode.Replacements, node: LayerNode.Node<unknown, unknown, any>) {
  return replacements.some(([source]) => source.name === node.name)
}

export * as AppNodeBuilder from "./app-node-builder.js"
