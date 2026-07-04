import { afterEach, beforeEach, describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { MCP } from "@opencode-ai/core/mcp/index"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { McpTool } from "@opencode-ai/core/tool/mcp"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity, waitForTool } from "./lib/tool"

const previous = process.env.OPENCODE_CODE_MODE
const calls: Array<{ server: string; name: string; args: Record<string, unknown> | undefined }> = []
const assertions: PermissionV2.AssertInput[] = []
let deny = false

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    servers: () => Effect.succeed([]),
    tools: () =>
      Effect.succeed([
        new MCP.Tool({
          server: MCP.ServerName.make("context7"),
          name: "resolve-library-id",
          description: "Resolve a library ID",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        }),
      ]),
    callTool: (input) =>
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
    instructions: () => Effect.succeed([]),
    prompts: () => Effect.succeed([]),
    prompt: () => Effect.succeed(undefined),
    resourceCatalog: () => Effect.succeed(new MCP.ResourceCatalog({ resources: [], templates: [] })),
    readResource: () => Effect.succeed(undefined),
  }),
)

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new PermissionV2.DeniedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused permission.ask"),
    reply: () => Effect.die("unused permission.reply"),
    get: () => Effect.die("unused permission.get"),
    forSession: () => Effect.die("unused permission.forSession"),
    list: () => Effect.die("unused permission.list"),
  }),
)

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, ToolRegistry.node, ToolRegistry.toolsNode, McpTool.node]),
    [
      [MCP.node, mcp],
      [PermissionV2.node, permission],
      [ToolOutputStore.node, outputStore],
    ],
  ),
)
const sessionID = SessionV2.ID.make("ses_mcp_tool")

beforeEach(() => {
  delete process.env.OPENCODE_CODE_MODE
  calls.length = 0
  assertions.length = 0
  deny = false
})

afterEach(() => {
  if (previous === undefined) delete process.env.OPENCODE_CODE_MODE
  else process.env.OPENCODE_CODE_MODE = previous
})

describe("MCP tools", () => {
  it.effect("projects MCP into execute while preserving canonical permission identity", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* waitForTool(registry, "execute")
      const definitions = yield* toolDefinitions(registry)
      expect(definitions.map((item) => item.name)).toEqual(["execute"])
      expect(definitions[0]?.description).toContain('tools.context7["resolve-library-id"]')

      const settlement = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call_mcp",
          name: "execute",
          input: { code: 'return await tools.context7["resolve-library-id"]({ query: "react" })' },
        },
      })

      expect(settlement.output?.structured).toMatchObject({
        output: '{\n  "id": "/reactjs/react.dev"\n}',
        toolCalls: [{ tool: "context7.resolve-library-id", status: "completed" }],
      })
      expect(calls).toEqual([{ server: "context7", name: "resolve-library-id", args: { query: "react" } }])
      expect(assertions[0]).toMatchObject({
        action: "context7_resolve-library-id",
        source: { type: "tool", messageID: toolIdentity.assistantMessageID, callID: "call_mcp/0" },
      })

      expect(
        yield* toolDefinitions(registry, [{ action: "context7_resolve-library-id", resource: "*", effect: "deny" }]),
      ).toEqual([])
    }),
  )

  it.effect("does not let execute bypass a denied MCP child", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* waitForTool(registry, "execute")
      deny = true

      const settlement = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call_denied",
          name: "execute",
          input: { code: 'return await tools.context7["resolve-library-id"]({ query: "react" })' },
        },
      })

      expect(calls).toEqual([])
      expect(settlement.output?.structured).toMatchObject({
        error: true,
        toolCalls: [{ tool: "context7.resolve-library-id", status: "error" }],
      })
    }),
  )

  describe("with CodeMode disabled", () => {
    beforeEach(() => {
      process.env.OPENCODE_CODE_MODE = "false"
    })

    it.effect("keeps the same canonical MCP tool and permission action", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        yield* waitForTool(registry, "context7_resolve-library-id")
        expect((yield* toolDefinitions(registry)).map((item) => item.name)).toEqual(["context7_resolve-library-id"])

        yield* settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call_direct",
            name: "context7_resolve-library-id",
            input: { query: "react" },
          },
        })

        expect(assertions[0]).toMatchObject({
          action: "context7_resolve-library-id",
          source: { callID: "call_direct" },
        })
      }),
    )
  })
})
