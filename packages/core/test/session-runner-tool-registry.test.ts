import { describe, expect } from "bun:test"
import { tool, ToolFailure } from "@opencode-ai/llm"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool-registry"
import { Effect, Exit, Schema, Scope } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(ToolRegistry.layer())

const echo = tool({
  description: "Echo text",
  parameters: Schema.Struct({ text: Schema.String }),
  success: Schema.Struct({ text: Schema.String }),
  execute: ({ text }) => Effect.succeed({ text }),
})

describe("ToolRegistry", () => {
  it.effect("rebuilds advertised definitions when a scoped transform closes", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      const transform = yield* registry.transform().pipe(Scope.provide(scope))

      yield* transform((editor) => editor.set("echo", { tool: echo, authorize: () => Effect.void }))
      expect(yield* registry.definitions()).toMatchObject([{ name: "echo", description: "Echo text" }])

      yield* Scope.close(scope, Exit.void)
      expect(yield* registry.definitions()).toEqual([])
    }),
  )

  it.effect("returns an error result for an unknown tool", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID: SessionV2.ID.make("ses_registry_test"),
          call: { type: "tool-call", id: "call-missing", name: "missing", input: {} },
        }),
      ).toEqual({ type: "error", value: "Unknown tool: missing" })
    }),
  )

  it.effect("does not execute a tool when authorization fails", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      let executed = false
      const transform = yield* registry.transform()

      yield* transform((editor) =>
        editor.set("denied", {
          authorize: () => Effect.fail(new ToolFailure({ message: "Denied" })),
          tool: tool({
            description: "Denied tool",
            parameters: Schema.Struct({}),
            success: Schema.Struct({ ok: Schema.Boolean }),
            execute: () =>
              Effect.sync(() => {
                executed = true
                return { ok: true }
              }),
          }),
        }),
      )

      expect(
        yield* registry.execute({
          sessionID: SessionV2.ID.make("ses_registry_test"),
          call: { type: "tool-call", id: "call-denied", name: "denied", input: {} },
        }),
      ).toEqual({ type: "error", value: "Denied" })
      expect(executed).toBe(false)
    }),
  )
})
