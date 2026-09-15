import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

class Value extends Context.Service<Value, { readonly value: string }>()("test/LayerNodeValue") {}
class Greeting extends Context.Service<Greeting, { readonly value: string }>()("test/LayerNodeGreeting") {}
class Left extends Context.Service<Left, { readonly value: string }>()("test/LayerNodeLeft") {}
class Right extends Context.Service<Right, { readonly value: string }>()("test/LayerNodeRight") {}
class Database extends Context.Service<Database, { readonly name: string }>()("test/GraphDatabase") {}
class Users extends Context.Service<Users, { readonly list: Effect.Effect<string[]> }>()("test/GraphUsers") {}
class App extends Context.Service<App, { readonly run: Effect.Effect<string[]> }>()("test/GraphApp") {}

const tags = LayerNode.tags({ app: [] })
const make = tags.make("app")
const build = <A, E>(root: LayerNode.Node<A, E, any>, replacements?: readonly LayerNode.Replacement[]) =>
  LayerNode.compile(root, replacements) as Layer.Layer<A, E>
const valueLayer = Layer.succeed(Value, Value.of({ value: "production" }))
const greetingLayer = Layer.effect(
  Greeting,
  Effect.map(Value, (value) => Greeting.of({ value: `hello ${value.value}` })),
)
const value = make({ service: Value, layer: valueLayer, deps: [] })
const greeting = make({ service: Greeting, layer: greetingLayer, deps: [value] })

