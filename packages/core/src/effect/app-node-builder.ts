import { buildInstanceMap } from "../location-services.js"
import { InstanceMap } from "../instance-map.js"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"

export function build<A, E>(root: LayerNode.Node<A, E, any>, replacements: LayerNode.Replacements = []) {
  // Only build the instance map if it's actually needed
  if (!LayerNode.hasUnbound(root, InstanceMap.node) || hasReplacement(replacements, InstanceMap.node))
    return LayerNode.compile(root, replacements)

  const instanceMap = buildInstanceMap(replacements)
  const instanceMapNode = makeGlobalNode({ service: InstanceMap.Service, layer: instanceMap, deps: [] })
  return LayerNode.compile(root, replacements.concat([[InstanceMap.node, instanceMapNode]]))
}

function hasReplacement(replacements: LayerNode.Replacements, node: LayerNode.Node<unknown, unknown, any>) {
  return replacements.some(([source]) => source.name === node.name)
}

export * as AppNodeBuilder from "./app-node-builder.js"
