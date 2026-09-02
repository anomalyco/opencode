import { describe, expect } from "bun:test"
import { State } from "@opencode-ai/core/state"
import { Cause, Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { it } from "./lib/effect"

describe("State", () => {
  it.effect("commits a transform atomically when its updater is interrupted", () =>
    Effect.gen(function* () {
      const rebuilding = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let block = true
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        editor: (editor) => ({ add: (value: string) => editor.values.push(value) }),
        notify: () =>
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

  it.effect("makes current state visible before notifying", () =>
    Effect.gen(function* () {
      const observed: string[][] = []
      const state: State.Interface<{ values: string[] }, { add: (item: string) => void }> = State.create({
        initial: () => ({ values: [] as string[] }),
        editor: (editor) => ({ add: (item: string) => editor.values.push(item) }),
        notify: () => Effect.sync(() => observed.push([...state.get().values])),
      })

      yield* state.transform((editor) => {
        editor.add("value")
      })

      // Update events publish from notify, so consumers reading on the event
      // must observe the rebuilt state, not the previous one.
      expect(observed).toEqual([["value"]])
    }),
  )

  it.effect("runs transforms during every reload", () =>
    Effect.gen(function* () {
      let value = "first"
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        editor: (editor) => ({ add: (item: string) => editor.values.push(item) }),
      })

      yield* state.transform((editor) => {
        editor.add(value)
      })
      expect(state.get().values).toEqual(["first"])

      value = "second"
      yield* state.reload()
      expect(state.get().values).toEqual(["second"])
    }),
  )

  it.effect("disposes a transform once and rebuilds remaining state", () =>
    Effect.gen(function* () {
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        editor: (editor) => ({ add: (item: string) => editor.values.push(item) }),
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

  it.effect("batches notifications across domains", () =>
    Effect.gen(function* () {
      let finalized = 0
      const first = State.create({
        initial: () => ({ values: [] as string[] }),
        editor: (editor) => ({ add: (item: string) => editor.values.push(item) }),
        notify: () => Effect.sync(() => finalized++),
      })
      const second = State.create({
        initial: () => ({ values: [] as string[] }),
        editor: (editor) => ({ add: (item: string) => editor.values.push(item) }),
        notify: () => Effect.sync(() => finalized++),
      })

      yield* State.batch(
        Effect.gen(function* () {
          yield* first.transform((editor) => {
            editor.add("first")
          })
          yield* first.transform((editor) => {
            editor.add("second")
          })
          yield* second.transform((editor) => {
            editor.add("third")
          })
          expect(finalized).toBe(0)
        }),
      )

      expect(first.get().values).toEqual(["first", "second"])
      expect(second.get().values).toEqual(["third"])
      expect(finalized).toBe(2)
    }),
  )

  it.effect("discards reloads and disposals after shutdown while still running cleanup", () =>
    Effect.gen(function* () {
      let finalized = 0
      let disposed = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        editor: (editor) => ({ add: (item: string) => editor.values.push(item) }),
        notify: () => Effect.sync(() => finalized++),
      })
      const scope = yield* Scope.make()
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => disposed++),
      )
      const registration = yield* state.transform((editor) => editor.add("value")).pipe(Scope.provide(scope))
      expect(finalized).toBe(1)

      yield* State.shutdown(Scope.close(scope, Exit.void))
      expect(disposed).toBe(1)
      expect(finalized).toBe(1)

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
        editor: (editor) => editor,
        notify: () => Effect.sync(() => finalized.push("closing")),
      })
      const live = State.create({
        initial: () => ({}),
        editor: (editor) => editor,
        notify: () => Effect.sync(() => finalized.push("live")),
      })
      const scope = yield* Scope.make()
      yield* closing.transform(() => {}).pipe(Scope.provide(scope))
      finalized.length = 0

      yield* State.batch(
        Effect.gen(function* () {
          yield* live.transform(() => {})
          yield* State.shutdown(Scope.close(scope, Exit.void))
        }),
      )
      expect(finalized).toEqual(["live"])
    }),
  )

  it.effect("notifies once per reload without waiting", () =>
    Effect.gen(function* () {
      let finalized = 0
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        editor: (editor) => ({ add: (item: string) => editor.values.push(item) }),
        notify: () => Effect.sync(() => finalized++),
      })
      yield* state.transform((editor) => {
        editor.add("value")
      })
      finalized = 0

      // Under TestClock nothing time-based can complete, so returning proves no debounce is involved.
      yield* state.reload()
      expect(finalized).toBe(1)
      yield* state.reload()
      expect(finalized).toBe(2)
    }),
  )
})

