import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { MCP } from "@opencode-ai/core/mcp/index"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ExecuteTool } from "@opencode-ai/core/tool/execute"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { testEffect } from "./lib/effect"
import { settleTool, toolIdentity, toolDefinitions } from "./lib/tool"

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})
const registryLayer = AppNodeBuilder.build(ToolRegistry.node, [[ToolOutputStore.node, outputStore]])
const it = testEffect(registryLayer)

const sessionID = SessionV2.ID.make("ses_execute")
const tool = new MCP.Tool({
  server: MCP.ServerName.make("context7"),
  name: "resolve-library-id",
  description: "Resolve a library ID",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" }, libraryName: { type: "string" } },
    required: ["query", "libraryName"],
  },
})

function make(
  items: ReadonlyArray<ExecuteTool.Item>,
  callTool: MCP.Interface["callTool"],
  assert: PermissionV2.Interface["assert"] = () => Effect.void,
) {
  const mcp = MCP.Service.of({
    servers: () => Effect.succeed([]),
    tools: () => Effect.succeed(items.map((item) => item.tool)),
    callTool,
    instructions: () => Effect.succeed([]),
    prompts: () => Effect.succeed([]),
    prompt: () => Effect.succeed(undefined),
    resourceCatalog: () => Effect.succeed(new MCP.ResourceCatalog({ resources: [], templates: [] })),
    readResource: () => Effect.succeed(undefined),
  })
  const permission = PermissionV2.Service.of({
    assert,
    ask: () => Effect.die("unused permission.ask"),
    reply: () => Effect.die("unused permission.reply"),
    get: () => Effect.die("unused permission.get"),
    forSession: () => Effect.die("unused permission.forSession"),
    list: () => Effect.die("unused permission.list"),
  })
  return ExecuteTool.make(items).pipe(
    Effect.provideService(MCP.Service, mcp),
    Effect.provideService(PermissionV2.Service, permission),
  )
}

describe("execute tool", () => {
  it.effect("runs permission-checked MCP tools and returns child call metadata", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const calls: Array<{ server: string; name: string; args: Record<string, unknown> | undefined }> = []
      const assertions: PermissionV2.AssertInput[] = []
      yield* registry.register({
        execute: yield* make(
          [{ action: "mcp:context7:resolve-library-id", tool }],
          (input) =>
            Effect.sync(() => {
              calls.push({ server: input.server.toString(), name: input.name, args: input.args })
              return new MCP.ToolResult({
                server: MCP.ServerName.make(input.server.toString()),
                tool: input.name,
                isError: false,
                structured: { id: "/reactjs/react.dev" },
                content: [
                  { type: "text", text: "/reactjs/react.dev" },
                  { type: "media", data: "aW1hZ2U=", mimeType: "image/png" },
                ],
              })
            }),
          (input) => Effect.sync(() => assertions.push(input)),
        ),
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

      expect(assertions).toEqual([
        {
          sessionID,
          agent: toolIdentity.agent,
          action: "mcp:context7:resolve-library-id",
          resources: ["*"],
          save: ["*"],
          metadata: {
            server: "context7",
            tool: "resolve-library-id",
            arguments: { query: "react", libraryName: "react" },
          },
          source: { type: "tool", messageID: toolIdentity.assistantMessageID, callID: "call_execute" },
        },
      ])
      expect(calls).toEqual([
        {
          server: "context7",
          name: "resolve-library-id",
          args: { query: "react", libraryName: "react" },
        },
      ])
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
      yield* registry.register({ execute: yield* make([], () => Effect.die("unused mcp.callTool")) })
      const settlement = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call_execute_error", name: "execute", input: { code: "return missing.value" } },
      })

      expect(settlement.result.type).toBe("text")
      expect(settlement.output?.structured).toMatchObject({ error: true, toolCalls: [] })
    }),
  )

  it.effect("does not call MCP when child permission is denied", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      let assertions = 0
      yield* registry.register({
        execute: yield* make(
          [
            {
              action: "mcp:github:search_issues",
              tool: new MCP.Tool({
                server: MCP.ServerName.make("github"),
                name: "search_issues",
                description: "Search issues",
                inputSchema: {
                  type: "object",
                  properties: { query: { type: "string" } },
                  required: ["query"],
                },
              }),
            },
          ],
          () => Effect.die("callTool should not run when permission fails"),
          () =>
            Effect.sync(() => assertions++).pipe(
              Effect.andThen(Effect.fail(new PermissionV2.DeniedError({ rules: [] }))),
            ),
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
      expect(assertions).toBe(1)
      expect(settlement.output?.structured).toMatchObject({
        error: true,
        toolCalls: [{ tool: "github.search_issues", status: "error", input: { query: "bug" } }],
      })
    }),
  )
})
