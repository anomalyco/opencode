# Layer Graphs

`LayerNode` describes replaceable wiring for ordinary Effect Layers. Declarations
and compilation do not acquire resources. Effect still owns acquisition,
memoization, scopes, and finalization.

There are three values to compose:

- A **Node** is a replaceable declaration with a fixed output, error, and tag
  contract. `make` supplies its default implementation; `unbound` leaves that
  implementation for the caller to supply.
- A **Graph** is a node or an ordered `group` of graphs. Grouping exposes the
  selected roots, not their transitive dependencies. Groups are not replacement
  targets.
- A **Replacement** is a checked instruction made by `node.replace(...)`.
  Replacement arrays can be stored and concatenated without losing their checks.

```ts
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"

class Database extends Context.Service<Database, { readonly name: string }>()("example/Database") {}
class Users extends Context.Service<Users, { readonly name: string }>()("example/Users") {}

const tags = LayerNode.tags({ global: [], location: ["global"] })
const global = tags.make("global")
const location = tags.make("location")

const database = global({
  service: Database,
  layer: Layer.succeed(Database, { name: "live" }),
  deps: [],
})
const users = location({
  service: Users,
  layer: Layer.effect(
    Users,
    Effect.map(Database, (db) => ({ name: db.name })),
  ),
  deps: [database],
})

const replacements: LayerNode.Replacements = [database.replace(Layer.succeed(Database, { name: "test" }))]

const layer = LayerNode.compile(LayerNode.group([database, users]), {
  replacements,
  shared: tags.values.global,
})
// Layer<Database | Users>: both selected roots remain available.
```

## Substitution

Replacements target the exact declaration, not its display name or service key.
Two independently declared nodes can provide the same service in different
branches without capturing each other's overrides.

Keep the original declaration as the target when configuring a default:

```ts
const replacements = [Database.node.replace(Database.configured(options.database)), ...profile.replacements]
```

The replacement may be a closed Layer or another node. It must provide all the
source's outputs, may provide additional outputs, must not introduce new errors,
and must retain the source's tag. An open Layer must first be wired into a node.
Replacing a node prunes its original dependencies; replacing it with another node
uses that node's dependencies instead.

The rules are:

- The last replacement for the same source wins, before any traversal.
- Replacements also apply inside replacement dependency graphs and through
  replacement chains.
- Replacing a node with itself is the identity operation.
- Unreachable replacements neither acquire resources nor traverse their graphs.
- Unbound nodes and cycles in the effective graph fail during compilation.

A node's contract is invariant. It cannot be widened or narrowed to authorize a
replacement that would violate another use of the original declaration. A graph
can forget outputs like an ordinary Layer, but cannot be used as a weaker
replacement handle.

Choice and composition are different: `group([a, b])` provides both roots, while
`group([condition ? a : b])` promises only outputs common to both alternatives.
The same rule applies to conditional implementation Layers. Use tuples for known
roots; a dynamic array can be empty and therefore guarantees no service outputs.
Every alternative of a conditional replacement must satisfy the source contract.

## Decoration

Use `mapLayer` to decorate a default implementation without duplicating or
inspecting its dependencies:

```ts
const observed = database.mapLayer((layer) => layer.pipe(Layer.tap(() => Effect.logDebug("database ready"))))
const replacements = [database.replace(observed)]
```

The callback is parametric in the Layer's requirements: it must preserve the
declared wiring and service/error contract. `mapLayer` returns a new node; it does
not mutate or automatically override the original. Only implemented nodes offer
this operation, not unbound slots or groups.

## Lifetimes

Without `shared`, compilation uses Effect's enclosing memo map throughout.
With `shared: tag`, matching nodes and their dependency subgraphs use that map;
remaining wiring uses one fresh map per build. A shared service's dependencies
must live at least as long as the service, including untagged helpers. This keeps application globals shared while isolating each
Location, without exposing incomplete graphs or losing shared root outputs.

The enclosing memo map remains ambient during construction, so a lazy LayerMap
captures the shared ancestry rather than a Location's private cache. Cache
selection is internal metadata, not an extra service output of each dependency.

Native Layer identity still controls acquisition within each memo map. Use a
distinct implementation Layer for differently wired definitions; compilation
rejects conflicting wiring of the same Layer within one graph's memo domain.
Compiled wiring is memoized once per build and memo domain, so a shared dependency
graph is not expanded into a tree during acquisition. Original Layer identities
still determine service sharing across separately compiled builds. An explicitly
fresh implementation refreshes its acquisition when its wiring is built.

Groups preserve root startup order and associate transparently. A node's
dependencies are built concurrently through native `Layer.provide`. Named
startup actions and Context references are supported even when their required
service output type is `never`.

## Migration

| Previous API                                     | Current API                                     |
| ------------------------------------------------ | ----------------------------------------------- |
| `[source, replacement]`                          | `source.replace(replacement)`                   |
| `compile(graph, replacements)`                   | `compile(graph, { replacements })`              |
| `hoist`, compile both halves, `fresh`, `provide` | `compile(graph, { replacements, shared: tag })` |
| Spread a node and overwrite `implementation`     | `node.mapLayer(transform)`                      |
| Generic root parameter `Node<A, E, any>`         | `Graph<A, E>`                                   |

An application can prepend a default binding and append caller overrides instead
of inspecting the original graph with `hasUnbound`. Unused defaults are pruned,
and defaults introduced as dependencies by an override are found naturally.

Code that reconstructed a replacement source by name must retain the original
declaration instead. Compiler representation fields are no longer public.

`PersistentPty.configured(options)` now returns a wired node, like the other Core
configuration factories. `PersistentPty.layer` remains the default raw Layer.

## Verification

Run `bun run typecheck:dist` in `packages/util` to build the package and check the
same positive and negative contract tests against its emitted declarations.
This ensures package consumers receive the same inference and replacement checks
as callers importing the source.
