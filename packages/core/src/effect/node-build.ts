import { Layer } from "effect"
import { buildLocationServiceMap } from "../location-services"
import { LocationServiceMap } from "../location-service-map"
import { LayerNode, LayerNodeTree } from "./layer-node"
import { makeGlobalNode } from "./node"

export function build<A, E>(root: LayerNode.Node<A, E, any>, replacements?: readonly LayerNode.Replacement[]) {
  const replacementMap = new Map(replacements?.map((item) => [item.source, item.replacement]))

  const locationMap = buildLocationServiceMap(replacementMap)
  const locationMapNode = makeGlobalNode({ service: LocationServiceMap.Service, layer: locationMap, deps: [] })

  const app = LayerNodeTree.bind(root, LocationServiceMap.node, locationMapNode)

  return LayerNodeTree.compile(app, replacementMap)
}

export * as NodeBuild from "./node-build"