describe("State rebuild", () => {
  it.effect("leaves a retained value untouched when later registrations rebuild", () =>
    Effect.gen(function* () {
      const state = State.create({
        initial: () => ({ values: new Array<string>(), tags: new Map<string, number>() }),
        editor: (data) => data,
      })
      yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((editor) => {
            editor.values.push("first")
            editor.tags.set("first", 1)
          })
          const retained = state.get()
          expect(state.get()).toBe(retained)
          yield* state.transform((editor) => {
            editor.values.push("second")
            editor.tags.set("second", 2)
          })
          const current = state.get()
          expect(current).not.toBe(retained)
          expect(current.values).toEqual(["first", "second"])
          expect(Array.from(current.tags.keys())).toEqual(["first", "second"])
          expect(retained.values).toEqual(["first"])
          expect(Array.from(retained.tags.keys())).toEqual(["first"])
        }),
      )
    }),
  )

  it.effect("recreates the editor with every rebuild", () =>
    Effect.gen(function* () {
      let drafts = 0
      const state = State.create({
        initial: () => ({ values: new Array<number>() }),
        editor: (data) => {
          drafts++
          let sequence = 0
          return { add: () => data.values.push(++sequence) }
        },
      })
      yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((editor) => editor.add())
          expect(state.get().values).toEqual([1])
          expect(drafts).toBe(1)
          yield* state.transform((editor) => editor.add())
          expect(state.get().values).toEqual([1, 2])
          expect(drafts).toBe(2)
          yield* state.reload()
          expect(state.get().values).toEqual([1, 2])
          expect(drafts).toBe(3)
        }),
      )
    }),
  )

  it.effect("rebuilds lazily on read and notifies even without a final read", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      const notifications: string[][] = []
      const state = State.create({
        initial: () => ({ values: new Array<string>() }),
        editor: (data) => data,
        notify: (value) => Effect.sync(() => notifications.push([...value.values])),
      })
      expect(state.get().values).toEqual([])
      yield* State.batch(Effect.void)
      expect(notifications).toEqual([])

      yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((editor) => {
            calls.push("first")
            editor.values.push("first")
          })
          yield* state.transform((editor) => {
            calls.push("second")
            editor.values.push("second")
          })
          expect(calls).toEqual([])
          const view = state.get()
          expect(view.values).toEqual(["first", "second"])
          expect(state.get()).toBe(view)
          expect(calls).toEqual(["first", "second"])
          yield* state.transform((editor) => {
            calls.push("third")
            editor.values.push("third")
          })
          expect(calls).toEqual(["first", "second"])
          expect(state.get()).not.toBe(view)
          expect(state.get().values).toEqual(["first", "second", "third"])
          expect(view.values).toEqual(["first", "second"])
          expect(calls).toEqual(["first", "second", "first", "second", "third"])
          yield* state.transform((editor) => {
            calls.push("fourth")
            editor.values.push("fourth")
          })
          expect(notifications).toEqual([])
        }),
      )
      expect(calls.slice(5)).toEqual(["first", "second", "third", "fourth"])
      expect(notifications).toEqual([["first", "second", "third", "fourth"]])
    }),
  )

  it.effect("replays every callback after each change outside a batch", () =>
    Effect.gen(function* () {
      const calls: number[] = []
      const state = State.create({ initial: () => ({ value: 2 }), editor: (data) => data })
      yield* state.transform((editor) => {
        calls.push(1)
        editor.value += 3
      })
      yield* state.transform((editor) => {
        calls.push(2)
        editor.value *= 4
      })
      // Each registration outside a batch notifies immediately, and notification materializes.
      expect(calls).toEqual([1, 1, 2])
      expect(state.get().value).toBe(20)
      expect(calls).toEqual([1, 1, 2])
      yield* state.transform((editor) => {
        calls.push(3)
        editor.value -= 1
      })
      expect(state.get().value).toBe(19)
      expect(calls).toEqual([1, 1, 2, 1, 2, 3])
    }),
  )
  ;[0, 1, 2].forEach((removed) =>
    it.effect(`rebuilds noncommutative edits after removing position ${removed}`, () =>
      Effect.gen(function* () {
        const calls: number[] = []
        const state = State.create({ initial: () => ({ value: 5 }), editor: (data) => data })
        const registrations = yield* State.batch(
          Effect.all([
            state.transform((editor) => {
              calls.push(0)
              editor.value += 1
            }),
            state.transform((editor) => {
              calls.push(1)
              editor.value *= 3
            }),
            state.transform((editor) => {
              calls.push(2)
              editor.value -= 4
            }),
          ]),
        )
        expect(state.get().value).toBe(14)
        const registration = registrations[removed]
        if (!registration) throw new Error("missing registration")
        calls.length = 0
        yield* registration.dispose
        expect(state.get().value).toBe([11, 2, 18][removed])
        expect(calls).toEqual([0, 1, 2].filter((index) => index !== removed))
        calls.length = 0
        yield* registration.dispose
        expect(calls).toEqual([])
      }),
    ),
  )

  it.effect("keeps equal callback registrations independently disposable", () =>
    Effect.gen(function* () {
      const state = State.create({ initial: () => ({ value: 0 }), editor: (data) => data })
      const callback = (editor: { value: number }) => editor.value++
      const first = yield* state.transform(callback)
      const second = yield* state.transform(callback)
      expect(state.get().value).toBe(2)
      yield* first.dispose
      expect(state.get().value).toBe(1)
      yield* first.dispose
      expect(state.get().value).toBe(1)
      yield* second.dispose
      expect(state.get().value).toBe(0)
    }),
  )

  it.effect("does not evaluate a pending callback removed before the first read", () =>
    Effect.gen(function* () {
      let calls = 0
      const state = State.create({ initial: () => ({ value: 0 }), editor: (data) => data })
      yield* State.batch(
        Effect.gen(function* () {
          const registration = yield* state.transform(() => calls++)
          yield* registration.dispose
          expect(state.get().value).toBe(0)
        }),
      )
      expect(calls).toBe(0)
    }),
  )

  it.effect("invalidates on reload and reads new inputs", () =>
    Effect.gen(function* () {
      let source = 1
      let calls = 0
      let notifications = 0
      const state = State.create({
        initial: () => ({ value: 0 }),
        editor: (data) => data,
        notify: () => Effect.sync(() => notifications++),
      })
      yield* state.transform((editor) => {
        calls++
        editor.value += source
      })
      notifications = 0
      source = 2
      yield* state.reload()
      expect(state.get().value).toBe(2)
      expect(calls).toBe(2)
      expect(notifications).toBe(1)

      yield* State.batch(
        Effect.gen(function* () {
          source = 3
          yield* state.reload()
          expect(state.get().value).toBe(3)
          yield* state.transform((editor) => (editor.value *= 10))
          expect(state.get().value).toBe(30)
          expect(calls).toBe(4)
          expect(notifications).toBe(1)
        }),
      )
      expect(notifications).toBe(2)
    }),
  )

  it.effect("resamples a changing initial value even when there are no transforms", () =>
    Effect.gen(function* () {
      let source = 1
      const state = State.create({ initial: () => ({ value: source }), editor: (data) => data })
      expect(state.get().value).toBe(1)
      // A captured input changed but nothing invalidated the value, so reads stay cached.
      source = 2
      expect(state.get().value).toBe(1)
      yield* State.batch(
        Effect.gen(function* () {
          yield* state.reload()
          expect(state.get().value).toBe(2)
        }),
      )
    }),
  )

  it.effect("keeps the previous value when a rebuild throws and retries on the next read", () =>
    Effect.gen(function* () {
      let fail = true
      let initializations = 0
      const state = State.create({
        initial: () => {
          initializations++
          return { values: new Array<string>() }
        },
        editor: (data) => data,
      })
      yield* state.transform((editor) => editor.values.push("first"))
      const before = state.get()
      expect(initializations).toBe(2)
      yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((editor) => {
            editor.values.push("second")
            if (fail) throw new Error("failed edit")
          })
          expect(() => state.get()).toThrow("failed edit")
          expect(initializations).toBe(3)
          expect(() => state.get()).toThrow("failed edit")
          expect(initializations).toBe(4)
          // The partially edited container is discarded; the last complete value is untouched.
          expect(before.values).toEqual(["first"])
          fail = false
          expect(state.get().values).toEqual(["first", "second"])
          expect(initializations).toBe(5)
          yield* state.transform((editor) => editor.values.push("third"))
          expect(state.get().values).toEqual(["first", "second", "third"])
          expect(initializations).toBe(6)
        }),
      )
    }),
  )

  it.effect("recovers by disposing a failing callback without keeping its partial edits", () =>
    Effect.gen(function* () {
      const state = State.create({ initial: () => ({ value: 2 }), editor: (data) => data })
      yield* state.transform((editor) => (editor.value *= 3))
      yield* State.batch(
        Effect.gen(function* () {
          const failing = yield* state.transform((editor) => {
            editor.value += 100
            throw new Error("bad callback")
          })
          expect(() => state.get()).toThrow("bad callback")
          yield* failing.dispose
          expect(state.get().value).toBe(6)
          yield* state.transform((editor) => (editor.value += 1))
          expect(state.get().value).toBe(7)
        }),
      )
    }),
  )
})

