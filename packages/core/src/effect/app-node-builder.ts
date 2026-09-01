import { buildLocationServiceMap } from "../location-services.js"
import { LocationServiceMap } from "../location-service-map.js"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"

export function build<A, E>(root: LayerNode.Graph<A, E>, replacements: LayerNode.Replacements = []) {
  return LayerNode.compile(root, {
    replacements: [LocationServiceMap.node.replace(buildLocationServiceMap(replacements)), ...replacements],
  })
}

export * as AppNodeBuilder from "./app-node-builder.js"
