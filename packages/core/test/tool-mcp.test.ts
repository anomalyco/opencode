import { afterEach, beforeEach, describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Database } from "@opencode-ai/core/database/database"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { MCP } from "@opencode-ai/core/mcp/index"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { McpTool } from "@opencode-ai/core/tool/mcp"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { testEffect } from "./lib/effect"
import { registerToolPlugin, settleTool, toolDefinitions, toolIdentity, waitForTool } from "./lib/tool"

const previous = process.env.OPENCODE_CODE_MODE
const calls: Array<{ server: string; name: string; args: Record<string, unknown> | undefined }> = []
const assertions: PermissionV2.AssertInput[] = []
let catalog: MCP.Tool[] = []
let deny = false

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    servers: () => Effect.succeed([]),
    tools: () => Effect.sync(() => catalog),
    callTool: (input) =>
      Effect.sync(() => {
        calls.push({ server: input.server.toString(), name: input.name, args: input.args })
        return new MCP.ToolResult({
          server: MCP.ServerName.make(input.server.toString()),
          tool: input.name,
          isError: false,
          structured: { ok: true },
          content: [{ type: "text", text: "ok" }],
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

const pluginNode = makeLocationNode({
  name: "test/mcp-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(McpTool.Plugin)),
  deps: [ToolRegistry.toolsNode, MCP.node, EventV2.node, PermissionV2.node],
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, ToolRegistry.node, ToolRegistry.toolsNode, pluginNode]),
    [
      [MCP.node, mcp],
      [PermissionV2.node, permission],
      [ToolOutputStore.node, outputStore],
    ],
  ),
)

const sessionID = SessionV2.ID.make("ses_mcp_tool")

function item(server: string, name: string) {
  return new MCP.Tool({
    server: MCP.ServerName.make(server),
    name,
    description: `${server} ${name}`,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  })
}

function waitForDefinition(
  registry: ToolRegistry.Interface,
  predicate: (definitions: ToolRegistry.Materialization["definitions"]) => boolean,
  remaining = 1000,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    if (predicate(yield* toolDefinitions(registry))) return
    if (remaining === 0) {
      yield* Effect.fail(new Error("Timed out waiting for MCP tool definitions"))
      return
    }
    yield* Effect.promise(() => Bun.sleep(1))
    yield* waitForDefinition(registry, predicate, remaining - 1)
  })
}

beforeEach(() => {
  delete process.env.OPENCODE_CODE_MODE
  calls.length = 0
  assertions.length = 0
  deny = false
  catalog = [item("context7", "resolve-library-id")]
})

afterEach(() => {
  if (previous === undefined) delete process.env.OPENCODE_CODE_MODE
  else process.env.OPENCODE_CODE_MODE = previous
})

describe("MCP tool plugin", () => {
  it.effect("registers execute by default and replaces its catalog on MCP changes", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const events = yield* EventV2.Service
      yield* registry.execute.register({
        user: {
          custom: Tool.make({
            description: "User tool",
            input: Schema.Struct({}),
            output: Schema.Struct({ ok: Schema.Boolean }),
            execute: () => Effect.succeed({ ok: true }),
          }),
        },
      })
      yield* waitForTool(registry, "execute")

      const initial = yield* toolDefinitions(registry)
      expect(initial.map((definition) => definition.name)).toEqual(["execute"])
      expect(initial[0].description).toContain('tools.context7["resolve-library-id"]')
      expect(initial[0].description).toContain("tools.user.custom")

      catalog = [item("github", "search_issues")]
      yield* events.publish(McpEvent.ToolsChanged, { server: MCP.ServerName.make("github") })
      yield* waitForDefinition(
        registry,
        (definitions) => definitions[0]?.description.includes("tools.github.search_issues") ?? false,
      )

      const refreshed = yield* toolDefinitions(registry)
      expect(refreshed.map((definition) => definition.name)).toEqual(["execute"])
      expect(refreshed[0].description).not.toContain("resolve-library-id")
      expect(refreshed[0].description).toContain("tools.user.custom")
    }),
  )

  describe("with CodeMode-unsafe MCP names", () => {
    beforeEach(() => {
      catalog = [item("$codemode", "foo.bar")]
    })

    it.effect("advertises safe aliases while preserving raw call identity", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        yield* waitForTool(registry, "execute")
        const definition = (yield* toolDefinitions(registry))[0]
        expect(definition.description).toContain("tools._codemode.foo_bar")

        const settlement = yield* settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call_mcp_aliased",
            name: "execute",
            input: { code: 'return await tools._codemode.foo_bar({ query: "react" })' },
          },
        })

        expect(calls).toEqual([{ server: "$codemode", name: "foo.bar", args: { query: "react" } }])
        expect(assertions[0]?.action).toBe("mcp:$codemode:foo.bar")
        expect(settlement.output?.structured).toMatchObject({
          toolCalls: [{ tool: "_codemode.foo_bar", status: "completed", input: { query: "react" } }],
        })
      }),
    )
  })

  describe("with code mode disabled", () => {
    beforeEach(() => {
      process.env.OPENCODE_CODE_MODE = "false"
    })

    it.effect("preserves direct MCP tools and authorizes before calling them", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const events = yield* EventV2.Service
        yield* waitForTool(registry, "context7_resolve-library-id")
        expect((yield* toolDefinitions(registry)).map((definition) => definition.name)).toEqual([
          "context7_resolve-library-id",
        ])

        deny = true
        const denied = yield* settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call_mcp_denied",
            name: "context7_resolve-library-id",
            input: { query: "react" },
          },
        })
        expect(denied.result).toMatchObject({ type: "error", value: expect.stringContaining("Permission denied") })
        expect(calls).toEqual([])
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
              arguments: { query: "react" },
            },
            source: { type: "tool", messageID: toolIdentity.assistantMessageID, callID: "call_mcp_denied" },
          },
        ])

        deny = false
        const allowed = yield* settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call_mcp_allowed",
            name: "context7_resolve-library-id",
            input: { query: "react" },
          },
        })
        expect(allowed.result).toEqual({ type: "text", value: "ok" })
        expect(calls).toEqual([{ server: "context7", name: "resolve-library-id", args: { query: "react" } }])

        catalog = [item("github", "search_issues")]
        yield* events.publish(McpEvent.ToolsChanged, { server: MCP.ServerName.make("github") })
        yield* waitForTool(registry, "github_search_issues")
        expect((yield* toolDefinitions(registry)).map((definition) => definition.name)).toEqual([
          "github_search_issues",
        ])
      }),
    )
  })
})
