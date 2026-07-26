import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { describe, expect, it } from "bun:test"
import { Context, Effect, Layer, Option } from "effect"

// Faithful repro of the REAL production mechanism (LayerNode.buildLayer):
//   - group node  -> Layer.mergeAll(...directChildren): ONLY direct children
//     are exposed in the request fiber's ambient context.
//   - make node   -> Layer.provide(impl, deps): deps are provided to impl's
//     BUILD, NOT re-exposed to ambient.
//
// Production: the HTTP `app` group lists Database.node + SessionPrompt.node but
// NOT S2SStore.node. The poller forked from SessionPrompt.loop resolves
// S2SStore from the AMBIENT request context -> absent -> "Service not found".
// Database resolves because it is a DIRECT group member.

class Store extends Context.Service<Store, { readonly tag: "store" }>()("repro/Store") {}
class Database extends Context.Service<Database, { readonly tag: "db" }>()("repro/Database") {}

interface InnerShape {
  // ambientProbe: resolves Store from AMBIENT context (what the poller does today)
  readonly ambientProbe: () => Effect.Effect<{ store: boolean; db: boolean }>
  // capturedProbe: resolves Store from a value CAPTURED at build + provided into
  // a forked child (Option 2 = memory #340 pattern)
  readonly capturedProbe: () => Effect.Effect<{ store: boolean; db: boolean }>
}
class Inner extends Context.Service<Inner, InnerShape>()("repro/Inner") {}

const StoreLayer = Layer.succeed(Store, Store.of({ tag: "store" }))
const DatabaseLayer = Layer.succeed(Database, Database.of({ tag: "db" }))
const StoreNode = LayerNode.make({ service: Store, layer: StoreLayer, deps: [] })
const DatabaseNode = LayerNode.make({ service: Database, layer: DatabaseLayer, deps: [] })

// Inner captures Store + Database at BUILD time (like SessionPrompt capturing
// messaging/database). capturedProbe provides the captured Store into a forked
// child effect, so it resolves regardless of ambient group membership.
const InnerLayer = Layer.effect(
  Inner,
  Effect.gen(function* () {
    yield* Database
    const capturedStore = yield* Store // build-time capture (needs Store in BUILD ctx)
    return Inner.of({
      ambientProbe: () =>
        Effect.gen(function* () {
          const storeOpt = yield* Effect.serviceOption(Store)
          const dbOpt = yield* Effect.serviceOption(Database)
          return { store: Option.isSome(storeOpt), db: Option.isSome(dbOpt) }
        }),
      capturedProbe: () =>
        // mirror the poller fork: a child effect that yields Store, with the
        // captured Store provided explicitly into it (like provideService(Database))
        Effect.gen(function* () {
          const storeOpt = yield* Effect.serviceOption(Store)
          const dbOpt = yield* Effect.serviceOption(Database)
          return { store: Option.isSome(storeOpt), db: Option.isSome(dbOpt) }
        }).pipe(Effect.provideService(Store, capturedStore)),
    })
  }),
)
// InnerNode declares BOTH Database and Store as deps -> Layer.provide supplies
// them to Inner.layer's BUILD context (so the build-time `yield* Store` works),
// but does NOT re-expose Store to the group ambient.
const InnerNode = LayerNode.make({ service: Inner, layer: InnerLayer, deps: [DatabaseNode, StoreNode] })

const run = (
  groupLayer: Layer.Layer<Inner, never, never>,
  pick: (i: InnerShape) => Effect.Effect<{ store: boolean; db: boolean }>,
) =>
  Effect.gen(function* () {
    const inner = yield* Inner
    return yield* pick(inner)
  }).pipe(Effect.provide(groupLayer), Effect.runPromise)

describe("s2s HTTP-group topology repro", () => {
  // EXACT production group: Store is NOT a direct child (only Database + Inner).
  const appGroup = LayerNode.group([DatabaseNode, InnerNode])
  const built = () => LayerNode.compile(appGroup) as Layer.Layer<Inner, never, never>

  it("BUG: ambientProbe in bug-shape group cannot see Store (reproduces production)", async () => {
    const result = await run(built(), (i) => i.ambientProbe())
    console.log("AMBIENT (bug):", JSON.stringify(result))
    expect(result.db).toBe(true) // Database is a direct group member
    expect(result.store).toBe(false) // RED: ambient lacks Store -> production bug
  })

  it("FIX (Option 2): capturedProbe sees Store even when group does NOT expose it", async () => {
    const result = await run(built(), (i) => i.capturedProbe())
    console.log("CAPTURED (fix):", JSON.stringify(result))
    expect(result.db).toBe(true)
    expect(result.store).toBe(true) // GREEN: captured-at-build + provided-into-fork
  })
})
