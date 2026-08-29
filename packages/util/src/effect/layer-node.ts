import { Brand, Context, Effect, Layer, type Scope } from "effect"

export * as LayerNode from "./layer-node.js"

const GraphTypeId = Symbol("LayerNode.Graph")
const VarianceTypeId = Symbol("LayerNode.Variance")
const NodeTypeId = Symbol("LayerNode.Node")
const ReplacementTypeId = Symbol("LayerNode.Replacement")

export type Tag<Name extends string = string> = Name & Brand.Brand<"LayerNode.Tag">
const makeTag = Brand.nominal<Tag>()

export type Graph<A, E = never, T extends Tag | undefined = Tag | undefined> = GraphValue<A, E, T>
export type Node<A, E = never, T extends Tag | undefined = undefined> = NodeValue<A, E, T>
export type Provider<A, E = never, T extends Tag | undefined = undefined> = ProviderNode<A, E, T>
export type Replacement = ReplacementValue
export type Replacements = readonly Replacement[]

type AnyGraph = Graph<never, unknown>
type AnyNode = AnyGraph & { readonly [NodeTypeId]: unknown; readonly tag: Tag | undefined }
type RuntimeLayer = Layer.Layer<never, unknown, unknown>
type GraphList = readonly [] | readonly [AnyGraph, ...AnyGraph[]]

export type Output<Item> = CommonOutput<Item, Item extends Graph<infer A, unknown> ? A : never>
export type Error<Item> = Item extends Graph<never, infer E> ? E : never
type GraphTag<Item> = [Item] extends [never] ? undefined : Item extends Graph<never, unknown, infer T> ? T : never
type CommonOutput<Item, A> = A extends unknown ? ([Item] extends [Graph<A, unknown>] ? A : never) : never
type LayerOutput<Item extends Layer.Any, A = Layer.Success<Item>> = A extends unknown
  ? [Item] extends [Layer.Layer<A, unknown, unknown>]
    ? A
    : never
  : never
type ListOutput<Items extends readonly AnyGraph[], A = never> = [Items] extends [
  readonly [infer Head extends AnyGraph, ...infer Tail extends readonly AnyGraph[]],
]
  ? ListOutput<Tail, A | Output<Head>>
  : A

type Definition =
  | { readonly kind: "group"; readonly name: string; readonly dependencies: readonly AnyGraph[] }
  | { readonly kind: "unbound"; readonly name: string }
  | {
      readonly kind: "layer"
      readonly name: string
      readonly implementation: RuntimeLayer
      readonly dependencies: readonly AnyGraph[]
    }

class GraphValue<in A, out E, out T extends Tag | undefined> {
  declare private readonly graph: void
  // Public symbol types survive declaration emit; the private brand prevents structural forgery.
  declare readonly [VarianceTypeId]: {
    readonly output: (_: A) => void
    readonly error: () => E
    readonly tags: () => T
  }

  readonly [GraphTypeId]: Definition

  constructor(definition: Definition) {
    this[GraphTypeId] = definition
  }

  get name() {
    return this[GraphTypeId].name
  }
}

class NodeValue<in out A, in out E, in out T extends Tag | undefined> extends GraphValue<A, E, T> {
  // Forgetting part of a node's contract must not authorize a weaker replacement.
  declare readonly [NodeTypeId]: (_: [A, E, T]) => [A, E, T]

  constructor(
    definition: Exclude<Definition, { kind: "group" }>,
    readonly tag: T,
  ) {
    super(definition)
  }

  /** Replace this declaration, including every dependency on it, without acquiring its old wiring. */
  replace<const Target extends AnyNode | Layer.Any>(
    this: Node<A, E, T>,
    replacement: Target & CheckReplacement<A, E, T, Target>,
  ): Replacement {
    if (replacement instanceof NodeValue) {
      if (replacement.tag !== this.tag) throw new Error(`Cannot replace ${this.name} across tags`)
      return new ReplacementValue(this, replacement)
    }
    if (!Layer.isLayer(replacement)) throw new Error("A replacement must be a node or an Effect Layer")
    return new ReplacementValue(this, makeProvider({ name: this.name, layer: replacement, deps: [] }, this.tag))
  }
}

class ProviderNode<in out A, in out E, in out T extends Tag | undefined> extends NodeValue<A, E, T> {
  /** Decorate the implementation while preserving its dependency wiring and service contract. */
  mapLayer(this: Provider<A, E, T>, f: <R>(layer: Layer.Layer<A, E, R>) => Layer.Layer<A, E, R>): Provider<A, E, T> {
    const definition = this[GraphTypeId]
    if (definition.kind !== "layer") throw new Error(`Cannot map unbound layer node: ${this.name}`)
    return new ProviderNode(
      { ...definition, implementation: f(definition.implementation as Layer.Layer<A, E, unknown>) },
      this.tag,
    )
  }
}

class ReplacementValue {
  declare private readonly checked: void
  readonly [ReplacementTypeId]: { readonly source: AnyNode; readonly target: AnyNode }

