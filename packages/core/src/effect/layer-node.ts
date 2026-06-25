import { Brand, Context, Layer } from "effect"

type RuntimeLayer = Layer.Layer<never, unknown, unknown>
type AnyNode = Node<unknown, unknown, any>
type NodeList<Item extends AnyNode = AnyNode> = readonly [] | readonly [Item, ...Item[]]
type Output<Item> = [Item] extends [never] ? never : Item extends Node<infer A, unknown, any> ? A : never
type Error<Item> = [Item] extends [never] ? never : Item extends Node<unknown, infer E, any> ? E : never
type Missing<Required, Dependencies extends NodeList> = Exclude<Required, Output<Dependencies[number]>>
type CheckDependencies<Implementation extends Layer.Any, Dependencies extends NodeList> = [
  Missing<Layer.Services<Implementation>, Dependencies>,
] extends [never]
  ? unknown
  : { readonly "Missing dependencies": Missing<Layer.Services<Implementation>, Dependencies> }
declare const $OutputType: unique symbol
declare const $ErrorType: unique symbol

export type Tier<Name extends string = string> = Name & Brand.Brand<"LayerNode.Tier">

const makeTier = Brand.nominal<Tier>()

export type Node<A, E = never, T extends Tier | undefined = undefined> = {
  readonly kind: "layer" | "group"
  readonly name: string
  readonly service?: Context.Service.Any
  readonly implementation?: Layer.Any
  readonly dependencies: readonly AnyNode[]
  readonly tier?: T
  readonly [$OutputType]?: () => A
  readonly [$ErrorType]?: () => E
}

type NodeIdentity =
  | { readonly service: Context.Service.Any; readonly name?: never }
  | { readonly name: string; readonly service?: never }
type DistributiveOmit<A, K extends PropertyKey> = A extends unknown ? Omit<A, K> : never

type NodeInput<
  Implementation extends Layer.Any,
  Items extends NodeList,
  T extends Tier | undefined = undefined,
> = NodeIdentity & {
  readonly layer: Implementation
  readonly deps: Items & CheckDependencies<Implementation, NoInfer<Items>>
  readonly tier?: T
}

export function make<
  const Implementation extends Layer.Any,
  const Items extends NodeList,
  const T extends Tier | undefined = undefined,
>(
  input: NodeInput<Implementation, Items, T>,
): Node<Layer.Success<Implementation>, Layer.Error<Implementation> | Error<Items[number]>, T> {
  return {
    kind: "layer",
    name: input.service !== undefined ? input.service.key : input.name,
    service: input.service,
    implementation: input.layer,
    dependencies: input.deps,
    tier: input.tier,
  }
}

export function group<const Items extends NodeList>(
  dependencies: Items,
): Node<Output<Items[number]>, Error<Items[number]>> {
  return { kind: "group", name: "group", dependencies }
}

type AllowedTierNames<Names extends readonly string[], Name extends Names[number]> = Names extends readonly [
  infer Head extends string,
  ...infer Tail extends readonly string[],
]
  ? Head extends Name
    ? Head | Tail[number]
    : AllowedTierNames<Tail, Name>
  : never

type NodeInTiers<Names extends string> = Node<unknown, unknown, Tier<Names>>

export interface Tiers<Names extends readonly [string, ...string[]]> {
  readonly names: Names
  readonly values: { readonly [K in Names[number]]: Tier<K> }
  readonly make: <Name extends Names[number]>(
    name: Name,
  ) => <
    const Implementation extends Layer.Any,
    const Items extends NodeList<NodeInTiers<AllowedTierNames<Names, Name>>>,
  >(
    input: DistributiveOmit<NodeInput<Implementation, Items, Tier<Name>>, "tier">,
  ) => Node<Layer.Success<Implementation>, Layer.Error<Implementation> | Error<Items[number]>, Tier<Name>>
}

export function tiers<const Names extends readonly [string, ...string[]]>(names: Names): Tiers<Names> {
  const values = Object.fromEntries(names.map((name) => [name, makeTier(name)])) as Tiers<Names>["values"]
  return {
    names,
    values,
    make: ((name: Names[number]) => (input: DistributiveOmit<NodeInput<Layer.Any, NodeList, Tier>, "tier">) =>
      make({ ...input, tier: values[name] })) as Tiers<Names>["make"],
  }
}

const defaultTiers = tiers(["untiered"])
const untiered = defaultTiers.values.untiered

export type Replacement = {
  readonly source: Layer.Any
  readonly replacement: Layer.Any
}

type CheckReplacementErrors<SourceError, ReplacementError> = [Exclude<ReplacementError, SourceError>] extends [never]
  ? unknown
  : { readonly "New replacement errors": Exclude<ReplacementError, SourceError> }

export function replace<A, E, R, E2>(
  source: Layer.Layer<A, E, R>,
  replacement: Layer.Layer<NoInfer<A>, E2, never> & CheckReplacementErrors<E, NoInfer<E2>>,
): Replacement {
  return { source, replacement }
}

export function buildLayer<
  A,
  E,
  const Names extends readonly [string, ...string[]] = readonly ["untiered"],
  const Built extends Layer.Any = Layer.Layer<never, never, never>,
