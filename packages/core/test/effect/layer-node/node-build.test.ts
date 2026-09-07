import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer, Option } from "effect"
import { Node } from "@opencode-ai/util/effect/app-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { buildLocationServiceMap } from "@opencode-ai/core/location-services"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "../../fixture/tmpdir"
import { testEffect } from "../../lib/effect"

class Value extends Context.Service<Value, { readonly value: string }>()("test/TagValue") {}
class Result extends Context.Service<Result, { readonly value: string }>()("test/TagResult") {}
class CycleA extends Context.Service<CycleA, {}>()("test/NodeBuildA") {}
class CycleB extends Context.Service<CycleB, { readonly directory: AbsolutePath }>()("test/NodeBuildB") {}

const it = testEffect(Layer.empty)

describe("node build", () => {
  test("does not build a location service map when the graph does not require it", async () => {
    const result = Node.makeGlobalNode({
      service: Result,
      layer: Layer.succeed(Result, Result.of({ value: "plain" })),
      deps: [],
    })
    const layer = AppNodeBuilder.build(result)
    const program = Effect.gen(function* () {
      expect(Option.isNone(yield* Effect.serviceOption(LocationServiceMap.Service))).toBe(true)
      return (yield* Result).value
    }).pipe(Effect.provide(layer))

    expect(await Effect.runPromise(program)).toBe("plain")
  })

  test("detects cycles through a replaced location service map", () => {
    const a = Node.makeGlobalNode({
      service: CycleA,
      layer: Layer.effect(CycleA, Effect.as(LocationServiceMap.Service, CycleA.of({}))),
      deps: [LocationServiceMap.node],
    })
    const b = Node.makeGlobalNode({
      service: CycleB,
      layer: Layer.effect(
        CycleB,
        Effect.map(CycleA, () => CycleB.of({ directory: AbsolutePath.make(process.cwd()) })),
      ),
      deps: [a],
    })
    const mapLayer = Layer.unwrap(Effect.as(CycleB, buildLocationServiceMap()))
    const map = Node.makeGlobalNode({ service: LocationServiceMap.Service, layer: mapLayer, deps: [b] })
    expect(() => AppNodeBuilder.build(LayerNode.group([a]), [LocationServiceMap.node.replace(map)])).toThrow(
      "Cycle detected in layer graph",
    )
  })

  it.effect("supplies the lazy map when only a replacement introduces the dependency", () =>
    Effect.gen(function* () {
      const original = Node.makeGlobalNode({
        service: Result,
        layer: Layer.succeed(Result, { value: "original" }),
        deps: [],
      })
      const replacement = Node.makeGlobalNode({
        service: Result,
        layer: Layer.effect(Result, Effect.as(LocationServiceMap.Service, Result.of({ value: "has map" }))),
        deps: [LocationServiceMap.node],
      })
      const result = yield* Result.pipe(Effect.provide(AppNodeBuilder.build(original, [original.replace(replacement)])))
      expect(result.value).toBe("has map")
    }),
  )

  it.effect("caller replacements override the lazy default without building any locations", () =>
    Effect.gen(function* () {
      const acquisitions: string[] = []
      const override = buildLocationServiceMap().pipe(
        Layer.tap(() =>
          Effect.sync(() => {
            acquisitions.push("caller map")
          }),
        ),
      )
      const context = yield* Layer.build(
        AppNodeBuilder.build(LocationServiceMap.node, [LocationServiceMap.node.replace(override)]),
      )
      expect(Context.get(context, LocationServiceMap.Service)).toBeDefined()
      expect(acquisitions).toEqual(["caller map"])
    }),
  )

  test("shares top-level project even when the location service map is built first", async () => {
    await using tmp = await tmpdir()
    let acquisitions = 0
    const projectLayer = Layer.effect(
      Project.Service,
      Effect.sync(() => {
        acquisitions++
        return Project.Service.of({
          list: () => Effect.succeed([]),
          update: () => Effect.die("not implemented"),
          resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory, canonical: directory }),
        })
      }),
    )
    const ref = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
    const layer = AppNodeBuilder.build(LayerNode.group([LocationServiceMap.node, Project.node]), [
      Project.node.replace(projectLayer),
    ])
    const program = Effect.gen(function* () {
      yield* Project.Service
      const locations = yield* LocationServiceMap.Service
      expect(Option.isSome(yield* Effect.serviceOption(LocationServiceMap.Service))).toBe(true)
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
    const serviceLayer = AppNodeBuilder.build(result)
    const program = Effect.gen(function* () {
      expect(Option.isNone(yield* Effect.serviceOption(LocationServiceMap.Service))).toBe(true)
      return (yield* Result).value
    }).pipe(Effect.provide(serviceLayer))

    expect(await Effect.runPromise(program)).toBe("value")
  })
})
