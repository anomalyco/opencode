import { describe, expect } from "bun:test"
import { Effect, Fiber, Scope } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LocationWatcherPolicy } from "@opencode-ai/core/filesystem/location-watcher-policy"
import { State } from "@opencode-ai/core/state"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LocationWatcherPolicy.node))

describe("LocationWatcherPolicy", () => {
  it.effect("reads batched registrations and disposals without notifying observers", () =>
    Effect.gen(function* () {
      const policy = yield* LocationWatcherPolicy.Service
      const observed: string[][] = []
      yield* policy.observe((ignore) =>
        Effect.sync(() => {
          observed.push([...ignore])
        }),
      )

      yield* State.batch(
        Effect.gen(function* () {
          yield* policy.transform((draft) => draft.add(["base"]))
          const overlay = yield* policy.transform((draft) => draft.add(["overlay"]))
          const snapshot = policy.current()
          expect(snapshot).toEqual(["base", "overlay"])
          expect(observed).toEqual([])

          yield* overlay.dispose
          expect(policy.current()).toEqual(["base"])
          expect(snapshot).toEqual(["base", "overlay"])
          expect(observed).toEqual([])
        }),
      )

      expect(observed).toEqual([["base"]])
    }),
  )

  it.effect("reads reloaded patterns before debounced observer reconciliation", () =>
    Effect.gen(function* () {
      const policy = yield* LocationWatcherPolicy.Service
      const observed: string[][] = []
      let ignore = ["first"]
      yield* policy.observe((ignore) =>
        Effect.sync(() => {
          observed.push([...ignore])
        }),
      )
      yield* policy.transform((draft) => draft.add(ignore))
      const snapshot = policy.current()
      observed.length = 0

      ignore = ["second"]
      const reload = yield* policy.reload().pipe(Effect.forkChild({ startImmediately: true }))
      expect(policy.current()).toEqual(["second"])
      expect(snapshot).toEqual(["first"])
      expect(observed).toEqual([])

      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(reload)
      expect(observed).toEqual([["second"]])
    }),
  )

  it.effect("passes the latest policy to later observers after a reentrant registration", () =>
    Effect.gen(function* () {
      const policy = yield* LocationWatcherPolicy.Service
      const scope = yield* Scope.Scope
      const observed: string[][] = []
      let reentered = false
      yield* policy.observe(() =>
        Effect.gen(function* () {
          if (reentered) return
          reentered = true
          yield* policy.transform((draft) => draft.add(["inner"])).pipe(Scope.provide(scope))
        }),
      )
      yield* policy.observe((ignore) =>
        Effect.sync(() => {
          observed.push([...ignore])
        }),
      )

      yield* policy.transform((draft) => draft.add(["outer"]))

      expect(policy.current()).toEqual(["outer", "inner"])
      expect(observed).toEqual([
        ["outer", "inner"],
        ["outer", "inner"],
      ])
    }),
  )

  it.effect("allows an observer to await a reload and keeps later observers current", () =>
    Effect.gen(function* () {
      const policy = yield* LocationWatcherPolicy.Service
      const observed: string[][] = []
      let ignore = ["first"]
      let reentered = false
      yield* policy.observe(() =>
        Effect.gen(function* () {
          if (reentered) return
          reentered = true
          ignore = ["second"]
          yield* policy.reload()
        }),
      )
      yield* policy.observe((ignore) =>
        Effect.sync(() => {
          observed.push([...ignore])
        }),
      )

      const writer = yield* policy
        .transform((draft) => draft.add(ignore))
        .pipe(Effect.forkChild({ startImmediately: true }))
      expect(policy.current()).toEqual(["second"])
      expect(observed).toEqual([])

      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(writer)
      expect(observed).toEqual([["second"], ["second"]])
    }),
  )
})
