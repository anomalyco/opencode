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

  it.effect("commits rebuilt state before finalize runs", () =>
    Effect.gen(function* () {
      const observed: string[][] = []
      const state: State.Interface<{ values: string[] }, { add: (item: string) => void }> = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () => Effect.sync(() => observed.push([...state.get().values])),
      })

      yield* state.transform((draft) => {
        draft.add("value")
      })

      // Update events publish from finalize, so consumers reading on the event
      // must observe the rebuilt state, not the previous one.
      expect(observed).toEqual([["value"]])
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
      let notified = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        notify: () => Effect.sync(() => notified++),
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
      expect(notified).toBe(3)

      yield* registration.dispose
      expect(state.get().values).toEqual(["first"])
      expect(notified).toBe(3)
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

  it.effect("discards teardown rebuilds and pending reloads while still running cleanup", () =>
    Effect.gen(function* () {
      let finalized = 0
      let disposed = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () => Effect.sync(() => finalized++),
      })
      const scope = yield* Scope.make()
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => disposed++),
      )
      const registration = yield* state.transform((draft) => draft.add("value")).pipe(Scope.provide(scope))
      expect(finalized).toBe(1)

      const pending = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("250 millis")
      yield* State.batch(Scope.close(scope, Exit.void), { flush: false })
      expect(disposed).toBe(1)
      expect(finalized).toBe(1)

      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(pending)
      yield* registration.dispose
      yield* state.reload()
      expect(finalized).toBe(1)
    }),
  )

  it.effect("keeps teardown suppression separate from an enclosing live batch", () =>
    Effect.gen(function* () {
      const finalized: string[] = []
      const closing = State.create({
        initial: () => ({}),
        draft: (draft) => draft,
        finalize: () => Effect.sync(() => finalized.push("closing")),
      })
      const live = State.create({
        initial: () => ({}),
        draft: (draft) => draft,
        finalize: () => Effect.sync(() => finalized.push("live")),
      })
      const scope = yield* Scope.make()
      yield* closing.transform(() => {}).pipe(Scope.provide(scope))
      finalized.length = 0

      yield* State.batch(
        Effect.gen(function* () {
          yield* live.transform(() => {})
          yield* State.batch(Scope.close(scope, Exit.void), { flush: false })
        }),
      )
      expect(finalized).toEqual(["live"])
    }),
  )

  it.effect("commits every batched state before notifying", () =>
    Effect.gen(function* () {
      type Registry = State.Interface<
        { values: string[] },
        { add: (item: string) => void; list: () => readonly string[] }
      >
      const observed: string[][] = []
      const first: Registry = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({
          add: (item: string) => draft.values.push(item),
          list: () => draft.values,
        }),
        notify: (draft) => Effect.sync(() => observed.push([...draft.list(), ...second.get().values])),
      })
      const second: Registry = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({
          add: (item: string) => draft.values.push(item),
          list: () => draft.values,
        }),
        notify: (draft) => Effect.sync(() => observed.push([...first.get().values, ...draft.list()])),
      })

      yield* State.batch(
        Effect.gen(function* () {
          yield* first.transform((draft) => {
            draft.add("first")
          })
          yield* second.transform((draft) => {
            draft.add("second")
          })
        }),
      )

      expect(observed).toEqual([
        ["first", "second"],
        ["first", "second"],
      ])
    }),
  )

  it.effect("debounces reload bursts", () =>
    Effect.gen(function* () {
      let notified = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        notify: () => Effect.sync(() => notified++),
      })
      yield* state.transform((draft) => {
        draft.add("value")
      })
      notified = 0

      const first = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("250 millis")
      const second = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("499 millis")
      expect(notified).toBe(0)
      yield* TestClock.adjust("1 millis")
      yield* Fiber.join(first)
      yield* Fiber.join(second)

      expect(notified).toBe(1)
    }),
  )

  it.effect("allows debounced notifications to synchronously reload", () =>
    Effect.gen(function* () {
      let reenter = false
      let notified = 0
      const state: State.Interface<{ values: string[] }, { add: (item: string) => void }> = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        notify: () =>
          Effect.gen(function* () {
            notified++
            if (!reenter) return
            reenter = false
            yield* state.reload()
          }),
      })
      yield* state.transform((draft) => {
        draft.add("value")
      })
      notified = 0
      reenter = true

      const reload = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("500 millis")
      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(reload)

      expect(notified).toBe(2)
    }),
  )

  it.effect("settles each reload after its own notification", () =>
    Effect.gen(function* () {
      const firstStarted = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      let block = false
      let notified = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        notify: () =>
          Effect.gen(function* () {
            notified++
            if (!block || notified !== 1) return
            yield* Deferred.succeed(firstStarted, undefined)
            yield* Deferred.await(releaseFirst)
          }),
      })
      yield* state.transform((draft) => {
        draft.add("value")
      })
      notified = 0
      block = true

      const first = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("500 millis")
      yield* Deferred.await(firstStarted)
      const second = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(second)

      expect(first.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(releaseFirst, undefined)
      yield* Fiber.join(first)
    }),
  )
})
