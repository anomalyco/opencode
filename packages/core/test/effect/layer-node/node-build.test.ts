import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer, LayerMap, Option } from "effect"
import { Node } from "@opencode-ai/core/effect/app-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationError, LocationServices } from "@opencode-ai/core/location-services"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "../../fixture/tmpdir"

class Value extends Context.Service<Value, { readonly value: string }>()("test/TagValue") {}
class Result extends Context.Service<Result, { readonly value: string }>()("test/TagResult") {}
class CycleA extends Context.Service<CycleA, {}>()("test/NodeBuildA") {}
class CycleB extends Context.Service<CycleB, { readonly directory: AbsolutePath }>()("test/NodeBuildB") {}

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

  test("detects cycles through a replaced location service map", async () => {
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
    const mapLayer = Layer.effect(
      LocationServiceMap.Service,
      Effect.gen(function* () {
        const service = yield* CycleB
        return yield* LayerMap.make(
          (ref: Location.Ref) =>
            Layer.succeed(
              Location.Service,
              Location.Service.of({
                directory: ref.directory,
                workspaceID: ref.workspaceID,
                project: { id: Project.ID.global, directory: service.directory },
              }),
            ),
          { idleTimeToLive: "1 minute" },
        )
      }) as unknown as Effect.Effect<LayerMap.LayerMap<Location.Ref, LocationServices, LocationError>, never, CycleB>,
    )
    const map = Node.makeGlobalNode({ service: LocationServiceMap.Service, layer: mapLayer, deps: [b] })
    expect(() => AppNodeBuilder.build(LayerNode.group([a]), [[LocationServiceMap.node, map]])).toThrow(
      "Cycle detected in layer tree",
    )
  })

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
    const ref = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
    const layer = AppNodeBuilder.build(LayerNode.group([Project.node, LocationServiceMap.node]), [
      [Project.node, projectLayer],
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
