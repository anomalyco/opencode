import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { SessionV2 } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})
const it = testEffect(AppNodeBuilder.build(ToolRegistry.node, [[ToolOutputStore.node, outputStore]]))
const sessionID = SessionV2.ID.make("ses_execute")

describe("execute tool", () => {
  it.effect("projects any canonical tool without registering it twice", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register(
        {
          lookup: Tool.make({
            description: "Look up a package",
            input: Schema.Struct({ name: Schema.String }),
            output: Schema.Struct({ id: Schema.String }),
            execute: ({ name }) => Effect.succeed({ id: `pkg:${name}` }),
          }),
        },
        { execute: { lookup: ["packages", "lookup"] } },
      )

      const definitions = yield* toolDefinitions(registry)
      expect(definitions.map((item) => item.name)).toEqual(["execute"])
      expect(definitions[0]?.description).toContain("tools.packages.lookup")

      const settlement = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call_execute",
          name: "execute",
          input: { code: 'return await tools.packages.lookup({ name: "effect" })' },
        },
      })

      expect(settlement.output?.structured).toEqual({
        output: '{\n  "id": "pkg:effect"\n}',
        toolCalls: [{ tool: "packages.lookup", status: "completed", input: { name: "effect" } }],
      })
    }),
  )

  it.effect("omits execute when every projected child is disabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register(
        {
          lookup: Tool.make({
            description: "Look up a package",
            input: Schema.Struct({ name: Schema.String }),
            output: Schema.Struct({ id: Schema.String }),
            execute: ({ name }) => Effect.succeed({ id: name }),
          }),
        },
        { execute: { lookup: ["packages", "lookup"] } },
      )

      expect(yield* toolDefinitions(registry, [{ action: "lookup", resource: "*", effect: "deny" }])).toEqual([])
    }),
  )

  it.effect("rejects a previously materialized direct execute after projection takes over", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        execute: Tool.make({
          description: "Direct execute",
          input: Schema.Struct({}),
          output: Schema.Struct({ direct: Schema.Boolean }),
          execute: () => Effect.succeed({ direct: true }),
        }),
      })
      const materialized = yield* registry.materialize({ model: { id: "claude-test", provider: "anthropic" } })
      yield* registry.register(
        {
          lookup: Tool.make({
            description: "Look up a package",
            input: Schema.Struct({}),
            output: Schema.Struct({}),
            execute: () => Effect.succeed({}),
          }),
        },
        { execute: { lookup: ["packages", "lookup"] } },
      )

      expect(
        yield* materialized.settle({
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call_stale_execute", name: "execute", input: {} },
        }),
      ).toEqual({ result: { type: "error", value: "Stale tool call: execute" } })
    }),
  )
})
