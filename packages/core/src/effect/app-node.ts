import { LayerNode } from "./layer-node"

export const tags = LayerNode.tags({
  location: ["global"],
  global: [],
})

export type GlobalNode<A, E = never> = LayerNode.Node<A, E, (typeof tags.values)["global"]>
export type LocationNode<A, E = never> = LayerNode.Node<A, E, (typeof tags.values)["location"]>

export const makeGlobalNode = tags.make("global")
export const makeLocationNode = tags.make("location")

export * as Node from "./app-node"
