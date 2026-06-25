# Layer Node Tiers

## Goal

`LayerNode` describes the complete dependency graph while allowing groups of nodes to be constructed with different lifecycle boundaries. The abstraction must not hard-code concepts such as global or location services.

## Node Definition

Nodes have an Effect service tag, a layer, dependencies, and a tier. The service tag's runtime `key` identifies the node in diagnostics:

```ts
export const node = LayerNode.make({
  service: Watcher.Service,
  layer,
  deps: [],
  tier: location,
})
```

Tier-specific makers supply the tier automatically:

```ts
export const node = makeLocationNode({
  service: Watcher.Service,
  layer,
  deps: [Config.node, Git.node],
})
```

## Tier Declaration

Tiers are declared bottom-up, from the most specific lifecycle to the most foundational:

```ts
const tiers = LayerNode.tiers(["location", "global"])
```

An earlier tier may depend on its own tier or any later tier. A later tier cannot depend on an earlier tier.

For the example above:

- `location` may depend on `location` or `global`.
- `global` may depend only on `global`.

### Cross-Tier Dependencies

Dependencies on a later, more foundational tier are hoisted outside the current tier's construction boundary. For example, global dependencies of location nodes must be built outside a location `Layer.fresh` boundary.

From the perspective of a lower tier, each service crossing into a higher tier must resolve to one unique node identity:

- Multiple consumers may depend on the same higher-tier node.
- Two different higher-tier nodes for the same service are a conflict, even if both satisfy the same dependency type.
- This constraint applies to transitive higher-tier dependencies as well as direct dependencies.

This validation happens while traversing dependency edges for the single complete-graph topological sort. It is not reconstructed from the flattened sorted list and is not a separate validation pass.

The traversal must retain the lower-tier perspective when following a dependency into a higher tier. For each lower tier, it tracks the higher-tier node selected for every service key. Reaching the same service through the same node identity is valid; reaching it through a different node identity is a conflict.

Topological visitation and boundary validation are distinct traversal state:

- A node is emitted into the topological order once.
- A higher-tier node may need boundary validation once for each lower tier from which it is reachable.

This distinction is required for transitive dependencies. A higher-tier node may already be topologically visited when another lower-tier branch reaches it, but that later branch must still participate in service uniqueness validation.

The tier configuration generates correctly constrained makers:

```ts
export const makeLocationNode = tiers.make("location")
export const makeGlobalNode = tiers.make("global")
```

This must reject invalid dependencies at compile time:

```ts
makeGlobalNode({
  service: Database.Service,
  layer,
  deps: [locationNode], // type error
})
```

## Building

`buildLayer` remains a top-level `LayerNode` function and receives the tier configuration:

```ts
const appLayer = LayerNode.buildLayer(root, tiers)
```

It performs these steps:

1. Traverse and topologically sort the complete reachable graph once, dependency-first.
2. While traversing dependency edges, detect cycles, validate tier direction, and validate unique cross-tier service implementations from each lower tier's perspective.
3. Partition the one sorted list by tier while preserving its relative order.
4. Process tiers in their declared bottom-up order.
5. Build one layer for each tier.
6. Connect tier layers with `Layer.provideMerge` according to tier dependencies.
7. Return one final closed Effect layer.

### One Topological Sort

There is one topological sort for the entire graph, not one sort per tier. Every reachable node is emitted into the sorted result once. Boundary-validation state may separately process a higher-tier node once per originating lower tier; this does not create another topological sort.

For example, one dependency-first result may be:

```text
[globalDatabase, globalGit, locationConfig, locationWatcher]
```

Stable partitioning then produces:

```text
global:   [globalDatabase, globalGit]
location: [locationConfig, locationWatcher]
```

Because partitioning preserves relative order, dependencies within each tier remain before their consumers. Cross-tier dependencies were already validated while their dependency edges were available during traversal; validation is not attempted from the partitioned lists.

### Provider Rebinding Within A Tier

Topological node deduplication is not sufficient when a tier contains different nodes that provide the same service. The final linear layer plan must preserve which implementation each consumer depends on.

For example:

```text
ConsumerX  -> X provides Service
ConsumerY  -> Y provides Service
ConsumerX2 -> X provides Service
```

