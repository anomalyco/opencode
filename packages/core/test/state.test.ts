import { describe, expect } from "bun:test"
import { State } from "@opencode-ai/core/state"
import { Deferred, Effect, Exit, Fiber, Layer, Scheduler, Scope } from "effect"
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

  it.effect("skips a reload's debounce when resolving but joins an in-progress reload", () =>
    Effect.gen(function* () {
      const rebuilding = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let value = "first"
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () =>
          value === "first"
            ? Effect.void
            : Deferred.succeed(rebuilding, undefined).pipe(Effect.andThen(Deferred.await(release))),
      })

      yield* state.transform((editor) => {
        editor.add(value)
      })
      expect(state.get().values).toEqual(["first"])

      value = "second"
      const reload = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
      expect((yield* state.resolve()).values).toEqual(["first"])
      yield* TestClock.adjust("500 millis")
      yield* Deferred.await(rebuilding)
      const reader = yield* state.resolve().pipe(Effect.forkChild({ startImmediately: true }))
      expect(reader.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(reload)
      expect((yield* Fiber.join(reader)).values).toEqual(["second"])
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

  it.effect("resolves registrations deferred by a batch without rebuilding twice", () =>
    Effect.gen(function* () {
      let finalized = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () => Effect.sync(() => finalized++),
      })

      expect(yield* state.resolve()).toBe(state.get())
      expect(finalized).toBe(0)

      yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((draft) => {
            draft.add("first")
          })
          expect(state.get().values).toEqual([])

          expect((yield* state.resolve()).values).toEqual(["first"])
          expect(state.get().values).toEqual(["first"])
          expect(finalized).toBe(1)

          expect(yield* state.resolve()).toBe(state.get())
          expect(finalized).toBe(1)

          yield* state.transform((draft) => {
            draft.add("second")
          })
        }),
      )

      // Resolution absorbed the queued batch rebuild; only the later registration
      // rebuilds at batch completion.
      expect(state.get().values).toEqual(["first", "second"])
      expect(finalized).toBe(2)
    }),
  )

  it.effect("resolves disposals deferred by a batch", () =>
    Effect.gen(function* () {
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
      })
      const scope = yield* Scope.make()
      yield* state.transform((draft) => draft.add("value")).pipe(Scope.provide(scope))
      expect(state.get().values).toEqual(["value"])

      yield* State.batch(
        Effect.gen(function* () {
          yield* Scope.close(scope, Exit.void)
          expect(state.get().values).toEqual(["value"])

          expect((yield* state.resolve()).values).toEqual([])
        }),
      )
    }),
  )

  it.effect("joins a concurrent resolution instead of returning the previous publication", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const values = Array.from({ length: 128 }, (_, index) => index)
      let finalized = 0
      const state = State.create({
        initial: () => ({ values: [] as number[] }),
        draft: (draft) => draft,
        finalize: () => Effect.sync(() => finalized++),
      })

      yield* State.batch(
        Effect.gen(function* () {
          yield* Effect.forEach(values, (value) =>
            state.transform((draft) => {
              draft.values.push(value)
              if (value === 0) Deferred.doneUnsafe(started, Effect.void)
            }),
          )
          const reader = yield* Deferred.await(started).pipe(
            Effect.andThen(
              Effect.gen(function* () {
                expect(state.get().values).toEqual([])
                return yield* state.resolve()
              }),
            ),
            Effect.forkChild({ startImmediately: true }),
          )
          // Yield during synchronous transform replay, before the next value is published.
          const writer = yield* state
            .resolve()
            .pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, 64), Effect.forkChild({ startImmediately: true }))
          const observed = yield* Fiber.join(reader)
          const published = yield* Fiber.join(writer)
          expect(observed.values).toEqual(values)
          expect(observed).toBe(published)
        }),
      )
      expect(finalized).toBe(1)
    }),
  )

  it.effect("keeps queued resolution cancellable but finishes a rebuild once started", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let finalized = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => draft,
        finalize: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(Effect.sync(() => finalized++)),
          ),
      })

      yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((draft) => draft.values.push("value"))
          const writer = yield* state.resolve().pipe(Effect.forkChild({ startImmediately: true }))
          yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
          yield* Deferred.await(started)
          const reader = yield* state.resolve().pipe(Effect.forkChild({ startImmediately: true }))
          expect(reader.pollUnsafe()).toBeUndefined()
          yield* Fiber.interrupt(reader)
          expect(writer.pollUnsafe()).toBeUndefined()

          const interruption = yield* Fiber.interrupt(writer).pipe(Effect.forkChild({ startImmediately: true }))
          expect(interruption.pollUnsafe()).toBeUndefined()
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(interruption)
          expect((yield* state.resolve()).values).toEqual(["value"])
        }),
      )
      expect(finalized).toBe(1)
    }),
  )

  it.effect("can resolve again after transform replay fails", () =>
    Effect.gen(function* () {
      let fail = true
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => draft,
      })

      yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((draft) => {
            if (fail) throw new Error("replay failed")
            draft.values.push("value")
          })
          expect(Exit.isFailure(yield* Effect.exit(state.resolve()))).toBeTrue()
          expect(state.get().values).toEqual([])
          fail = false
          expect((yield* state.resolve()).values).toEqual(["value"])
        }),
      )
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
      expect(yield* state.resolve()).toBe(state.get())
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
