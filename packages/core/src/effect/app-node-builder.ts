import { buildLocationServiceMap } from "../location-services"
import { LocationServiceMap } from "../location-service-map"
import { LayerNode } from "./layer-node"
import { makeGlobalNode } from "./app-node"
import { SessionExecution } from "../session/execution"

export function build<A, E>(root: LayerNode.Node<A, E, any>, replacements: LayerNode.Replacements = []) {
  let allReplacements = replacements

  // Only build the location service map if it's actually needed
  if (LayerNode.hasUnbound(root, LocationServiceMap.node) && !hasReplacement(replacements, LocationServiceMap.node)) {
    const locationMap = buildLocationServiceMap(replacements)
    const locationMapNode = makeGlobalNode({ service: LocationServiceMap.Service, layer: locationMap, deps: [] })
    allReplacements = replacements.concat([[LocationServiceMap.node, locationMapNode]])
  }

  // Default SessionExecution to a no-op when the layer graph transitively depends on it
  // (e.g. SessionPrompt) but no real implementation is provided. Callers can override
  // this by passing their own replacement, which takes precedence.
  if (
    LayerNode.hasUnbound(root, SessionExecution.node) &&
    !hasReplacement(allReplacements, SessionExecution.node)
  ) {
    allReplacements = allReplacements.concat([[SessionExecution.node, SessionExecution.noopLayer]])
  }

  return LayerNode.compile(root, allReplacements)
}

function hasReplacement(replacements: LayerNode.Replacements, node: LayerNode.Node<unknown, unknown, any>) {
  return replacements.some(([source]) => source.name === node.name)
}

export * as AppNodeBuilder from "./app-node-builder"
