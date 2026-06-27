import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Node } from "@opencode-ai/core/effect/node"
import { NodeBuild } from "@opencode-ai/core/effect/node-build"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "../../fixture/tmpdir"

class Value extends Context.Service<Value, { readonly value: string }>()("test/TagValue") {}
class Result extends Context.Service<Result, { readonly value: string }>()("test/TagResult") {}
class Left extends Context.Service<Left, { readonly value: string }>()("test/TagLeft") {}
class Right extends Context.Service<Right, { readonly value: string }>()("test/TagRight") {}
class Last extends Context.Service<Last, { readonly value: string }>()("test/TagLast") {}

describe("node build", () => {
  test("shares top-level project with location services", async () => {
    await using tmp = await tmpdir()
    let acquisitions = 0
    const projectLayer = Layer.effect(
      Project.Service,
      Effect.sync(() => {
        acquisitions++
        return Project.Service.of({
          directories: () => Effect.succeed([]),
          resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory }),
          commit: () => Effect.void,
        })
      }),
    )
    const layer = NodeBuild.build(LayerNode.group([Project.node, LocationServiceMap.node]), [
      LayerNode.replace(Project.layer, projectLayer),
    ])
    const ref = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
    const program = Effect.gen(function* () {
      yield* Project.Service
      const locations = yield* LocationServiceMap.Service
      return yield* Location.Service.pipe(Effect.provide(locations.get(ref)))
    }).pipe(Effect.provide(layer))

    expect((await Effect.runPromise(program)).directory).toBe(ref.directory)
    expect(acquisitions).toBe(1)
  })

  test("returns a composed application layer", async () => {
    const value = Node.makeGlobalNode({
      service: Value,
      layer: Layer.succeed(Value, Value.of({ value: "value" })),
      deps: [],
    })
    const result = Node.makeGlobalNode({
      service: Result,
      layer: Layer.effect(
        Result,
        Effect.gen(function* () {
          return Result.of({ value: (yield* Value).value })
        }),
      ),
      deps: [value],
    })
    const serviceLayer = NodeBuild.build(LayerNode.group([result]))
    const program = Effect.gen(function* () {
      return (yield* Result).value
    }).pipe(Effect.provide(serviceLayer))

    expect(await Effect.runPromise(program)).toBe("value")
  })

  test("rebinds same-tag providers without reacquiring them", async () => {
    let firstAcquisitions = 0
    const tags = LayerNode.tags({ global: [] })
    const global = tags.make("global")
    const first = global({
      service: Value,
      layer: Layer.effect(
        Value,
        Effect.sync(() => {
          firstAcquisitions++
          return Value.of({ value: "first" })
        }),
      ),
      deps: [],
    })
    const second = global({ service: Value, layer: Layer.succeed(Value, Value.of({ value: "second" })), deps: [] })
    const left = global({
      service: Left,
      layer: Layer.effect(
        Left,
        Effect.map(Value, (value) => Left.of({ value: value.value })),
      ),
      deps: [first],
    })
    const right = global({
      service: Right,
      layer: Layer.effect(
        Right,
        Effect.map(Value, (value) => Right.of({ value: value.value })),
      ),
      deps: [second],
    })
    const last = global({
      service: Last,
      layer: Layer.effect(
        Last,
        Effect.map(Value, (value) => Last.of({ value: value.value })),
      ),
      deps: [first],
    })
    const layer = NodeBuild.build(LayerNode.group([left, right, last])) as Layer.Layer<Left | Right | Last>
    const values = Effect.gen(function* () {
      return [(yield* Left).value, (yield* Right).value, (yield* Last).value]
    }).pipe(Effect.provide(layer))

    expect(await Effect.runPromise(values)).toEqual(["first", "second", "first"])
    expect(firstAcquisitions).toBe(1)
  })
})
