import { describe, expect } from "bun:test"
import { State } from "@opencode-ai/core/state"
import { Cause, Deferred, Effect, Exit, Fiber, Scheduler, Scope } from "effect"
import { TestClock } from "effect/testing"
import { it } from "./lib/effect"

function valuesState(
  hooks: Pick<State.Options<{ values: string[] }, { add: (item: string) => void }>, "prepare" | "notify"> = {},
) {
  return State.create({
    initial: () => ({ values: new Array<string>() }),
    draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
    ...hooks,
  })
}

describe("State", () => {
  it.effect("commits a transform atomically when its updater is interrupted", () =>
    Effect.gen(function* () {
      const rebuilding = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let block = true
      const state = valuesState({
        notify: () =>
          block ? Deferred.succeed(rebuilding, undefined).pipe(Effect.andThen(Deferred.await(release))) : Effect.void,
      })
      const scope = yield* Scope.make()
      const fiber = yield* state
        .transform((editor) => editor.add("registered"))
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

  it.effect("makes rebuilt state visible before notifying", () =>
    Effect.gen(function* () {
      const observed: string[][] = []
      const state: ReturnType<typeof valuesState> = valuesState({
        notify: () => Effect.sync(() => observed.push([...state.get().values])),
      })

      yield* state.transform((draft) => draft.add("value"))

      // Update events publish from notify, so consumers reading on the event
      // must observe the rebuilt state, not the previous one.
      expect(observed).toEqual([["value"]])
    }),
  )

  it.effect("runs transforms during every reload", () =>
    Effect.gen(function* () {
      let value = "first"
      const state = valuesState()

      yield* state.transform((editor) => editor.add(value))
      expect(state.get().values).toEqual(["first"])

      value = "second"
      const reload = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(reload)
      expect(state.get().values).toEqual(["second"])
    }),
  )

  it.effect("reads registrations and disposals inside a batch without publishing", () =>
    Effect.gen(function* () {
      const observed: string[][] = []
      let replays = 0
      const state: ReturnType<typeof valuesState> = valuesState({
        notify: () => Effect.sync(() => observed.push([...state.get().values])),
      })
      const scope = yield* Scope.make()

      yield* State.batch(
        Effect.gen(function* () {
          yield* state
            .transform((draft) => {
              replays++
              draft.add("value")
            })
            .pipe(Scope.provide(scope))

          const snapshot = state.get()
          expect(snapshot.values).toEqual(["value"])
          expect(state.get()).toBe(snapshot)
          expect(replays).toBe(1)
          expect(observed).toEqual([])

          yield* Scope.close(scope, Exit.void)
          expect(state.get().values).toEqual([])
          expect(snapshot.values).toEqual(["value"])
          expect(observed).toEqual([])
        }),
      )

      expect(observed).toEqual([[]])
    }),
  )

  it.effect("reads a requested reload without waiting for its notification debounce", () =>
    Effect.gen(function* () {
      let value = "first"
      let replays = 0
      const observed: string[][] = []
      const state: ReturnType<typeof valuesState> = valuesState({
        notify: () => Effect.sync(() => observed.push([...state.get().values])),
      })
      yield* state.transform((draft) => {
        replays++
        draft.add(value)
      })
      const snapshot = state.get()
      observed.length = 0

      value = "second"
      const reload = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("50 millis")

      expect(state.get().values).toEqual(["second"])
      expect(snapshot.values).toEqual(["first"])
      expect(replays).toBe(2)
      expect(observed).toEqual([])

      yield* TestClock.adjust("450 millis")
      yield* Fiber.join(reload)
      expect(observed).toEqual([["second"]])
      expect(replays).toBe(2)
    }),
  )

  it.effect("can await reload inside a batch while deferring its notification", () =>
    Effect.gen(function* () {
      let value = "first"
      let notifications = 0
      const state = valuesState({ notify: () => Effect.sync(() => notifications++) })

      yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((draft) => draft.add(value))
          expect(state.get().values).toEqual(["first"])
          value = "second"
          yield* state.reload()
          expect(state.get().values).toEqual(["second"])
          expect(notifications).toBe(0)
        }),
      )

      expect(notifications).toBe(1)
    }),
  )

  it.effect("prepares derived data during reads without running observers", () =>
    Effect.gen(function* () {
      let notifications = 0
      const state = State.create({
        initial: () => ({ values: [] as string[], joined: "" }),
        draft: (draft) => ({ add: (item: string) => draft.values.push(item) }),
        prepare: (data) => {
          data.joined = data.values.join(",")
        },
        notify: () => Effect.sync(() => notifications++),
      })

      yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((draft) => draft.add("first"))
          yield* state.transform((draft) => draft.add("second"))
          expect(state.get().joined).toBe("first,second")
          expect(notifications).toBe(0)
        }),
      )

      expect(notifications).toBe(1)
    }),
  )

  it.effect("keeps replay failures observable without replacing the previous snapshot", () =>
    Effect.gen(function* () {
      let fail = false
      const state = valuesState({
        prepare: () => {
          if (fail) throw new Error("preparation failed")
        },
      })
      yield* state.transform((draft) => draft.add("first"))
      const snapshot = state.get()

      yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((draft) => draft.add("second"))
          fail = true
          expect(() => state.get()).toThrow("preparation failed")
          expect(() => state.get()).toThrow("preparation failed")
          expect(snapshot.values).toEqual(["first"])
          fail = false
          expect(state.get().values).toEqual(["first", "second"])
        }),
      )
    }),
  )

  it.effect("allows an observer to await a registration on the same state", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      let added = false
      const observed: string[][] = []
      const state: ReturnType<typeof valuesState> = valuesState({
        notify: () =>
          Effect.gen(function* () {
            observed.push([...state.get().values])
            if (added) return
            added = true
            yield* state.transform((draft) => draft.add("second")).pipe(Scope.provide(scope))
          }),
      })

      yield* state.transform((draft) => draft.add("first"))
      expect(observed).toEqual([["first"], ["first", "second"]])
      expect(state.get().values).toEqual(["first", "second"])
    }),
  )

  it.effect("allows a debounced observer to await another reload", () =>
    Effect.gen(function* () {
      let value = "first"
      let reloadAgain = false
      const observed: string[][] = []
      const state: ReturnType<typeof valuesState> = valuesState({
        notify: () =>
          Effect.gen(function* () {
            observed.push([...state.get().values])
            if (!reloadAgain) return
            reloadAgain = false
            value = "third"
            yield* state.reload()
          }),
      })
      yield* state.transform((draft) => draft.add(value))
      observed.length = 0

      value = "second"
      reloadAgain = true
      const reload = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("1 second")
      yield* Fiber.join(reload)

      expect(observed).toEqual([["second"], ["third"]])
      expect(state.get().values).toEqual(["third"])
    }),
  )

  it.effect("keeps reload waiters associated with their own notification results", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let value = "first"
      let block = false
      const observed: string[][] = []
      const state: ReturnType<typeof valuesState> = valuesState({
        notify: () =>
          Effect.gen(function* () {
            observed.push([...state.get().values])
            if (!block) return
            block = false
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            return yield* Effect.die(new Error("first notification failed"))
          }),
      })
      yield* state.transform((draft) => draft.add(value))
      // Release the detached worker before the earlier registration finalizer runs.
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
      observed.length = 0

      value = "second"
      block = true
      const first = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("500 millis")
      yield* Deferred.await(entered)

      value = "third"
      const second = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      expect(state.get().values).toEqual(["third"])
      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(second)
      expect(first.pollUnsafe()).toBeUndefined()
      expect(observed).toEqual([["second"], ["third"]])

      yield* Deferred.succeed(release, undefined)
      const exit = yield* Fiber.await(first)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("first notification failed")
    }),
  )

  it.effect("keeps coalesced reload callers independent of cancellation and shares their notification failure", () =>
    Effect.gen(function* () {
      let fail = false
      let notifications = 0
      const failure = new Error("notification failed")
      const state = State.create({
        initial: () => ({}),
        draft: (draft) => draft,
        notify: () =>
          Effect.sync(() => {
            notifications++
            if (fail) throw failure
          }),
      })
      yield* state.transform(() => {})
      notifications = 0
      fail = true

      const cancelled = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      const first = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      const second = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* Fiber.interrupt(cancelled)
      yield* TestClock.adjust("500 millis")
      const exits = yield* Fiber.awaitAll([first, second])
      fail = false

      expect(Exit.hasInterrupts(yield* Fiber.await(cancelled))).toBe(true)
      expect(exits.map((exit) => Exit.isFailure(exit) && Cause.squash(exit.cause))).toEqual([failure, failure])
      expect(notifications).toBe(1)

      const recovered = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(recovered)
      expect(notifications).toBe(2)
    }),
  )

  it.effect("continues publishing when a reload caller is cancelled while scheduling its worker", () =>
    Effect.gen(function* () {
      let value = "first"
      let notifications = 0
      let interrupted = false
      const state = valuesState({ notify: () => Effect.sync(() => notifications++) })
      yield* state.transform((draft) => draft.add(value))
      notifications = 0

      value = "second"
      const cancelled = yield* Effect.withFiber((fiber) => {
        const base = new Scheduler.MixedScheduler("sync")
        const scheduler: Scheduler.Scheduler = {
          executionMode: base.executionMode,
          // Keep the first scheduled task at the detached worker handoff.
          shouldYield: () => false,
          makeDispatcher: () => {
            const dispatcher = base.makeDispatcher()
            return {
              scheduleTask: (task, priority) => {
                if (!interrupted) {
                  interrupted = true
                  fiber.interruptUnsafe()
                }
                dispatcher.scheduleTask(task, priority)
              },
              flush: () => dispatcher.flush(),
            }
          },
        }
        return state.reload().pipe(Effect.provideService(Scheduler.Scheduler, scheduler))
      }).pipe(Effect.forkChild({ startImmediately: true }))
      const exit = yield* Fiber.await(cancelled)
      expect(interrupted).toBe(true)
      expect(Exit.hasInterrupts(exit)).toBe(true)
      expect(state.get().values).toEqual(["second"])
      yield* TestClock.adjust("500 millis")
      expect(notifications).toBe(1)

      value = "third"
      const reload = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(reload)
      expect(state.get().values).toEqual(["third"])
      expect(notifications).toBe(2)
    }),
  )

  it.effect("disposes a transform once and rebuilds remaining state", () =>
    Effect.gen(function* () {
      const state = valuesState()
      yield* state.transform((editor) => editor.add("first"))
      const registration = yield* state.transform((editor) => editor.add("second"))
      expect(state.get().values).toEqual(["first", "second"])

      yield* registration.dispose
      expect(state.get().values).toEqual(["first"])

      yield* registration.dispose
      expect(state.get().values).toEqual(["first"])
    }),
  )

  it.effect("batches notifications", () =>
    Effect.gen(function* () {
      let notifications = 0
      const first = valuesState({ notify: () => Effect.sync(() => notifications++) })
      const second = valuesState({ notify: () => Effect.sync(() => notifications++) })

      yield* State.batch(
        Effect.gen(function* () {
          yield* first.transform((draft) => draft.add("first"))
          yield* first.transform((draft) => draft.add("second"))
          yield* second.transform((draft) => draft.add("third"))
          expect(notifications).toBe(0)
        }),
      )

      expect(first.get().values).toEqual(["first", "second"])
      expect(second.get().values).toEqual(["third"])
      expect(notifications).toBe(2)
    }),
  )

  it.effect("closes a batched observer's owning scope without losing the body's failure", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const registrations = yield* Scope.make()
      const owner = yield* Scope.make()
      yield* Effect.addFinalizer(() =>
        Deferred.succeed(release, undefined).pipe(
          Effect.andThen(Scope.close(owner, Exit.void)),
          Effect.andThen(State.batch(Scope.close(registrations, Exit.void), { flush: false })),
        ),
      )
      const state = State.create({
        initial: () => ({}),
        draft: (draft) => draft,
        notify: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
      })
      const writer = yield* State.batch(
        state.transform(() => {}).pipe(Scope.provide(registrations), Effect.andThen(Effect.fail("batch body failed"))),
      ).pipe(Effect.forkIn(owner, { startImmediately: true }))
      yield* Deferred.await(entered)

      const shutdown = yield* Scope.close(owner, Exit.void).pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("1 millis")
      expect(shutdown.pollUnsafe()).toBeDefined()
      expect(yield* Deferred.isDone(release)).toBe(false)
      const exit = yield* Fiber.await(writer)
      expect(Exit.hasInterrupts(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("batch body failed")
    }),
  )

  it.effect("lets batch observers read the other states' accepted changes", () =>
    Effect.gen(function* () {
      const observed: string[][] = []
      const first = valuesState({
        notify: () => Effect.sync(() => observed.push([...second.get().values])),
      })
      const second = valuesState()

      yield* State.batch(
        Effect.gen(function* () {
          yield* first.transform((draft) => draft.add("first"))
          yield* second.transform((draft) => draft.add("second"))
        }),
      )

      expect(observed).toEqual([["second"]])
    }),
  )
  ;["replay", "notification"].forEach((failure) =>
    it.effect(`notifies the other states when a batch ${failure} fails`, () =>
      Effect.gen(function* () {
        let fail = true
        const observed: string[] = []
        const first = State.create({
          initial: () => ({}),
          draft: (draft) => draft,
          notify: () => Effect.sync(() => observed.push("first")),
        })
        const failing = State.create({
          initial: () => ({}),
          draft: (draft) => draft,
          prepare: () => {
            if (fail && failure === "replay") throw new Error("replay failed")
          },
          notify: () =>
            fail ? Effect.die(new Error("notification failed")) : Effect.sync(() => observed.push("failing")),
        })
        const last = State.create({
          initial: () => ({}),
          draft: (draft) => draft,
          notify: () => Effect.sync(() => observed.push("last")),
        })

        const exit = yield* State.batch(
          Effect.gen(function* () {
            yield* first.transform(() => {})
            yield* failing.transform(() => {})
            yield* last.transform(() => {})
            return yield* Effect.die(new Error("batch failed"))
          }),
        ).pipe(Effect.exit)
        fail = false

        expect(observed).toEqual(["first", "last"])
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.pretty(exit.cause)).toContain("batch failed")
          expect(Cause.pretty(exit.cause)).toContain(`${failure} failed`)
        }

        const reload = yield* failing.reload().pipe(Effect.forkChild({ startImmediately: true }))
        yield* TestClock.adjust("500 millis")
        yield* Fiber.join(reload)
        expect(observed).toEqual(["first", "last", "failing"])
      }),
    ),
  )

  it.effect("discards teardown rebuilds and pending reloads while still running cleanup", () =>
    Effect.gen(function* () {
      let notifications = 0
      let prepared = 0
      let disposed = 0
      const state = valuesState({
        prepare: () => {
          prepared++
        },
        notify: () => Effect.sync(() => notifications++),
      })
      const scope = yield* Scope.make()
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => disposed++),
      )
      const registration = yield* state.transform((draft) => draft.add("value")).pipe(Scope.provide(scope))
      const snapshot = state.get()
      expect(notifications).toBe(1)
      expect(prepared).toBe(1)

      const pending = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("250 millis")
      yield* State.batch(Scope.close(scope, Exit.void), { flush: false })
      expect(disposed).toBe(1)
      expect(notifications).toBe(1)
      expect(state.get()).toBe(snapshot)
      expect(prepared).toBe(1)

      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(pending)
      yield* registration.dispose
      yield* state.reload()
      expect(notifications).toBe(1)
      expect(state.get()).toBe(snapshot)
      expect(prepared).toBe(1)
    }),
  )

  it.effect("keeps teardown suppression separate from an enclosing live batch", () =>
    Effect.gen(function* () {
      const notifications: string[] = []
      const closing = State.create({
        initial: () => ({}),
        draft: (draft) => draft,
        notify: () => Effect.sync(() => notifications.push("closing")),
      })
      const live = State.create({
        initial: () => ({}),
        draft: (draft) => draft,
        notify: () => Effect.sync(() => notifications.push("live")),
      })
      const scope = yield* Scope.make()
      yield* closing.transform(() => {}).pipe(Scope.provide(scope))
      notifications.length = 0

      yield* State.batch(
        Effect.gen(function* () {
          yield* live.transform(() => {})
          yield* State.batch(Scope.close(scope, Exit.void), { flush: false })
        }),
      )
      expect(notifications).toEqual(["live"])
    }),
  )

  it.effect("debounces reload bursts", () =>
    Effect.gen(function* () {
      let notifications = 0
      const state = valuesState({ notify: () => Effect.sync(() => notifications++) })
      yield* state.transform((draft) => draft.add("value"))
      notifications = 0

      const first = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("250 millis")
      const second = yield* state.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("499 millis")
      expect(notifications).toBe(0)
      yield* TestClock.adjust("1 millis")
      yield* Fiber.join(first)
      yield* Fiber.join(second)

      expect(notifications).toBe(1)
    }),
  )
})
