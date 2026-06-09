import { Layer } from "effect"

type RuntimeLayer = Layer.Layer<never, unknown, unknown>
type AnyNode = Node<unknown, unknown>
type NodeList = readonly [] | readonly [AnyNode, ...AnyNode[]]
type Output<Item> = [Item] extends [never] ? never : Item extends Node<infer A, unknown> ? A : never
type Error<Item> = [Item] extends [never] ? never : Item extends Node<unknown, infer E> ? E : never
type Missing<Required, Dependencies extends NodeList> = Exclude<Required, Output<Dependencies[number]>>
type CheckDependencies<Implementation extends Layer.Any, Dependencies extends NodeList> = [
  Missing<Layer.Services<Implementation>, Dependencies>,
] extends [never]
  ? unknown
  : { readonly "Missing dependencies": Missing<Layer.Services<Implementation>, Dependencies> }
declare const $OutputType: unique symbol
declare const $ErrorType: unique symbol

export type Node<A, E = never> = {
  readonly kind: "layer" | "group"
  readonly implementation?: Layer.Any
  readonly dependencies: readonly AnyNode[]
  readonly [$OutputType]?: () => A
  readonly [$ErrorType]?: () => E
}

export function make<const Implementation extends Layer.Any, const Items extends NodeList>(
  implementation: Implementation,
  dependencies: Items & CheckDependencies<Implementation, NoInfer<Items>>,
): Node<Layer.Success<Implementation>, Layer.Error<Implementation> | Error<Items[number]>> {
  return { kind: "layer", implementation: implementation as Layer.Any, dependencies }
}

export function group<const Items extends NodeList>(
  dependencies: Items,
): Node<Output<Items[number]>, Error<Items[number]>> {
  return { kind: "group", dependencies }
}

export type Replacement<A = unknown> = {
  readonly source: Node<A, unknown>
  readonly replacement: Node<A, unknown>
}

type CheckReplacementErrors<SourceError, ReplacementError> = [Exclude<ReplacementError, SourceError>] extends [never]
  ? unknown
  : { readonly "New replacement errors": Exclude<ReplacementError, SourceError> }

export function replace<A, E, E2>(
  source: Node<A, E>,
  replacement: Node<NoInfer<A>, E2> & CheckReplacementErrors<E, NoInfer<E2>>,
): Replacement<A> {
  return { source, replacement }
}

export function buildLayer<A, E>(node: Node<A, E>, options?: { readonly replacements?: readonly Replacement[] }) {
  const replacements = new Map(options?.replacements?.map((item) => [item.source, item.replacement]))
  const cache = new Map<AnyNode, RuntimeLayer>()
  const visiting = new Set<AnyNode>()
  const stack: AnyNode[] = []
  const ids = new Map<AnyNode, number>()

  const visit = (input: AnyNode): RuntimeLayer => {
    const node = replacements.get(input) ?? input
    const cached = cache.get(node)
    if (cached) return cached
    if (visiting.has(node)) {
      const start = stack.indexOf(node)
      const cycle = [...stack.slice(start), node].map((item) => `${item.kind}#${ids.get(item)}`).join(" -> ")
      throw new Error(`Cycle detected in app graph: ${cycle}`)
    }
    if (!ids.has(node)) ids.set(node, ids.size + 1)
    visiting.add(node)
    stack.push(node)
    try {
      const dependencies = node.dependencies.map(visit)
      const nonEmpty = dependencies as [RuntimeLayer, ...RuntimeLayer[]]
      const result =
        node.kind === "group"
          ? dependencies.length === 0
            ? Layer.empty
            : Layer.mergeAll(...nonEmpty)
          : dependencies.length === 0
            ? (node.implementation as RuntimeLayer)
            : Layer.provide(node.implementation as RuntimeLayer, nonEmpty)
      cache.set(node, result)
      return result
    } finally {
      stack.pop()
      visiting.delete(node)
    }
  }

  return visit(node) as unknown as Layer.Layer<A, E, never>
}

export * as LayerNode from "./layer-node"
