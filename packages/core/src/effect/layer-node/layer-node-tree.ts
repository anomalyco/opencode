import { Layer } from "effect"
import { LayerNode } from "./layer-node"

type AnyNode = LayerNode.Node<unknown, unknown, any>
type RuntimeLayer = Layer.Layer<never, unknown, unknown>
type Visit<Result> = (node: AnyNode, context: VisitContext<Result>) => Result

type VisitContext<Result> = {
  readonly cache: Map<AnyNode, Result>
  readonly visit: (node: AnyNode) => Result
}

function walk<Result>(
  root: AnyNode,
  visit: Visit<Result>,
  options: {
    readonly cache?: Map<AnyNode, Result>
    readonly resolve?: (node: AnyNode) => AnyNode
    readonly detectCycles?: boolean
  } = {},
) {
  const cache = options.cache ?? new Map<AnyNode, Result>()
  const visiting = new Set<AnyNode>()
  const stack: AnyNode[] = []

  const recur = (node: AnyNode): Result => {
    const target = options.resolve?.(node) ?? node
    const cached = cache.get(target)
    if (cached !== undefined || cache.has(target)) return cached!

    if (options.detectCycles !== false && visiting.has(target)) {
      const start = stack.indexOf(target)
      throw new Error(
        `Cycle detected in layer tree: ${[...stack.slice(start), target].map((item) => item.name).join(" -> ")}`,
      )
    }

    visiting.add(target)
    stack.push(target)
    try {
      const result = visit(target, { cache, visit: recur })
      if (!cache.has(target)) cache.set(target, result)
      return result
    } finally {
      stack.pop()
      visiting.delete(target)
    }
  }

  return recur(root)
}

export function hoist<A, E, T extends LayerNode.Tag>(
  root: LayerNode.Node<A, E, any>,
  tag: T,
): {
  readonly node: LayerNode.Node<A, E>
  readonly hoisted: LayerNode.Node<unknown, E>
} {
  const hoisted = new Map<string, AnyNode>()

  const node = walk<AnyNode>(root, (node, context) => {
    if (node.kind === "group") {
      return { ...node, dependencies: node.dependencies.map(context.visit) }
    }
    if (node.tag === tag) {
      const existing = hoisted.get(node.name)
      if (existing && existing !== node) {
        throw new Error(`Tag ${tag} has conflicting implementations for ${node.name}`)
      }
      hoisted.set(node.name, node)
      return LayerNode.group([])
    }
    if (node.kind === "unbound") {
      return node
    }
    return { ...node, dependencies: node.dependencies.map(context.visit) }
  })

  return {
    node: node as LayerNode.Node<A, E>,
    hoisted: LayerNode.group(Array.from(hoisted.values())) as LayerNode.Node<unknown, E>,
  }
}

export function compile<A, E>(
  root: LayerNode.Node<A, E, any>,
  replacements?: ReadonlyMap<Layer.Any, Layer.Any>,
): Layer.Layer<A, E> {
  const cache = new Map<AnyNode, RuntimeLayer>()
  const compileNode = (node: AnyNode) =>
    walk<RuntimeLayer>(
      node,
      (node, context) => {
        if (node.kind === "unbound") throw new Error(`Unbound layer node: ${node.name}`)
        const dependencies = node.dependencies.flatMap(flatten).map(context.visit)
        const implementation = (replacements?.get(node.implementation!) ?? node.implementation!) as RuntimeLayer
        return dependencies.length === 0
          ? implementation
          : implementation.pipe(Layer.provide(dependencies as [RuntimeLayer, ...RuntimeLayer[]]))
      },
      { cache },
    )
  const layers = flatten(root).map((node) => compileNode(node))
  const layer = layers.reduce<RuntimeLayer>((result, layer) => layer.pipe(Layer.provideMerge(result)), Layer.empty)
  return layer as Layer.Layer<A, E>
}

export function hasUnbound(root: LayerNode.Node<unknown, unknown, any>, source: AnyNode): boolean {
  if (source.kind !== "unbound") throw new Error(`Cannot check non-unbound layer node: ${source.name}`)
  return walk<boolean>(root, (node, context) => {
    if (node === source) return true
    return node.dependencies.some(context.visit)
  })
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
  return walk<AnyNode>(
    root,
    (target, context) => {
      if (target.kind === "unbound") return target
      const dependencies: AnyNode[] = []
      const clone = { ...target, dependencies }
      context.cache.set(target, clone)
      dependencies.push(...target.dependencies.map(context.visit))
      return clone
    },
    { detectCycles: false, resolve: (node) => (node === source ? replacement : node) },
  ) as LayerNode.Node<A, E, T>
}

function flatten(node: AnyNode): readonly AnyNode[] {
  return node.kind === "group" ? node.dependencies.flatMap(flatten) : [node]
}

export * as LayerNodeTree from "./layer-node-tree"
