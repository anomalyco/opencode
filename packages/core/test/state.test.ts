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

  it.effect("reloads immediately on read", () =>
    Effect.gen(function* () {
      let value = "first"
      let finalized = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () => Effect.sync(() => finalized++),
      })
      yield* state.transform((editor) => {
        editor.add(value)
      })
      finalized = 0

      value = "second"
      const reload = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      expect(state.get().values).toEqual(["first"])
      expect(finalized).toBe(0)

      expect((yield* state.read()).values).toEqual(["second"])
      yield* Fiber.join(reload)
      expect(finalized).toBe(1)

      yield* TestClock.adjust("500 millis")
      expect(finalized).toBe(1)
    }),
  )

  it.effect("single-flights concurrent reads", () =>
    Effect.gen(function* () {
      const rebuilding = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let block = false
      let finalized = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () =>
          Effect.gen(function* () {
            finalized++
            if (!block) return
            yield* Deferred.succeed(rebuilding, undefined)
            yield* Deferred.await(release)
          }),
      })
      yield* state.transform((editor) => editor.add("value"))
      finalized = 0
      block = true
      const reload = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))

      const first = yield* state.read().pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(rebuilding)
      const second = yield* state.read().pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      yield* Fiber.join(reload)

      expect(finalized).toBe(1)
    }),
  )

  it.effect("includes reloads requested during a read", () =>
    Effect.gen(function* () {
      const rebuilding = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let value = "first"
      let block = false
      let finalized = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () =>
          Effect.gen(function* () {
            finalized++
            if (!block) return
            block = false
            yield* Deferred.succeed(rebuilding, undefined)
            yield* Deferred.await(release)
          }),
      })
      yield* state.transform((editor) => editor.add(value))
      finalized = 0
      block = true

      value = "second"
      const first = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      const read = yield* state.read().pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(rebuilding)
      value = "third"
      const second = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.succeed(release, undefined)

      expect((yield* Fiber.join(read)).values).toEqual(["third"])
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      expect(finalized).toBe(2)
    }),
  )

  it.effect("shares a failed reload between concurrent reads", () =>
    Effect.gen(function* () {
      const rebuilding = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let fail = false
      let finalized = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () =>
          Effect.gen(function* () {
            finalized++
            if (!fail) return
            yield* Deferred.succeed(rebuilding, undefined)
            yield* Deferred.await(release)
            return yield* Effect.die("failed")
          }),
      })
      yield* state.transform((editor) => editor.add("value"))
      finalized = 0
      fail = true
      const reload = yield* state.reload().pipe(Effect.exit, Effect.forkChild({ startImmediately: true }))

      const first = yield* state.read().pipe(Effect.exit, Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(rebuilding)
      const second = yield* state.read().pipe(Effect.exit, Effect.forkChild({ startImmediately: true }))
      yield* Deferred.succeed(release, undefined)

      expect(Exit.isFailure(yield* Fiber.join(first))).toBeTrue()
      expect(Exit.isFailure(yield* Fiber.join(second))).toBeTrue()
      expect(Exit.isFailure(yield* Fiber.join(reload))).toBeTrue()
      expect(finalized).toBe(1)

      fail = false
      yield* state.read()
      expect(finalized).toBe(2)
    }),
  )

  it.effect("allows nested finalizers to read their committed states", () =>
    Effect.gen(function* () {
      let observe = false
      const first: State.Interface<{ values: string[] }, { add: (item: string) => void }> = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () => (observe ? second.read().pipe(Effect.asVoid) : Effect.void),
      })
      const second: State.Interface<{ values: string[] }, { add: (item: string) => void }> = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () => (observe ? first.read().pipe(Effect.asVoid) : Effect.void),
      })
      yield* first.transform((draft) => draft.add("first"))
      yield* second.transform((draft) => draft.add("second"))
      observe = true
      const firstReload = yield* first.reload().pipe(Effect.forkChild({ startImmediately: true }))
      const secondReload = yield* second.reload().pipe(Effect.forkChild({ startImmediately: true }))

      expect((yield* first.read()).values).toEqual(["first"])
      yield* Fiber.join(firstReload)
      yield* Fiber.join(secondReload)
    }),
  )

  it.effect("allows concurrent finalizers to read committed states", () =>
    Effect.gen(function* () {
      const firstEntered = yield* Deferred.make<void>()
      const secondEntered = yield* Deferred.make<void>()
      let observe = false
      const first: State.Interface<{ values: string[] }, { add: (item: string) => void }> = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () =>
          observe
            ? Deferred.succeed(firstEntered, undefined).pipe(
                Effect.andThen(Deferred.await(secondEntered)),
                Effect.andThen(second.read()),
                Effect.asVoid,
              )
            : Effect.void,
      })
      const second: State.Interface<{ values: string[] }, { add: (item: string) => void }> = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () =>
          observe
            ? Deferred.succeed(secondEntered, undefined).pipe(
                Effect.andThen(Deferred.await(firstEntered)),
                Effect.andThen(first.read()),
                Effect.asVoid,
              )
            : Effect.void,
      })
      yield* first.transform((draft) => draft.add("first"))
      yield* second.transform((draft) => draft.add("second"))
      observe = true
      const firstReload = yield* first.reload().pipe(Effect.forkChild({ startImmediately: true }))
      const secondReload = yield* second.reload().pipe(Effect.forkChild({ startImmediately: true }))
      const firstRead = yield* first.read().pipe(Effect.forkChild({ startImmediately: true }))
      const secondRead = yield* second.read().pipe(Effect.forkChild({ startImmediately: true }))

      expect((yield* Fiber.join(firstRead)).values).toEqual(["first"])
      expect((yield* Fiber.join(secondRead)).values).toEqual(["second"])
      yield* Fiber.join(firstReload)
      yield* Fiber.join(secondReload)
    }),
  )

  it.effect("expires finalizer read access before later reloads", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const observed = yield* Deferred.make<string>()
      let value = "first"
      let observe = false
      const state: State.Interface<{ values: string[] }, { add: (item: string) => void }> = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () =>
          observe
            ? Deferred.await(release).pipe(
                Effect.andThen(state.read()),
                Effect.flatMap((current) => Deferred.succeed(observed, current.values[0] ?? "")),
                Effect.forkDetach,
                Effect.asVoid,
              )
            : Effect.void,
      })
      yield* state.transform((draft) => draft.add(value))
      observe = true
      const first = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* state.read()
      yield* Fiber.join(first)

      observe = false
      value = "second"
      const second = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.succeed(release, undefined)

      expect(yield* Deferred.await(observed)).toBe("second")
      yield* Fiber.join(second)
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

  it.effect("does not publish pending reloads inside an active batch", () =>
    Effect.gen(function* () {
      let finalized = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () => Effect.sync(() => finalized++),
      })
      const reload = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      const observe = yield* Deferred.make<void>()
      const reader = yield* Deferred.await(observe).pipe(
        Effect.andThen(state.read()),
        Effect.forkChild({ startImmediately: true }),
      )

      yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((draft) => draft.add("first"))
          expect((yield* state.read()).values).toEqual([])
          yield* Deferred.succeed(observe, undefined)
          yield* Effect.yieldNow
          expect(finalized).toBe(0)
          yield* state.transform((draft) => draft.add("second"))
        }),
      )
      yield* Fiber.join(reload)

      expect((yield* Fiber.join(reader)).values).toEqual(["first", "second"])
      expect(finalized).toBe(1)
    }),
  )

  it.effect("releases pending reads when a batch is interrupted", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
      })
      const reload = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      const batch = yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((draft) => draft.add("value"))
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
        }),
      ).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(started)
      const reader = yield* state.read().pipe(Effect.forkChild({ startImmediately: true }))

      yield* Fiber.interrupt(batch)

      expect((yield* Fiber.join(reader)).values).toEqual(["value"])
      yield* Fiber.join(reload)
    }),
  )

  it.effect("flushes remaining domains after a batched reload fails", () =>
    Effect.gen(function* () {
      let failing = true
      const first = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        finalize: () => (failing ? Effect.die("failed") : Effect.void),
      })
      const second = State.create({
        initial: () => ({ values: [] as string[] }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
      })
      const firstReload = yield* first.reload().pipe(Effect.exit, Effect.forkChild({ startImmediately: true }))
      const secondReload = yield* second.reload().pipe(Effect.forkChild({ startImmediately: true }))

      const result = yield* State.batch(
        Effect.gen(function* () {
          yield* first.transform((draft) => draft.add("first"))
          yield* second.transform((draft) => draft.add("second"))
        }),
      ).pipe(Effect.exit)

      expect(Exit.isFailure(result)).toBeTrue()
      expect(Exit.isFailure(yield* Fiber.join(firstReload))).toBeTrue()
      yield* Fiber.join(secondReload)
      expect((yield* second.read()).values).toEqual(["second"])
      failing = false
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
