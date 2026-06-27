import { Layer } from "effect"
import { buildLocationServiceMap } from "../location-services"
import { LocationServiceMap } from "../location-service-map"
import { LayerNode } from "./layer-node"
import { makeGlobalNode } from "./app-node"

export function build<A, E>(root: LayerNode.Node<A, E, any>, replacements?: readonly LayerNode.Replacement[]) {
  const replacementMap = new Map(replacements?.map((item) => [item.source, item.replacement]))

  if (!LayerNode.hasUnbound(root, LocationServiceMap.node)) {
    // If the location service map is not needed, we shouldn't pull it
    // in. Compile the graph normally
    return LayerNode.compile(root, replacementMap)
  }

  const locationMap = buildLocationServiceMap(replacementMap)
  const locationMapNode = makeGlobalNode({ service: LocationServiceMap.Service, layer: locationMap, deps: [] })

  const app = LayerNode.bind(root, LocationServiceMap.node, locationMapNode)

  return LayerNode.compile(app, replacementMap)
}

export * as AppNodeBuilder from "./app-node-builder"
