import { expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodeTree } from "@opencode-ai/core/effect/layer-node"

class Database extends Context.Service<Database, { readonly name: string }>()("test/GraphDatabase") {}
class Users extends Context.Service<Users, { readonly list: Effect.Effect<string[]> }>()("test/GraphUsers") {}
class App extends Context.Service<App, { readonly run: Effect.Effect<string[]> }>()("test/GraphApp") {}

test("hoists and compiles tagged graphs", async () => {
  const tags = LayerNode.tags({ location: ["global"], global: [] })
  const global = tags.make("global")
  const location = tags.make("location")
  const database = global({
    service: Database,
    layer: Layer.succeed(Database, Database.of({ name: "Alice" })),
    deps: [],
  })
  const users = location({
    service: Users,
    layer: Layer.effect(
      Users,
      Effect.gen(function* () {
        const db = yield* Database
        return Users.of({ list: Effect.succeed([db.name]) })
      }),
    ),
    deps: [database],
  })
  const app = location({
    service: App,
    layer: Layer.effect(
      App,
      Effect.gen(function* () {
        const service = yield* Users
        return App.of({ run: service.list })
      }),
    ),
    deps: [users],
  })

  const locationResult = LayerNodeTree.hoist(LayerNode.group([app]), tags.values.global)
  expect(locationResult.node.dependencies[0]?.dependencies[0]?.dependencies[0]).toMatchObject({
    kind: "group",
    dependencies: [],
  })
  expect(locationResult.hoisted.dependencies).toEqual([database])

  const layer = LayerNodeTree.compile(locationResult.node).pipe(
    Layer.provide(LayerNodeTree.compile(locationResult.hoisted)),
  ) as unknown as Layer.Layer<App>
  const program = Effect.gen(function* () {
    return yield* (yield* App).run
  }).pipe(Effect.provide(layer))

  expect(await Effect.runPromise(program)).toEqual(["Alice"])
})

test("rejects conflicting hoisted implementations", () => {
  const tags = LayerNode.tags({ location: ["global"], global: [] })
  const global = tags.make("global")
  const location = tags.make("location")
  const first = global({ service: Database, layer: Layer.succeed(Database, Database.of({ name: "first" })), deps: [] })
  const second = global({ service: Database, layer: Layer.succeed(Database, Database.of({ name: "second" })), deps: [] })
  const left = location({ service: Users, layer: Layer.effect(Users, Effect.as(Database, Users.of({ list: Effect.succeed([]) }))), deps: [first] })
  const right = location({ service: App, layer: Layer.effect(App, Effect.as(Database, App.of({ run: Effect.succeed([]) }))), deps: [second] })

  expect(() => LayerNodeTree.hoist(LayerNode.group([left, right]), tags.values.global)).toThrow(
    "Tag global has conflicting implementations for test/GraphDatabase",
  )
})

test("treats dependency groups as transparent while hoisting", () => {
  const tags = LayerNode.tags({ location: ["global"], global: [] })
  const global = tags.make("global")
  const location = tags.make("location")
  const database = global({
    service: Database,
    layer: Layer.succeed(Database, Database.of({ name: "Alice" })),
    deps: [],
  })
  const users = location({
    service: Users,
    layer: Layer.effect(Users, Effect.as(Database, Users.of({ list: Effect.succeed([]) }))),
    deps: [LayerNode.group([database])],
  })
  const result = LayerNodeTree.hoist(LayerNode.group([users]), tags.values.global)

  expect(result.node.dependencies[0]?.dependencies[0]?.dependencies[0]).toMatchObject({
    kind: "group",
    dependencies: [],
  })
})
