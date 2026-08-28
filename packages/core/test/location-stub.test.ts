import { expect, test } from "bun:test"
import path from "path"
import { Context, Effect, Layer, Ref } from "effect"
import { InstanceMap } from "@opencode-ai/core/instance-map"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor-service"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { stubLocations } from "./fixture/location"
import { testEffect } from "./lib/effect"

class InitialCount extends Context.Service<InitialCount, number>()("test/LocationStubInitialCount") {}

const it = testEffect(Layer.succeed(InitialCount, 0))

it.effect("isolates mutable services across locations and reuses them within one location", () =>
  Effect.gen(function* () {
    const counts: number[] = []
    const services = Layer.effect(
      PluginSupervisor.Service,
      Effect.gen(function* () {
        const initial = yield* InitialCount
        const count = yield* Ref.make(initial)
        return {
          flush: Ref.updateAndGet(count, (value) => value + 1).pipe(
            Effect.tap((value) => Effect.sync(() => counts.push(value))),
            Effect.asVoid,
          ),
        }
      }),
    )
    yield* Effect.gen(function* () {
      const locations = yield* InstanceMap.Service
      const first = yield* locations.contextEffect({ directory: AbsolutePath.make(path.resolve("a")) })
      const second = yield* locations.contextEffect({ directory: AbsolutePath.make(path.resolve("b")) })
      expect(yield* locations.contextEffect({ directory: AbsolutePath.make(path.resolve("a")) })).toBe(first)

      const firstSupervisor = Context.get(first, PluginSupervisor.Service)
      const secondSupervisor = Context.get(second, PluginSupervisor.Service)
      expect(
        yield* PluginSupervisor.Service.pipe(
          Effect.provide(locations.forSession({ location: { directory: AbsolutePath.make(path.resolve("a")) } })),
        ),
      ).toBe(firstSupervisor)
      yield* firstSupervisor.flush
      yield* firstSupervisor.flush
      yield* secondSupervisor.flush
      expect(counts).toEqual([1, 2, 1])
    }).pipe(Effect.provide(stubLocations(services)), Effect.scoped)
  }),
)

test("stub types preserve requirements and reject undeclared errors", () => {
  const dependent = stubLocations(Layer.effectDiscard(InitialCount))
  const required: Layer.Layer<InstanceMap.Service, never, InitialCount> = dependent
  // @ts-expect-error Required dependencies cannot be erased by the stub.
  const closed: Layer.Layer<InstanceMap.Service> = dependent
  // @ts-expect-error Intentional fixture failures must use the map's error contract or defects.
  stubLocations(Layer.effectDiscard(Effect.fail(new Error("fixture failure"))))
  void required
  void closed
})
