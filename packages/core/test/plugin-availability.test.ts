import { expect } from "bun:test"
import { Clock, Deferred, Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("reload-fixture")
const modelID = Model.ID.make("selected")
const source: Plugin.Generation = {
  id: "catalog",
  revision: "1",
  effect: (ctx) =>
    ctx.provider
      .transform((editor) =>
        editor.add({
          info: { ...Provider.Info.empty(providerID), activation: "enabled" },
          models: [Model.Info.default(providerID, modelID)],
        }),
      )
      .pipe(Effect.asVoid),
}

it.effect("fences catalog resolution through changed preceding plugin setup and suffix teardown", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const models = yield* Model.Service
    const entered = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()
    yield* plugins.activate([{ id: "preceding", revision: "1", effect: () => Effect.void }, source])
    const before = yield* plugins.withActivation(models.available())
    expect(before.map((model) => model.id)).toEqual([modelID])
    const activation = yield* plugins
      .activate([
        {
          id: "preceding",
          revision: "2",
          effect: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate))),
        },
        source,
      ])
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(entered)
    expect(yield* models.available()).toEqual([])
    const read = yield* plugins.withActivation(models.available()).pipe(Effect.forkScoped({ startImmediately: true }))
    expect(read.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(gate, undefined)
    yield* Fiber.join(activation)
    expect((yield* Fiber.join(read)).map((model) => model.id)).toEqual([modelID])
    yield* plugins.activate([])
    expect(yield* plugins.withActivation(models.available())).toEqual([])
  }),
)

it.effect("allows concurrent readers while a writer waits for every reader and fences later readers", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const models = yield* Model.Service
    const firstEntered = yield* Deferred.make<void>()
    const secondEntered = yield* Deferred.make<void>()
    const firstGate = yield* Deferred.make<void>()
    const secondGate = yield* Deferred.make<void>()
    const first = yield* plugins
      .withActivation(Deferred.succeed(firstEntered, undefined).pipe(Effect.andThen(Deferred.await(firstGate))))
      .pipe(Effect.forkScoped({ startImmediately: true }))
    const second = yield* plugins
      .withActivation(Deferred.succeed(secondEntered, undefined).pipe(Effect.andThen(Deferred.await(secondGate))))
      .pipe(Effect.forkScoped({ startImmediately: true }))
    expect(yield* Deferred.isDone(firstEntered)).toBe(true)
    expect(yield* Deferred.isDone(secondEntered)).toBe(true)
    const activation = yield* plugins.activate([source]).pipe(Effect.forkScoped({ startImmediately: true }))
    const later = yield* plugins.withActivation(models.available()).pipe(Effect.forkScoped({ startImmediately: true }))
    expect(activation.pollUnsafe()).toBeUndefined()
    expect(later.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(firstGate, undefined)
    yield* Fiber.join(first)
    expect(activation.pollUnsafe()).toBeUndefined()
    expect(later.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(secondGate, undefined)
    yield* Fiber.join(second)
    yield* Fiber.join(activation)
    expect((yield* Fiber.join(later)).map((model) => model.id)).toEqual([modelID])
  }),
)

it.effect("waits through installation and discovery beyond 31 seconds without a host deadline", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const models = yield* Model.Service
    const release = yield* plugins.hold()
    const clock = yield* Clock.Clock
    const fetching = yield* Deferred.make<void>()
    const retrying = yield* Deferred.make<void>()
    // The supervisor holds readiness while installing, then plugin setup owns discovery's deadline.
    const installation = yield* Effect.sleep("10 seconds").pipe(
      Effect.andThen(
        plugins.activate([
          {
            ...source,
            effect: (ctx) =>
              Deferred.succeed(fetching, undefined).pipe(
                Effect.andThen(Effect.sleep("15 seconds")),
                Effect.andThen(Deferred.succeed(retrying, undefined)),
                Effect.andThen(Effect.sleep("6 seconds")),
                Effect.andThen(source.effect(ctx)),
                // Plugin setup receives an isolated context, so supply the test clock explicitly.
                Effect.provideService(Clock.Clock, clock),
              ),
          },
        ]),
      ),
      Effect.ensuring(release),
      Effect.forkScoped({ startImmediately: true }),
    )
    const read = yield* plugins.withActivation(models.available()).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* TestClock.adjust("10 seconds")
    yield* Deferred.await(fetching)
    yield* TestClock.adjust("15 seconds")
    yield* Deferred.await(retrying)
    yield* TestClock.adjust("5 seconds")
    expect(read.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust("1 second")
    yield* Fiber.join(installation)
    expect((yield* Fiber.join(read)).map((model) => model.id)).toEqual([modelID])
  }),
)

it.effect("keeps pending holds closed to readers and cleans up cancelled waits", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const release = yield* plugins.hold()
    let reads = 0
    const cancelled = yield* plugins
      .withActivation(Effect.sync(() => ++reads))
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* TestClock.adjust("32 seconds")
    expect(cancelled.pollUnsafe()).toBeUndefined()
    yield* Fiber.interrupt(cancelled)
    expect(reads).toBe(0)
    yield* release
    expect(yield* plugins.withActivation(Effect.sync(() => ++reads))).toBe(1)
  }),
)

it.effect("releases reader permits on interruption and writer readiness on cancellation", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const entered = yield* Deferred.make<void>()
    const blocked = yield* plugins
      .withActivation(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)))
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(entered)
    const cancelled = yield* plugins.activate([source]).pipe(Effect.forkScoped({ startImmediately: true }))
    expect(cancelled.pollUnsafe()).toBeUndefined()
    yield* Fiber.interrupt(cancelled)
    yield* plugins.withActivation(Effect.void)
    yield* Fiber.interrupt(blocked)
    yield* plugins.activate([source])
    const models = yield* Model.Service
    expect((yield* plugins.withActivation(models.available())).map((model) => model.id)).toEqual([modelID])
  }),
)

it.effect("close waits for all readers and prevents later readers from entering teardown", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const teardown = yield* Deferred.make<void>()
    const teardownGate = yield* Deferred.make<void>()
    yield* plugins.activate([
      {
        id: "cleanup",
        revision: "1",
        effect: () =>
          Effect.addFinalizer(() =>
            Deferred.succeed(teardown, undefined).pipe(Effect.andThen(Deferred.await(teardownGate))),
          ),
      },
    ])
    const active = yield* plugins.withActivation(Effect.never).pipe(Effect.forkScoped({ startImmediately: true }))
    const closing = yield* plugins.close(Exit.void).pipe(Effect.forkScoped({ startImmediately: true }))
    const later = yield* plugins.withActivation(Effect.void).pipe(Effect.forkScoped({ startImmediately: true }))
    expect(closing.pollUnsafe()).toBeUndefined()
    expect(later.pollUnsafe()).toBeUndefined()
    expect(yield* Deferred.isDone(teardown)).toBe(false)
    yield* Fiber.interrupt(active)
    yield* Deferred.await(teardown)
    expect(later.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(teardownGate, undefined)
    yield* Fiber.join(closing)
    yield* Fiber.join(later)
  }),
)
