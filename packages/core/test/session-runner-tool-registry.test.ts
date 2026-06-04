import { describe, expect } from "bun:test"
import { Tool, ToolFailure } from "@opencode-ai/llm"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool-registry"
import { Effect, Exit, Layer, Schema, Scope } from "effect"
import { testEffect } from "./lib/effect"

const assertions: PermissionV2.AssertInput[] = []
let denyAction: string | undefined
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(
          input.action === denyAction ? Effect.fail(new PermissionV2.DeniedError({ rules: [] })) : Effect.void,
        ),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.layer.pipe(Layer.provide(permission))
const it = testEffect(Layer.mergeAll(permission, registry))

const echo = Tool.make({
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
          tool: Tool.make({
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

  it.effect("binds invocation identity while preserving leaf-owned permission inputs", () =>
    Effect.gen(function* () {
      assertions.length = 0
      denyAction = undefined
      const registry = yield* ToolRegistry.Service
      const transform = yield* registry.transform()
      const sessionID = SessionV2.ID.make("ses_registry_context")

      yield* transform((editor) =>
        editor.set("context", {
          tool: Tool.make({
            description: "Context tool",
            parameters: Schema.Struct({}),
            success: Schema.Struct({ ok: Schema.Boolean }),
          }),
          execute: ({ assertPermission, call, source }) =>
            assertPermission({
              action: "inspect",
              resources: [call.id],
              save: ["*"],
              metadata: { tool: call.name },
            }).pipe(
              Effect.as({ ok: source === undefined }),
              Effect.catch(() => Effect.fail(new ToolFailure({ message: "Denied" }))),
            ),
        }),
      )

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-context", name: "context", input: {} },
        }),
      ).toEqual({ type: "json", value: { ok: true } })
      expect(assertions).toEqual([
        {
          sessionID,
          action: "inspect",
          resources: ["call-context"],
          save: ["*"],
          metadata: { tool: "context" },
        },
      ])
      expect(assertions[0]).not.toHaveProperty("source")
    }),
  )

  it.effect("keeps ordered multi-assert policy flow in the leaf and stops on denial", () =>
    Effect.gen(function* () {
      assertions.length = 0
      denyAction = "execute"
      let executed = false
      const registry = yield* ToolRegistry.Service
      const transform = yield* registry.transform()

      yield* transform((editor) =>
        editor.set("ordered", {
          tool: Tool.make({
            description: "Ordered policy tool",
            parameters: Schema.Struct({}),
            success: Schema.Struct({ ok: Schema.Boolean }),
          }),
          execute: ({ assertPermission }) =>
            Effect.gen(function* () {
              yield* assertPermission({ action: "external_directory", resources: ["/outside/*"] })
              yield* assertPermission({ action: "execute", resources: ["pwd"] })
              executed = true
              return { ok: true }
            }).pipe(Effect.catch(() => Effect.fail(new ToolFailure({ message: "Denied" })))),
        }),
      )

      expect(
        yield* registry.execute({
          sessionID: SessionV2.ID.make("ses_registry_context"),
          call: { type: "tool-call", id: "call-ordered", name: "ordered", input: {} },
        }),
      ).toEqual({ type: "error", value: "Denied" })
      expect(assertions.map((input) => input.action)).toEqual(["external_directory", "execute"])
      expect(executed).toBe(false)
      denyAction = undefined
    }),
  )

  it.effect("settles encoded structured output with canonical projected content", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const transform = yield* registry.transform()

      yield* transform((editor) =>
        editor.set("projected", {
          tool: Tool.make({
            description: "Projected tool",
            parameters: Schema.Struct({ prefix: Schema.String }),
            success: Schema.Struct({ count: Schema.NumberFromString }),
            execute: () => Effect.succeed({ count: 2 }),
            toModelOutput: ({ callID, parameters, output }) => [
              { type: "text", text: `${callID}:${parameters.prefix}:${output.count}` },
            ],
          }),
        }),
      )

      expect(
        yield* registry.settle({
          sessionID: SessionV2.ID.make("ses_registry_test"),
          call: { type: "tool-call", id: "call-projected", name: "projected", input: { prefix: "count" } },
        }),
      ).toEqual({
        result: { type: "text", value: "call-projected:count:2" },
        output: { structured: { count: "2" }, content: [{ type: "text", text: "call-projected:count:2" }] },
      })
    }),
  )
})
