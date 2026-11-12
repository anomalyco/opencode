import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Effect, Exit, Scope } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("Promise plugins run a returned cleanup function on teardown", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const scope = yield* Scope.make()
    let cleaned = false
    yield* PluginPromise.fromPromise({
      id: "cleanup",
      setup: () => () => void (cleaned = true),
    })
      .effect(yield* PluginHost.make(plugins, "test"))
      .pipe(Scope.provide(scope))
    yield* Scope.close(scope, Exit.void)
    expect(cleaned).toBe(true)
  }),
)

it.live("Promise plugins ignore a non-function setup result on teardown", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const scope = yield* Scope.make()
    yield* PluginPromise.fromPromise({
      id: "hooks-object",
      // v1-style plugins return a hooks object; the type forbids it, but JavaScript plugins are not checked.
      setup: async () => ({}) as never,
    })
      .effect(yield* PluginHost.make(plugins, "test"))
      .pipe(Scope.provide(scope))
    expect(Exit.isSuccess(yield* Scope.close(scope, Exit.void).pipe(Effect.exit))).toBe(true)
  }),
)
