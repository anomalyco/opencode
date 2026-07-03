import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { MCP } from "@opencode-ai/core/mcp/index"
import { ExecuteTool } from "@opencode-ai/core/tool/execute"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { testEffect } from "./lib/effect"
import { settleTool, testModel, toolIdentity, toolDefinitions } from "./lib/tool"
import { SessionV2 } from "@opencode-ai/core/session"

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})
const registryLayer = AppNodeBuilder.build(ToolRegistry.node, [[ToolOutputStore.node, outputStore]])
const it = testEffect(registryLayer)

const sessionID = SessionV2.ID.make("ses_execute")

describe("execute tool", () => {
  it.effect("runs MCP tools through CodeMode and returns child call metadata", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const calls: Array<{ server: string; name: string; args: Record<string, unknown> | undefined }> = []
      yield* registry.register({
        execute: ExecuteTool.make(
          [
            new MCP.Tool({
              server: MCP.ServerName.make("context7"),
              name: "resolve-library-id",
              description: "Resolve a library ID",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" }, libraryName: { type: "string" } },
                required: ["query", "libraryName"],
              },
            }),
          ],
          (input) =>
            Effect.sync(() => {
              calls.push({ server: input.server.toString(), name: input.name, args: input.args })
              return new MCP.ToolResult({
                server: MCP.ServerName.make(input.server.toString()),
                tool: input.name,
                isError: false,
                structured: { id: "/reactjs/react.dev" },
                content: [{ type: "text", text: "/reactjs/react.dev" }],
              })
            }),
        ),
      })

      const definition = (yield* toolDefinitions(registry))[0]
      expect(definition.name).toBe("execute")
      expect(definition.description).toContain('tools.context7["resolve-library-id"]')
      expect(definition.description).toContain("Do not infer or normalize tool names")

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

      expect(calls).toEqual([
        {
          server: "context7",
          name: "resolve-library-id",
          args: { query: "react", libraryName: "react" },
        },
      ])
      expect(settlement.result).toEqual({ type: "text", value: '{\n  "id": "/reactjs/react.dev"\n}' })
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
    }),
  )

  it.effect("marks failed programs in structured metadata", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({ execute: ExecuteTool.make([], () => Effect.die("unused")) })
      const settlement = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call_execute_error", name: "execute", input: { code: "return missing.value" } },
      })

      expect(settlement.result.type).toBe("text")
      expect(settlement.output?.structured).toMatchObject({ error: true, toolCalls: [] })
    }),
  )

  it.effect("checks authorization before child MCP calls", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        execute: ExecuteTool.make(
          [
            new MCP.Tool({
              server: MCP.ServerName.make("github"),
              name: "search_issues",
              description: "Search issues",
              inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
            }),
          ],
          () => Effect.die("callTool should not run when authorization fails"),
          () => Effect.fail("denied"),
        ),
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