  constructor(source: AnyNode, target: AnyNode) {
    this[ReplacementTypeId] = { source, target }
  }
}

type CheckErrors<Expected, Actual> = [Exclude<Actual, Expected>] extends [never]
  ? never
  : { readonly "New replacement errors": Exclude<Actual, Expected> }

type CheckReplacement<A, E, T, Target> = [ReplacementErrors<A, E, T, Target>] extends [never]
  ? unknown
  : ReplacementErrors<A, E, T, Target>

type ReplacementErrors<A, E, T, Target> = Target extends AnyNode
  ? [Exclude<A, Output<Target>>] extends [never]
    ? [GraphTag<Target>] extends [T]
      ? CheckErrors<E, Error<Target>>
      : { readonly "Invalid replacement tag": GraphTag<Target> }
    : { readonly "Missing replacement outputs": Exclude<A, Output<Target>> }
  : Target extends Layer.Layer<A, infer E2, never>
    ? CheckErrors<E, E2>
    : { readonly "Replacement must be a closed layer": Target }

type CheckDependencies<Implementation extends Layer.Any, Items extends GraphList> = [
  Exclude<Layer.Services<Implementation>, ListOutput<Items>>,
] extends [never]
  ? unknown
  : { readonly "Missing dependencies": Exclude<Layer.Services<Implementation>, ListOutput<Items>> }

type Identity =
  | { readonly service: Context.Service.Any; readonly name?: never }
  | { readonly name: string; readonly service?: never }
type CheckLayer<Implementation> = [Implementation] extends [RuntimeLayer]
  ? unknown
  : { readonly "Layer contract must be preserved": Implementation }
type TagInput<T> = { readonly tag: T } | ([T] extends [undefined] ? { readonly tag?: undefined } : never)
type MakeInput<Implementation extends Layer.Any, Items extends GraphList, T extends Tag | undefined> = Identity &
  TagInput<T> & {
    readonly layer: Implementation & CheckLayer<NoInfer<Implementation>>
    readonly deps: Items & CheckDependencies<Implementation, NoInfer<Items>>
  }
type DistributiveOmit<A, K extends PropertyKey> = A extends unknown ? Omit<A, K> : never

export type TagConfig = Readonly<Record<string, readonly string[]>>
type TagNames<Config extends TagConfig> = keyof Config & string
type CheckTags<Items extends GraphList, Names extends string> = [
  Exclude<GraphTag<Items[number]>, Tag<Names> | undefined>,
] extends [never]
  ? unknown
  : { readonly "Invalid tag dependencies": Exclude<GraphTag<Items[number]>, Tag<Names> | undefined> }

export interface Tags<Config extends TagConfig> {
  readonly values: { readonly [Name in TagNames<Config>]: Tag<Name> }
  readonly make: <Name extends TagNames<Config>>(
    name: Name,
  ) => <const Implementation extends Layer.Any, const Items extends GraphList>(
    input: DistributiveOmit<MakeInput<Implementation, Items, Tag<Name>>, "tag"> &
      CheckTags<Items, Name | Extract<Config[Name][number], string>>,
  ) => Provider<LayerOutput<Implementation>, Layer.Error<Implementation> | Error<Items[number]>, Tag<Name>>
}

export function tags<const Config extends { readonly [Name in keyof Config]: readonly (keyof Config & string)[] }>(
  config: Config,
): Tags<Config> {
  const names = Object.keys(config) as TagNames<Config>[]
  const values = Object.fromEntries(names.map((name) => [name, makeTag(name)])) as Tags<Config>["values"]
  return {
    values,
    make:
      <Name extends TagNames<Config>>(name: Name) =>
      <const Implementation extends Layer.Any, const Items extends GraphList>(
        input: DistributiveOmit<MakeInput<Implementation, Items, Tag<Name>>, "tag"> &
          CheckTags<Items, Name | Extract<Config[Name][number], string>>,
      ) =>
        makeProvider<Implementation, Items, Tag<Name>>(input, values[name]),
  }
}

export function make<
  const Implementation extends Layer.Any,
  const Items extends GraphList,
  const T extends Tag | undefined = undefined,
>(
  input: MakeInput<Implementation, Items, T>,
): Provider<LayerOutput<Implementation>, Layer.Error<Implementation> | Error<Items[number]>, T> {
  return makeProvider<Implementation, Items, T>(input, input.tag as T)
}

function makeProvider<Implementation extends Layer.Any, Items extends readonly AnyGraph[], T extends Tag | undefined>(
  input: Identity & { readonly layer: Implementation; readonly deps: Items },
  tag: T,
): Provider<LayerOutput<Implementation>, Layer.Error<Implementation> | Error<Items[number]>, T> {
  if (!Layer.isLayer(input.layer)) throw new Error("A layer node requires an Effect Layer")
  return new ProviderNode(
    {
      kind: "layer",
      name: input.service !== undefined ? input.service.key : input.name,
      implementation: input.layer,
      dependencies: [...input.deps],
    },
    tag,
  )
}

