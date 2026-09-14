import { LayerNode } from "./layer-node.js"

export const tags = LayerNode.tags({
  location: ["global"],
  global: [],
})

export type GlobalGraph<A, E = never> = LayerNode.Graph<A, E, (typeof tags.values)["global"]>
export type LocationGraph<A, E = never> = LayerNode.Graph<A, E, (typeof tags.values)["location"]>

export const makeGlobalNode = tags.make("global")
export const makeLocationNode = tags.make("location")

export * as Node from "./app-node.js"
