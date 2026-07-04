import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { SessionV2 } from "@opencode-ai/core/session"
import { ExecuteTool } from "@opencode-ai/core/tool/execute"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})
const it = testEffect(AppNodeBuilder.build(ToolRegistry.node, [[ToolOutputStore.node, outputStore]]))
const sessionID = SessionV2.ID.make("ses_execute")

describe("execute tool", () => {
  it.effect("runs registered tools and returns child metadata and attachments", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        execute: ExecuteTool.make({
          context7: {
            "resolve-library-id": Tool.make({
              description: "Resolve a library ID",
              input: Schema.Struct({ query: Schema.String, libraryName: Schema.String }),
              output: Schema.Struct({ id: Schema.String }),
              execute: () => Effect.succeed({ id: "/reactjs/react.dev" }),
              toModelOutput: ({ output }) => [
                { type: "text", text: output.id },
                { type: "file", data: "aW1hZ2U=", mime: "image/png" },
              ],
            }),
          },
        }),
      })

      const definition = (yield* toolDefinitions(registry))[0]
      expect(definition.name).toBe("execute")
      expect(definition.description).toContain('tools.context7["resolve-library-id"]')
      expect(definition.description).toContain("Do not infer or normalize tool names")
      expect(definition.outputSchema).toBeDefined()

      const settlement = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call_execute",
          name: "execute",
          input: {
            code: 'return await tools.context7["resolve-library-id"]({ query: "react", libraryName: "react" })',
          },
        },
      })

      expect(settlement.output?.structured).toEqual({
        output: '{\n  "id": "/reactjs/react.dev"\n}',
        toolCalls: [
          {
            tool: "context7.resolve-library-id",
            status: "completed",
            input: { query: "react", libraryName: "react" },
          },
        ],
      })
      expect(settlement.output?.content).toEqual([
        { type: "text", text: '{\n  "id": "/reactjs/react.dev"\n}' },
        { type: "file", uri: "data:image/png;base64,aW1hZ2U=", mime: "image/png" },
      ])
    }),
  )

  it.effect("marks failed programs in structured metadata", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({ execute: ExecuteTool.make({}) })
      const settlement = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call_execute_error", name: "execute", input: { code: "return missing.value" } },
      })

      expect(settlement.result.type).toBe("text")
      expect(settlement.output?.structured).toMatchObject({ error: true, toolCalls: [] })
    }),
  )

  it.effect("reports child tool failures", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        execute: ExecuteTool.make({
          github: {
            search_issues: Tool.make({
              description: "Search issues",
              input: Schema.Struct({ query: Schema.String }),
              output: Schema.Struct({}),
              execute: () => Effect.fail(new Tool.Failure({ message: "Permission denied" })),
            }),
          },
        }),
      })

      const settlement = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call_execute_denied",
          name: "execute",
          input: { code: 'return await tools.github.search_issues({ query: "bug" })' },
        },
      })

      expect(settlement.result.type).toBe("text")
      expect(settlement.output?.structured).toMatchObject({
        error: true,
        toolCalls: [{ tool: "github.search_issues", status: "error", input: { query: "bug" } }],
      })
    }),
  )
})
