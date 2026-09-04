import { describe, expect } from "bun:test"
import { Effect, Scope } from "effect"
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
          yield* policy.transform((editor) => editor.add(["node_modules"]))
          expect(policy.current()).toEqual(["node_modules"])
          const overlay = yield* policy.transform((editor) => editor.add([".git"]))
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
          yield* policy.transform((editor) => editor.add([".git"])).pipe(Scope.provide(scope))
          expect(policy.current()).toEqual(["node_modules", ".git"])
        }),
      )
      yield* policy.observe((ignore) =>
        Effect.sync(() => {
          expect(policy.current()).toEqual(ignore)
          observed.push([...ignore])
        }),
      )

      yield* policy.transform((editor) => editor.add(["node_modules"]))

      expect(policy.current()).toEqual(["node_modules", ".git"])
      expect(observed).toEqual([
        ["node_modules", ".git"],
        ["node_modules", ".git"],
      ])
    }),
  )
})
