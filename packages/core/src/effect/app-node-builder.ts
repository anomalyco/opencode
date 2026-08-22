import { buildLocationServiceMap } from "../location-services.js"
import { LocationServiceMap } from "../location-service-map.js"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"

export function build<A, E>(root: LayerNode.Node<A, E, any>, replacements: LayerNode.Replacements = []) {
  // Only build the location service map if it's actually needed
  if (!LayerNode.hasUnbound(root, LocationServiceMap.node) || hasReplacement(replacements, LocationServiceMap.node))
    return LayerNode.compile(root, replacements)

  const locationMap = buildLocationServiceMap(replacements)
  const locationMapNode = makeGlobalNode({ service: LocationServiceMap.Service, layer: locationMap, deps: [] })
  return LayerNode.compile(root, replacements.concat([[LocationServiceMap.node, locationMapNode]]))
}

function hasReplacement(replacements: LayerNode.Replacements, node: LayerNode.Node<unknown, unknown, any>) {
  return replacements.some(([source]) => source.name === node.name)
}

export * as AppNodeBuilder from "./app-node-builder.js"
