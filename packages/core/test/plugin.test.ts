import { describe, expect } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { State } from "@opencode-ai/core/state"
import { it } from "./lib/effect"

const events = Layer.mock(EventV2.Service)({
  publish: (definition, data) =>
    Effect.succeed({
      id: EventV2.ID.make("evt_plugin_test"),
      type: definition.type,
      data,
    }),
})
const plugins = PluginV2.layer.pipe(Layer.provide(events))

function state() {
  return State.create({
    initial: () => ({ values: [] as string[] }),
    draft: (draft) => ({
      add: (value: string) => draft.values.push(value),
    }),
  })
}

describe("PluginV2", () => {
  it.effect("closes plugin-owned scopes when the registry layer finalizes", () =>
    Effect.gen(function* () {
      const values = state()
      const layerScope = yield* Scope.fork(yield* Scope.Scope)
      const plugin = Context.get(yield* Layer.buildWithScope(Layer.fresh(plugins), layerScope), PluginV2.Service)

      yield* plugin.add({
        id: PluginV2.ID.make("scoped"),
        effect: Effect.gen(function* () {
          yield* values.transform((editor) => {
            editor.add("scoped")
          })
        }),
      })
      expect(values.get().values).toEqual(["scoped"])

      yield* Scope.close(layerScope, Exit.void)
      expect(values.get().values).toEqual([])
    }),
  )

  it.effect("batches plugin state rebuilds when the registry layer finalizes", () =>
    Effect.gen(function* () {
      let finalized = 0
      const values = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (value: string) => draft.values.push(value) }),
        finalize: () => Effect.sync(() => finalized++),
      })
      const layerScope = yield* Scope.fork(yield* Scope.Scope)
      const plugin = Context.get(yield* Layer.buildWithScope(Layer.fresh(plugins), layerScope), PluginV2.Service)

      yield* State.batch(
        Effect.forEach(
          ["first", "second"],
          (id) =>
            plugin.add({
              id: PluginV2.ID.make(id),
              effect: values
                .transform((editor) => {
                  editor.add(id)
                })
                .pipe(Effect.asVoid),
            }),
          { discard: true },
        ),
      )
      finalized = 0

      yield* Scope.close(layerScope, Exit.void)
      expect(values.get().values).toEqual([])
      expect(finalized).toBe(1)
    }),
  )

  it.effect("serializes same-ID additions and leaves one removable attachment", () =>
    Effect.gen(function* () {
      const values = state()
      const layerScope = yield* Scope.fork(yield* Scope.Scope)
      const plugin = Context.get(yield* Layer.buildWithScope(Layer.fresh(plugins), layerScope), PluginV2.Service)
      const id = PluginV2.ID.make("shared")
      const firstStarted = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()

      const first = yield* plugin
        .add({
          id,
          effect: Effect.gen(function* () {
            yield* values.transform((editor) => {
              editor.add("first")
            })
            yield* Deferred.succeed(firstStarted, undefined)
            yield* Deferred.await(releaseFirst)
          }),
        })
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstStarted)

      const second = yield* plugin
        .add({
          id,
          effect: Effect.gen(function* () {
            yield* values.transform((editor) => {
              editor.add("second")
            })
          }),
        })
        .pipe(Effect.forkChild({ startImmediately: true }))
      expect(values.get().values).toEqual(["first"])

      yield* Deferred.succeed(releaseFirst, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      expect(values.get().values).toEqual(["second"])

      yield* plugin.remove(id)
      expect(values.get().values).toEqual([])
    }),
  )
})