export function unbound<R, Shape, const T extends Tag>(service: Context.Key<R, Shape>, tag: T): Node<R, never, T> {
  return new NodeValue({ kind: "unbound", name: service.key }, tag)
}

/** Ordered, associative composition. Only these roots' outputs are exposed; their dependencies remain private. */
export function group<const Items extends readonly AnyGraph[]>(
  dependencies: Items,
): Graph<ListOutput<Items>, Error<Items[number]>, GraphTag<Items[number]>> {
  return new GraphValue({ kind: "group", name: "group", dependencies: [...dependencies] })
}

export interface CompileOptions {
  readonly replacements?: Replacements
  /** Share subgraphs rooted at this tag; give the remaining wiring a fresh map for each build. */
  readonly shared?: Tag
}

type Resolved = {
  readonly name: string
  readonly implementation: RuntimeLayer
  readonly dependencies: readonly Resolved[]
  readonly shared: boolean
}

/** Resolve the final overrides before validating or acquiring anything. Effect owns acquisition and finalization. */
export function compile<A, E>(root: Graph<A, E>, options: CompileOptions = {}): Layer.Layer<A, E> {
  const shared = options.shared
  const replacements = new Map<AnyGraph, AnyNode>(
    options.replacements?.map((item) => {
      const replacement = item[ReplacementTypeId]
      return [replacement.source, replacement.target] as const
    }),
  )
  const cache = {
    shared: new Map<AnyGraph, readonly Resolved[]>(),
    local: new Map<AnyGraph, readonly Resolved[]>(),
  }
  const stack: AnyGraph[] = []
  const definitions = { shared: new Map<RuntimeLayer, Resolved>(), local: new Map<RuntimeLayer, Resolved>() }

  const resolve = (graph: AnyGraph, inherited = false): readonly Resolved[] => {
    const definition = graph[GraphTypeId]
    const isShared = inherited || (shared !== undefined && graph instanceof NodeValue && graph.tag === shared)
    const resolved = isShared ? cache.shared : cache.local
    const cached = resolved.get(graph)
    if (cached) return cached
    const cycle = stack.indexOf(graph)
    if (cycle !== -1) {
      throw new Error(
        `Cycle detected in layer graph: ${[...stack.slice(cycle), graph].map((item) => item.name).join(" -> ")}`,
      )
    }
    stack.push(graph)
    const replacement = replacements.get(graph)
    const result = (() => {
      if (replacement && replacement !== graph) return resolve(replacement, isShared)
      if (definition.kind === "group")
        return definition.dependencies.flatMap((dependency) => resolve(dependency, isShared))
      if (definition.kind === "unbound") throw new Error(`Unbound layer node: ${definition.name}`)
      const node: Resolved = {
        name: definition.name,
        implementation: definition.implementation,
        dependencies: definition.dependencies.flatMap((dependency) => resolve(dependency, isShared)),
        shared: isShared,
      }
      const registry = node.shared ? definitions.shared : definitions.local
      const existing = registry.get(node.implementation)
      if (existing) {
        if (
          existing.dependencies.length !== node.dependencies.length ||
          existing.dependencies.some((dependency, index) => dependency !== node.dependencies[index])
        ) {
          throw new Error(`Layer ${node.name} is wired to different dependencies; use a distinct implementation Layer`)
        }
        return [existing]
      }
      registry.set(node.implementation, node)
      return [node]
    })()
    stack.pop()
    resolved.set(graph, result)
    return result
  }

  const roots = resolve(root)
  return Layer.fromBuild((memoMap, scope) => {
    const local = shared === undefined ? memoMap : Layer.makeMemoMapUnsafe()
    const ambient = Layer.succeed(Layer.CurrentMemoMap, memoMap)
    const layers = new Map<Resolved, RuntimeLayer>()
    const build = (node: Resolved): RuntimeLayer => {
      const cached = layers.get(node)
      if (cached) return cached
      const dependencies = node.dependencies.map(build)
      // Acquisition uses the selected cache, while lazy LayerMaps inherit the enclosing shared cache.
      const implementation = Layer.suspend(() => node.implementation.pipe(Layer.provide([ambient, ...dependencies])))
      const layer = Layer.fromBuild((_, scope) => buildContext(implementation, node.shared ? memoMap : local, scope))
      layers.set(node, layer)
      return layer
    }
    return buildContext(
      roots.map(build).reduce<RuntimeLayer>((result, layer) => layer.pipe(Layer.provideMerge(result)), Layer.empty),
      memoMap,
      scope,
    )
  }) as Layer.Layer<A, E>
}

class BuildResult extends Context.Service<BuildResult, Context.Context<never>>()("@opencode/LayerNode/BuildResult") {}

function buildContext(layer: RuntimeLayer, memoMap: Layer.MemoMap, scope: Scope.Scope) {
  // Preserve the exact output context before Effect appends its own memo-map metadata.
  return Layer.buildWithMemoMap(
    layer.pipe(Layer.flatMap((context) => Layer.succeed(BuildResult, context))),
    memoMap,
    scope,
  ).pipe(Effect.map(Context.get(BuildResult)))
}
