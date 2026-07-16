import { describe, expect } from "bun:test"
import { State } from "@opencode-ai/core/state"
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

describe("State", () => {
  it.effect("commits a transform atomically when its updater is interrupted", () =>
    Effect.gen(function* () {
      const rebuilding = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let block = true
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (value: string) => draft.values.push(value) }),
        finalize: () =>
          block ? Deferred.succeed(rebuilding, undefined).pipe(Effect.andThen(Deferred.await(release))) : Effect.void,
      })
      const scope = yield* Scope.make()
      const fiber = yield* state
        .transform((editor) => {
          editor.add("registered")
        })
        .pipe(Scope.provide(scope), Effect.forkChild)
      yield* Deferred.await(rebuilding)
      const interruption = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild)
      block = false
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(interruption)

      expect(state.get().values).toEqual(["registered"])
      yield* Scope.close(scope, Exit.void)
      expect(state.get().values).toEqual([])
    }),
  )

  it.effect("runs transforms during every reload", () =>
    Effect.gen(function* () {
      let value = "first"
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
      })

      yield* state.transform((editor) => {
        editor.add(value)
      })
      expect(state.get().values).toEqual(["first"])

      value = "second"
      const reload = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(reload)
      expect(state.get().values).toEqual(["second"])
    }),
  )

  it.effect("disposes a transform once and rebuilds remaining state", () =>
    Effect.gen(function* () {
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
      })
      yield* state.transform((editor) => {
        editor.add("first")
      })
      const registration = yield* state.transform((editor) => {
        editor.add("second")
      })
      expect(state.get().values).toEqual(["first", "second"])

      yield* registration.dispose
      expect(state.get().values).toEqual(["first"])

      yield* registration.dispose
      expect(state.get().values).toEqual(["first"])
    }),
  )

  it.effect("batches automatic rebuilds", () =>
    Effect.gen(function* () {
      let finalized = 0
      const first = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () => Effect.sync(() => finalized++),
      })
      const second = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () => Effect.sync(() => finalized++),
      })

      yield* State.batch(
        Effect.gen(function* () {
          yield* first.transform((draft) => {
            draft.add("first")
          })
          yield* first.transform((draft) => {
            draft.add("second")
          })
          yield* second.transform((draft) => {
            draft.add("third")
          })
          expect(finalized).toBe(0)
        }),
      )

      expect(first.get().values).toEqual(["first", "second"])
      expect(second.get().values).toEqual(["third"])
      expect(finalized).toBe(2)
    }),
  )

  it.effect("debounces reload bursts", () =>
    Effect.gen(function* () {
      let finalized = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () => Effect.sync(() => finalized++),
      })
      yield* state.transform((draft) => {
        draft.add("value")
      })
      finalized = 0

      const first = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("250 millis")
      const second = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("499 millis")
      expect(finalized).toBe(0)
      yield* TestClock.adjust("1 millis")
      yield* Fiber.join(first)
      yield* Fiber.join(second)

      expect(finalized).toBe(1)
    }),
  )
})
