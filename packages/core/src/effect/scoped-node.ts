import { LayerNode } from "./layer-node"

export const tiers = LayerNode.tiers(["location", "global"])

export type GlobalNode<A, E = never> = LayerNode.Node<A, E, (typeof tiers.values)["global"]>
export type LocationNode<A, E = never> = LayerNode.Node<A, E, (typeof tiers.values)["location"]>

export const makeGlobalNode = tiers.make("global")
export const makeLocationNode = tiers.make("location")

export * as ScopedNode from "./scoped-node"
