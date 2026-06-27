import { Layer } from "effect"
import { LayerNode } from "./layer-node"

type AnyNode = LayerNode.Node<unknown, unknown, any>
type RuntimeLayer = Layer.Layer<never, unknown, unknown>

export function hoist<A, E, T extends LayerNode.Tag>(
  root: LayerNode.Node<A, E, any>,
  tag: T,
): {
  readonly node: LayerNode.Node<A, E>
  readonly hoisted: LayerNode.Node<unknown, E>
} {
  const visited = new Map<AnyNode, AnyNode>()
  const hoisted = new Map<string, AnyNode>()
  const visiting = new Set<AnyNode>()
  const stack: AnyNode[] = []

  const visit = (node: AnyNode): AnyNode => {
    if (node.kind === "group") {
      return { ...node, dependencies: node.dependencies.map(visit) }
    }

    const existingNode = visited.get(node)
    if (existingNode) return existingNode

    if (node.tag === tag) {
      const existing = hoisted.get(node.name)
      if (existing && existing !== node) {
        throw new Error(`Tag ${tag} has conflicting implementations for ${node.name}`)
      }
      hoisted.set(node.name, node)
      const empty = LayerNode.group([])
      visited.set(node, empty)
      return empty
    }
    if (node.kind === "unbound") {
      return node
    }

    if (visiting.has(node)) {
      const start = stack.indexOf(node)
      throw new Error(
        `Cycle detected in layer tree: ${[...stack.slice(start), node].map((item) => item.name).join(" -> ")}`,
      )
    }
    visiting.add(node)
    stack.push(node)
    try {
      const dependencies = node.dependencies.map(visit)
      const clone = { ...node, dependencies }
      visited.set(node, clone)
      return clone
    } finally {
      stack.pop()
      visiting.delete(node)
    }
  }

  return {
    node: visit(root) as LayerNode.Node<A, E>,
    hoisted: LayerNode.group(Array.from(hoisted.values())) as LayerNode.Node<unknown, E>,
  }
}

export function compile<A, E>(
  root: LayerNode.Node<A, E, any>,
  replacements?: ReadonlyMap<Layer.Any, Layer.Any>,
): Layer.Layer<A, E> {
  const cache = new Map<AnyNode, RuntimeLayer>()
  const compileNode = (node: AnyNode): RuntimeLayer => {
    if (node.kind === "unbound") throw new Error(`Unbound layer node: ${node.name}`)
    const cached = cache.get(node)
    if (cached) return cached
    const dependencies = node.dependencies.flatMap(flatten).map(compileNode)
    const implementation = (replacements?.get(node.implementation!) ?? node.implementation!) as RuntimeLayer
    const layer =
      dependencies.length === 0
        ? implementation
        : implementation.pipe(Layer.provide(dependencies as [RuntimeLayer, ...RuntimeLayer[]]))
    cache.set(node, layer)
    return layer
  }
  const layers = flatten(root).map((node) => compileNode(node))
  const layer = layers.reduce<RuntimeLayer>((result, layer) => layer.pipe(Layer.provideMerge(result)), Layer.empty)
  return layer as Layer.Layer<A, E>
}

export function bind<A, E, T extends LayerNode.Tag | undefined>(
  root: LayerNode.Node<A, E, T>,
  source: AnyNode,
  replacement: AnyNode,
): LayerNode.Node<A, E, T> {
  if (source.kind !== "unbound") throw new Error(`Cannot bind non-unbound layer node: ${source.name}`)
  if (source.name !== replacement.name) {
    throw new Error(`Cannot bind ${source.name} to ${replacement.name}`)
  }
  if (source.tag !== replacement.tag) {
    throw new Error(`Cannot bind ${source.name} across tags`)
  }
  const visited = new Map<AnyNode, AnyNode>()
  const visit = (node: AnyNode): AnyNode => {
    if (node === source) return replacement
    const existing = visited.get(node)
    if (existing) return existing
    if (node.kind === "unbound") return node
    const clone = { ...node, dependencies: node.dependencies.map(visit) }
    visited.set(node, clone)
    return clone
  }
  return visit(root) as LayerNode.Node<A, E, T>
}

function flatten(node: AnyNode): readonly AnyNode[] {
  return node.kind === "group" ? node.dependencies.flatMap(flatten) : [node]
}

export * as LayerNodeTree from "./layer-node-tree"
