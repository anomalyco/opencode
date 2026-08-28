import { describe, expect } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { PluginInvoke } from "@opencode-ai/core/plugin/invoke"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(PluginInvoke.node))

describe("PluginInvoke", () => {
  it.effect("registers two plugins, invokes one, lists, duplicate loses, dispose removes", () =>
    Effect.gen(function* () {
      const invoke = yield* PluginInvoke.Service
      const registration = yield* invoke.register("plugin-a", "sum", (input) =>
        Effect.succeed((input as readonly number[]).reduce((acc, n) => acc + n, 0)),
      )
      yield* invoke.register("plugin-b", "echo", (input) => Effect.succeed(input))

      expect(yield* invoke.invoke("plugin-a", "sum", [1, 2, 3])).toBe(6)
      expect(yield* invoke.invoke("plugin-b", "echo", "hi")).toBe("hi")
      expect(invoke.list()).toContainEqual({ id: "plugin-a", invokes: ["sum"] })
      expect(invoke.list()).toContainEqual({ id: "plugin-b", invokes: ["echo"] })

      // first registration wins on duplicate (pluginID, name)
      yield* invoke.register("plugin-a", "sum", () => Effect.succeed(99))
      expect(yield* invoke.invoke("plugin-a", "sum", [1, 1])).toBe(2)

      expect(yield* invoke.invoke("plugin-missing", "sum", null).pipe(Effect.flip)).toBeInstanceOf(
        PluginInvoke.UnknownPluginError,
      )
      expect(yield* invoke.invoke("plugin-a", "missing", null).pipe(Effect.flip)).toBeInstanceOf(
        PluginInvoke.UnknownInvokeError,
      )

      yield* registration.dispose
      expect(invoke.list().some((entry) => entry.id === "plugin-a")).toBe(false)
      expect(yield* invoke.invoke("plugin-a", "sum", [1]).pipe(Effect.flip)).toBeInstanceOf(
        PluginInvoke.UnknownPluginError,
      )
    }),
  )

  it.effect("closing the owning scope removes registrations", () =>
    Effect.gen(function* () {
      const invoke = yield* PluginInvoke.Service
      const scope = yield* Scope.make()
      yield* invoke.register("plugin-c", "echo", (input) => Effect.succeed(input)).pipe(Scope.provide(scope))
      expect(invoke.list().some((entry) => entry.id === "plugin-c")).toBe(true)
      yield* Scope.close(scope, Exit.void)
      expect(invoke.list().some((entry) => entry.id === "plugin-c")).toBe(false)
    }),
  )
})