describe("layer node", () => {
  test("builds an untagged graph", async () => {
    const value = LayerNode.make({ service: Value, layer: valueLayer, deps: [] })
    const greeting = LayerNode.make({ service: Greeting, layer: greetingLayer, deps: [value] })
    const program = Effect.map(Greeting, (item) => item.value).pipe(
      Effect.provide(LayerNode.compile(LayerNode.group([greeting]))),
    )
    expect(await Effect.runPromise(program)).toBe("hello production")
  })

  test("builds a dependency graph", async () => {
    const program = Effect.map(Greeting, (item) => item.value).pipe(Effect.provide(build(LayerNode.group([greeting]))))
    expect(await Effect.runPromise(program)).toBe("hello production")
  })

  test("exposes roots but hides transitive dependencies", () => {
    const layer = build(LayerNode.group([greeting]))
    const check: Layer.Layer<Greeting> = layer
    void check
  })

  test("preserves branch-specific implementations across roots", async () => {
    const firstValue = make({ service: Value, layer: Layer.succeed(Value, Value.of({ value: "first" })), deps: [] })
    const secondValue = make({ service: Value, layer: Layer.succeed(Value, Value.of({ value: "second" })), deps: [] })
    const leftLayer = Layer.effect(
      Left,
      Effect.map(Value, (item) => Left.of({ value: item.value })),
    )
    const rightLayer = Layer.effect(
      Right,
      Effect.map(Value, (item) => Right.of({ value: item.value })),
    )
    const left = make({ service: Left, layer: leftLayer, deps: [firstValue] })
    const right = make({ service: Right, layer: rightLayer, deps: [secondValue] })
    const layer = build(LayerNode.group([left, right]))
    const program = Effect.gen(function* () {
      return [(yield* Left).value, (yield* Right).value]
    }).pipe(Effect.provide(layer))
    expect(await Effect.runPromise(program)).toEqual(["first", "second"])
  })

  test("requires unbound nodes to be replaced before compilation", async () => {
    const unbound = LayerNode.unbound(Value, tags.values.app)
    const greeting = make({ service: Greeting, layer: greetingLayer, deps: [unbound] })
    const tree = LayerNode.group([greeting])
    expect(() => LayerNode.compile(tree)).toThrow("Unbound layer node: test/LayerNodeValue")
    const layer = LayerNode.compile(tree, [[unbound, value]]) as Layer.Layer<Greeting>
    const program = Effect.map(Greeting, (item) => item.value).pipe(Effect.provide(layer))
    expect(await Effect.runPromise(program)).toBe("hello production")
  })

  test("replaces a node with a closed layer", async () => {
    const replacement = Layer.succeed(Value, Value.of({ value: "simulation" }))
    const program = Effect.map(Greeting, (item) => item.value).pipe(
      Effect.provide(build(LayerNode.group([greeting]), [[value, replacement]])),
    )
    expect(await Effect.runPromise(program)).toBe("hello simulation")
  })

  test("replaces every use of the same layer", async () => {
    const leftLayer = Layer.effect(
      Left,
      Effect.map(Value, (item) => Left.of({ value: item.value })),
    )
    const rightLayer = Layer.effect(
      Right,
      Effect.map(Value, (item) => Right.of({ value: item.value })),
    )
    const left = make({ service: Left, layer: leftLayer, deps: [value] })
    const right = make({ service: Right, layer: rightLayer, deps: [value] })
    const replacement = Layer.succeed(Value, Value.of({ value: "replaced" }))
    const layer = build(LayerNode.group([left, right]), [[value, replacement]])
    const program = Effect.gen(function* () {
      return [(yield* Left).value, (yield* Right).value]
    }).pipe(Effect.provide(layer))
    expect(await Effect.runPromise(program)).toEqual(["replaced", "replaced"])
  })

  test("does not acquire an unused replacement", async () => {
    let acquisitions = 0
    const other = make({ service: Left, layer: Layer.succeed(Left, Left.of({ value: "other" })), deps: [] })
    const replacement = Layer.effect(
      Left,
      Effect.sync(() => {
        acquisitions++
        return Left.of({ value: "replacement" })
      }),
    )
    await Effect.runPromise(
      Effect.map(Greeting, (item) => item.value).pipe(
        Effect.provide(build(LayerNode.group([greeting]), [[other, replacement]])),
      ),
    )
    expect(acquisitions).toBe(0)
  })

  test("replaces a node without acquiring its dependencies", async () => {
    let acquisitions = 0
    const dependencyLayer = Layer.effect(
      Value,
      Effect.sync(() => {
        acquisitions++
        return Value.of({ value: "dependency" })
      }),
    )
    const dependency = make({ service: Value, layer: dependencyLayer, deps: [] })
    const original = make({ service: Greeting, layer: greetingLayer, deps: [dependency] })
    const replacement = make({
      service: Greeting,
      layer: Layer.succeed(Greeting, Greeting.of({ value: "replacement" })),
      deps: [],
    })

    const program = Effect.map(Greeting, (item) => item.value).pipe(
      Effect.provide(build(LayerNode.group([original]), [[original, replacement]])),
    )

    expect(await Effect.runPromise(program)).toBe("replacement")
    expect(acquisitions).toBe(0)
  })

  test("applies later replacements inside earlier replacement nodes", async () => {
    const original = make({ service: Greeting, layer: greetingLayer, deps: [value] })
    const replacement = make({ service: Greeting, layer: greetingLayer, deps: [value] })
    const program = Effect.map(Greeting, (item) => item.value).pipe(
      Effect.provide(
        build(LayerNode.group([original]), [
          [original, replacement],
          [value, Layer.succeed(Value, Value.of({ value: "replacement dependency" }))],
        ]),
      ),
    )

    expect(await Effect.runPromise(program)).toBe("hello replacement dependency")
  })

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

    const result = LayerNode.hoist(LayerNode.group([app]), tags.values.global)
    expect(result.node.dependencies[0]?.dependencies[0]?.dependencies[0]).toMatchObject({
      kind: "group",
      dependencies: [],
    })
    expect(result.hoisted.dependencies).toEqual([database])

    const layer = LayerNode.compile(result.node).pipe(
      Layer.provide(LayerNode.compile(result.hoisted)),
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
    const first = global({
      service: Database,
      layer: Layer.succeed(Database, Database.of({ name: "first" })),
      deps: [],
    })
    const second = global({
      service: Database,
      layer: Layer.succeed(Database, Database.of({ name: "second" })),
      deps: [],
    })
    const left = location({
      service: Users,
      layer: Layer.effect(Users, Effect.as(Database, Users.of({ list: Effect.succeed([]) }))),
      deps: [first],
    })
    const right = location({
      service: App,
      layer: Layer.effect(App, Effect.as(Database, App.of({ run: Effect.succeed([]) }))),
      deps: [second],
    })

    expect(() => LayerNode.hoist(LayerNode.group([left, right]), tags.values.global)).toThrow(
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
    const result = LayerNode.hoist(LayerNode.group([users]), tags.values.global)

    expect(result.node.dependencies[0]?.dependencies[0]?.dependencies[0]).toMatchObject({
      kind: "group",
      dependencies: [],
    })
  })
})
