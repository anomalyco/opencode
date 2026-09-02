import { describe, expect } from "bun:test"
import { Effect, Fiber, Scope } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LocationWatcherPolicy } from "@opencode-ai/core/filesystem/location-watcher-policy"
import { State } from "@opencode-ai/core/state"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LocationWatcherPolicy.node))

describe("LocationWatcherPolicy", () => {
  it.effect("reads batched registrations and disposals before notifying observers", () =>
    Effect.gen(function* () {
      const policy = yield* LocationWatcherPolicy.Service
      const observed: string[][] = []
      yield* policy.observe((ignore) =>
        Effect.sync(() => {
          expect(policy.current()).toEqual(ignore)
          observed.push([...ignore])
        }),
      )

      yield* State.batch(
        Effect.gen(function* () {
          yield* policy.transform((draft) => draft.add(["node_modules"]))
          expect(policy.current()).toEqual(["node_modules"])
          const overlay = yield* policy.transform((draft) => draft.add([".git"]))
          expect(policy.current()).toEqual(["node_modules", ".git"])
          expect(observed).toEqual([])

          yield* overlay.dispose
          expect(policy.current()).toEqual(["node_modules"])
          expect(observed).toEqual([])
        }),
      )

      expect(observed).toEqual([["node_modules"]])
    }),
  )

  it.effect("reads reloaded patterns before debounced observer reconciliation", () =>
    Effect.gen(function* () {
      const policy = yield* LocationWatcherPolicy.Service
      const observed: string[][] = []
      const config = { ignore: [".git"] }
      yield* policy.observe((ignore) =>
        Effect.sync(() => {
          observed.push([...ignore])
        }),
      )
      yield* policy.transform((draft) => draft.add(config.ignore))
      expect(policy.current()).toEqual([".git"])
      observed.length = 0

      config.ignore = [".hg"]
      const reload = yield* policy.reload().pipe(Effect.forkChild({ startImmediately: true }))
      expect(policy.current()).toEqual([".hg"])
      expect(observed).toEqual([])

      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(reload)
      expect(observed).toEqual([[".hg"]])
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
          yield* policy.transform((draft) => draft.add([".git"])).pipe(Scope.provide(scope))
          expect(policy.current()).toEqual(["node_modules", ".git"])
        }),
      )
      yield* policy.observe((ignore) =>
        Effect.sync(() => {
          expect(policy.current()).toEqual(ignore)
          observed.push([...ignore])
        }),
      )

      yield* policy.transform((draft) => draft.add(["node_modules"]))

      expect(policy.current()).toEqual(["node_modules", ".git"])
      expect(observed).toEqual([
        ["node_modules", ".git"],
        ["node_modules", ".git"],
      ])
    }),
  )

  it.effect("lets an observer await a reload and keeps later observers current", () =>
    Effect.gen(function* () {
      const policy = yield* LocationWatcherPolicy.Service
      const observed: string[][] = []
      const config = { ignore: [".git"] }
      let reentered = false
      yield* policy.observe(() =>
        Effect.gen(function* () {
          if (reentered) return
          reentered = true
          config.ignore = [".hg"]
          yield* policy.reload()
        }),
      )
      yield* policy.observe((ignore) =>
        Effect.sync(() => {
          expect(policy.current()).toEqual(ignore)
          observed.push([...ignore])
        }),
      )

      const writer = yield* policy
        .transform((draft) => draft.add(config.ignore))
        .pipe(Effect.forkChild({ startImmediately: true }))
      expect(policy.current()).toEqual([".hg"])
      expect(observed).toEqual([])

      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(writer)
      expect(observed).toEqual([[".hg"], [".hg"]])
    }),
  )
})