describe("State notification boundaries", () => {
  ;["body", "observer"].forEach((phase) =>
    it.effect(
      `cancels remaining observers when interrupted during the ${phase}, without rolling back registrations`,
      () =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const observed: string[] = []
          let block = true
          const first = State.create({
            initial: () => ({ value: 0 }),
            editor: (data) => data,
            notify: () =>
              Effect.gen(function* () {
                observed.push("first")
                if (phase !== "observer" || !block) return
                yield* Deferred.succeed(entered, undefined)
                yield* Effect.never
              }),
          })
          const second = State.create({
            initial: () => ({ value: 0 }),
            editor: (data) => data,
            notify: () => Effect.sync(() => observed.push("second")),
          })
          const writer = yield* State.batch(
            Effect.gen(function* () {
              yield* first.transform((editor) => editor.value++)
              yield* second.transform((editor) => editor.value++)
              if (phase !== "body") return
              yield* Deferred.succeed(entered, undefined)
              yield* Effect.never
            }),
          ).pipe(Effect.forkChild({ startImmediately: true }))
          yield* Deferred.await(entered)
          yield* Fiber.interrupt(writer)
          block = false
          expect(Exit.hasInterrupts(yield* Fiber.await(writer))).toBe(true)
          expect([first.get().value, second.get().value]).toEqual([1, 1])
          expect(observed).toEqual(phase === "body" ? [] : ["first"])
        }),
    ),
  )

  it.effect("shares nested live batches and does not retain an escaped batch", () =>
    Effect.gen(function* () {
      let notifications = 0
      const state = State.create({
        initial: () => ({ value: 0 }),
        editor: (data) => data,
        notify: () => Effect.sync(() => notifications++),
      })
      const inherit = yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform((editor) => editor.value++)
          yield* State.batch(state.transform((editor) => editor.value++))
          expect(state.get().value).toBe(2)
          expect(notifications).toBe(0)
          return yield* State.inherit()
        }),
      )
      expect(notifications).toBe(1)
      yield* inherit(state.transform((editor) => editor.value++))
      expect(state.get().value).toBe(3)
      expect(notifications).toBe(2)
    }),
  )

  it.effect("lets observers read other pending domains and register more edits", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const observed: number[] = []
      let added = false
      const other = State.create({ initial: () => ({ value: 0 }), editor: (data) => data })
      const state: State.Interface<object, object> = State.create({
        initial: () => ({}),
        editor: (data) => data,
        notify: () =>
          Effect.gen(function* () {
            observed.push(other.get().value)
            if (added) return
            added = true
            yield* state.transform(() => {}).pipe(Scope.provide(scope))
          }),
      })
      yield* State.batch(
        Effect.gen(function* () {
          yield* state.transform(() => {})
          yield* other.transform((editor) => (editor.value = 42))
        }),
      )
      expect(observed).toEqual([42, 42])
    }),
  )

  it.effect("allows an observer to await a nested reload", () =>
    Effect.gen(function* () {
      let source = 1
      let reloadAgain = false
      const observed: number[] = []
      const state: State.Interface<{ value: number }, { value: number }> = State.create({
        initial: () => ({ value: 0 }),
        editor: (data) => data,
        notify: () =>
          Effect.gen(function* () {
            observed.push(state.get().value)
            if (!reloadAgain) return
            reloadAgain = false
            source = 3
            yield* state.reload()
          }),
      })
      yield* state.transform((editor) => (editor.value = source))
      source = 2
      reloadAgain = true
      yield* state.reload()
      expect(observed).toEqual([1, 2, 3])
    }),
  )

  it.effect("attempts every domain notification and preserves both batch and observer failures", () =>
    Effect.gen(function* () {
      const observed: string[] = []
      let fail = true
      const first = State.create({
        initial: () => ({}),
        editor: (data) => data,
        notify: () => (fail ? Effect.die("observer failed") : Effect.void),
      })
      const second = State.create({
        initial: () => ({}),
        editor: (data) => data,
        notify: () => Effect.sync(() => observed.push("second")),
      })
      const exit = yield* State.batch(
        Effect.gen(function* () {
          yield* first.transform(() => {})
          yield* second.transform(() => {})
          return yield* Effect.fail("body failed")
        }),
      ).pipe(Effect.exit)
      fail = false
      expect(observed).toEqual(["second"])
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.pretty(exit.cause)).toContain("observer failed")
        expect(Cause.pretty(exit.cause)).toContain("body failed")
      }
    }),
  )

  it.effect("surfaces a failed reload notification to its caller and recovers on the next reload", () =>
    Effect.gen(function* () {
      let fail = false
      let notifications = 0
      const state = State.create({
        initial: () => ({}),
        editor: (data) => data,
        notify: () =>
          Effect.sync(() => {
            notifications++
            if (fail) throw new Error("notification failed")
          }),
      })
      yield* state.transform(() => {})
      notifications = 0
      fail = true
      expect(Exit.isFailure(yield* state.reload().pipe(Effect.exit))).toBe(true)
      expect(notifications).toBe(1)
      fail = false
      yield* state.reload()
      expect(notifications).toBe(2)
    }),
  )
})