>(
  node: Node<A, E, any>,
  options?: {
    readonly tiers?: Tiers<Names>
    readonly buildTier?: (tier: Names[number], layers: readonly Layer.Any[]) => Built
    readonly replacements?: readonly Replacement[]
  },
): Layer.Layer<A | Layer.Success<Built>, E | Layer.Error<Built>, never> {
  const tiers = options?.tiers ?? (defaultTiers as unknown as Tiers<Names>)
  const replacementMap = new Map(options?.replacements?.map((item) => [item.source, item.replacement]))
  const plans = plan(node, tiers, replacementMap)
  const layers: RuntimeLayer[] = tiers.names.map((name) => {
    const tier = tiers.values[name as Names[number]]
    const layers = plans.get(tier) ?? []
    return (options?.buildTier?.(name, layers) ?? combine(layers)) as RuntimeLayer
  })
  if (layers.length === 0) return Layer.empty as never
  return layers.slice(1).reduce((result, layer) => result.pipe(Layer.provideMerge(layer)), layers[0]) as never
}

export function combine(layers: readonly Layer.Any[]): RuntimeLayer {
  return layers.reduce<RuntimeLayer>(
    (result, layer) => (layer as RuntimeLayer).pipe(Layer.provideMerge(result)),
    Layer.empty as RuntimeLayer,
  )
}

function plan(
  root: AnyNode,
  tiers: Tiers<readonly [string, ...string[]]>,
  replacements: ReadonlyMap<Layer.Any, Layer.Any>,
) {
  const indexes = new Map(tiers.names.map((name, index) => [tiers.values[name], index]))
  const plans = new Map<Tier, Layer.Any[]>()
  const activeImplementations = new Map<Tier, Map<string, AnyNode>>()
  const serviceTiers = new Map<string, Tier>()
  const visiting = new Set<AnyNode>()
  const stack: AnyNode[] = []
  const boundaryVisited = new Map<AnyNode, Set<Tier>>()
  const boundaryServices = new Map<Tier, Map<string, AnyNode>>()

  const validateBoundary = (node: AnyNode, origin: Tier) => {
    const checked = boundaryVisited.get(node) ?? new Set<Tier>()
    boundaryVisited.set(node, checked)
    if (checked.has(origin)) return false
    checked.add(origin)
    const services = boundaryServices.get(origin) ?? new Map<string, AnyNode>()
    boundaryServices.set(origin, services)
    const key = node.name
    const existing = services.get(key)
    if (existing && existing !== node) {
      throw new Error(`Tier ${origin} has conflicting implementations for ${key}`)
    }
    services.set(key, node)
    return true
  }

  const visit = (node: AnyNode, currentTier?: Tier, origins: readonly Tier[] = []) => {
    if (node.kind === "group") {
      node.dependencies.forEach((dependency) => visit(dependency, currentTier, origins))
      return
    }

    const tier = node.tier ?? untiered
    if (!indexes.has(tier)) throw new Error(`Node ${node.name} is not in the tier configuration`)
    const key = node.name
    const serviceTier = serviceTiers.get(key)
    if (serviceTier && serviceTier !== tier) {
      throw new Error(`Service ${key} belongs to both tier ${serviceTier} and tier ${tier}`)
    }
    serviceTiers.set(key, tier)
    const nextOrigins = [...origins]
    if (currentTier) {
      const current = indexes.get(currentTier)!
      const required = indexes.get(tier)!
      if (required < current) {
        throw new Error(`Tier ${currentTier} cannot depend on lower tier ${tier}`)
      }
      if (required > current) nextOrigins.push(currentTier)
    }
    const unseenOrigins = nextOrigins.filter((origin) => validateBoundary(node, origin))

    // A node may need to be emitted more than once because the final output is a
    // flat list of layers applied with Layer.provideMerge. If another node for
    // the same service was emitted afterward, this node is no longer the active
    // implementation for subsequent consumers. Re-emitting restores the intended
    // implementation ordering while Effect memoization avoids reacquiring the layer.
    const implementations = activeImplementations.get(tier) ?? new Map<string, AnyNode>()
    activeImplementations.set(tier, implementations)
    if (implementations.get(key) === node && unseenOrigins.length === 0) return

    if (visiting.has(node)) {
      const start = stack.indexOf(node)
      throw new Error(
        `Cycle detected in layer graph: ${[...stack.slice(start), node].map((item) => item.name).join(" -> ")}`,
      )
    }

    visiting.add(node)
    stack.push(node)
    try {
      node.dependencies.forEach((dependency) => visit(dependency, tier, unseenOrigins))
      const layers = plans.get(tier) ?? []
      plans.set(tier, layers)
      layers.push(replacements.get(node.implementation!) ?? node.implementation!)
      implementations.set(key, node)
    } finally {
      stack.pop()
      visiting.delete(node)
    }
  }

  visit(root)
  return plans
}

function requireTier(node: AnyNode, indexes: ReadonlyMap<Tier, number>) {
  if (!node.tier || !indexes.has(node.tier)) throw new Error(`Node ${node.name} is not in the tier configuration`)
}

export * as LayerNode from "./layer-node"