The resulting dependency-first plan must be able to represent:

```text
ConsumerX, X, ConsumerY, Y, ConsumerX2, X
```

After `Y` becomes the active implementation, the later dependency on `X` must emit `X` again. A global visited set must not incorrectly remove that second placement.

While constructing a tier's linear plan, track the active provider node for each service key:

- If the required provider is already active, its repeated placement may be omitted.
- If a different provider for the same service is active, emit the required provider again and make it active.
- If no provider is active, emit the provider and make it active.

Repeated placement of the same node does not imply repeated resource acquisition. Effect layer memoization may still reuse the same layer instance. The repeated placement restores the intended provider binding for subsequent consumers.

This differs from cross-tier uniqueness. Multiple implementations may be rebound within one tier, but different implementations of the same service cannot both be hoisted across a tier boundary.

Without a custom build function, a tier's sorted layers are combined with the default `Layer.provideMerge` behavior.

## Custom Tier Build Function

The optional third argument customizes how each tier's sorted layers are constructed:

```ts
const appLayer = LayerNode.buildLayer(root, tiers, (tier, layers) => {
  const combined = LayerNode.combine(layers)

  if (tier !== "location") return combined

  return Layer.effect(
    LocationServiceMap,
    LayerMap.make((ref: Location.Ref) => combined.pipe(Layer.provide(Location.layer(ref)), Layer.fresh), {
      idleTimeToLive: "60 minutes",
    }),
  )
})
```

The callback receives:

- The tier name.
- The tier's layers in the dependency-first order preserved from the single complete-graph topological sort.

It returns the final layer representing that tier. This permits a tier to introduce a lifecycle boundary, wrap its layers in a `LayerMap`, or otherwise transform how the tier is built.

## Replacements

Tests and alternate runtimes may replace a specific layer implementation by exact object identity:

```ts
const layer = LayerNode.buildLayer(root, tiers, buildTier, [LayerNode.replace(Config.layer, testConfigLayer)])
```

The replacement applies to every placement of that exact source layer in the generated plans. Unused replacements are not acquired. A replacement must provide the same service output, must not introduce new errors, and must not have unresolved dependencies.

## Freshness

Global implementations must remain outside the location freshness boundary. Conceptually:

```ts
locationTier.pipe(Layer.fresh).pipe(Layer.provideMerge(globalTier))
```

The location tier contains only location implementations. Global dependencies are connected after the location build function creates its fresh or `LayerMap` boundary, so global services remain shared.

## Responsibilities

`LayerNode` owns:

- Service tags and dependency edges.
- Tier declarations and type-safe tier makers.
- Cycle detection and diagnostics using service keys such as `Watcher.Service.key`.
- One dependency-first topological sort of the complete graph.
- Cross-tier service uniqueness validation during dependency traversal, tracked per originating lower tier.
- Stable partitioning of the sorted nodes by tier.
- Provider-aware linearization within each tier, including rebinding when different nodes provide the same service.
- Invoking the optional tier build function.
- Wiring the resulting tier layers into one final layer.

The caller owns:

- The meaning of each tier.
- Tier-specific lifecycle behavior.
- Specialized wrappers such as `LocationServiceMap`.

The abstraction must not contain built-in knowledge of global, location, request, workspace, or other application-specific tiers.

## Deferred: packages/opencode Compatibility

The first implementation will not migrate or redesign the existing `packages/opencode` integration with core's `LocationServiceMap`.

`packages/opencode` currently uses its own `InstanceState` lifecycle while bridging to core location services through `LocationServiceMap`. Production consumers include:

- `packages/opencode/src/session/system.ts`
- `packages/opencode/src/agent/agent.ts`
- `packages/opencode/src/cli/cmd/debug/file.ts`
- `packages/opencode/src/cli/cmd/debug/v2.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts`

Some consumers wrap `LocationServiceMap.layer` as an opaque `LayerNode`; others provide the layer directly. We need to determine how these bridges consume the tier-built core graph and how unresolved global dependencies are exposed after the new core location builder is implemented.

This compatibility work must happen after the first tier implementation. The first implementation should preserve existing `packages/opencode` behavior and avoid changing these bridges.
