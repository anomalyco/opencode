import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { McpInstructions } from "@opencode/core/mcp/instructions"
import type { Permission } from "@opencode/core/permission"
import { PermissionPolicy } from "@opencode/core/permission/policy"
import { AbsolutePath } from "@opencode/core/schema"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { it } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"
import { toolNodeReplacements } from "../lib/tool"

const instructions = (server: string, text: string) =>
  ({ server: Mcp.ServerName.make(server), instructions: text }) satisfies Mcp.ServerInstructions

const schema = { type: "object" as const }
const tool = (server: string, name = "search") =>
  ({ server: Mcp.ServerName.make(server), name, inputSchema: schema }) satisfies Mcp.Tool

const layer = (catalog: () => Mcp.ServerInstructions[], tools: () => Mcp.Tool[]) =>
  AppNodeBuilder.build(LayerNode.group([McpInstructions.node, McpTool.node, Tool.node]), [
    ...toolNodeReplacements(),
    Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
    Mcp.node.replace(
      Layer.mock(Mcp.Service, {
        awaitStartup: () => Effect.void,
        instructions: () => Effect.succeed(catalog()),
        tools: () => Effect.succeed(tools()),
      }),
    ),
  ])

const load = (permissions: Permission.Ruleset = []) =>
  Effect.gen(function* () {
    const mcpTools = yield* McpTool.Service
    const registry = yield* Tool.Service
    const service = yield* McpInstructions.Service
    yield* mcpTools.flush
    return yield* service.load(yield* registry.snapshot(PermissionPolicy.fromRules(permissions)))
  })

describe("McpInstructions", () => {
  it.effect("renders instructions for servers with at least one reachable snapshot tool", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const mcpTools = yield* McpTool.Service
      yield* mcpTools.flush
      yield* registry.transform((editor) => editor.remove(McpTool.name("removed", "search")))

      const generation = yield* load([
        { action: "*", resource: "*", effect: "deny" },
        // Scoped allow keeps alpha_search in the snapshot (not whollyDisabled), while hidden_search stays denied.
        { action: McpTool.name("alpha", "search"), resource: "https://example.com/*", effect: "allow" },
        { action: McpTool.name("beta", "search"), resource: "*", effect: "allow" },
        { action: McpTool.name("removed", "search"), resource: "*", effect: "allow" },
        { action: "execute", resource: "*", effect: "allow" },
      ]).pipe(Effect.flatMap(readInitial))

      expect(generation.text).toBe(
        [
          "<mcp_instructions>",
          '  <server name="alpha">',
          '    Use tools from this server through `execute` under `tools["alpha"]`.',
          "    Alpha line one",
          "    Alpha line two",
          "  </server>",
          '  <server name="beta">',
          '    Use tools from this server through `execute` under `tools["beta"]`.',
          "    Beta instructions",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }).pipe(
      Effect.provide(
        layer(
          () => [
            instructions("beta", "Beta instructions"),
            instructions("unused", "No tools"),
            instructions("hidden", "Denied tool"),
            instructions("removed", "Removed by transform"),
            instructions("alpha", "Alpha line one\nAlpha line two"),
          ],
          () => [tool("alpha"), tool("alpha", "restricted"), tool("beta"), tool("hidden"), tool("removed")],
        ),
      ),
    ),
  )

  it.effect("lists Code Mode servers as direct tools when the snapshot has no Code Mode catalog", () =>
    Effect.gen(function* () {
      const generation = yield* load([{ action: "execute", resource: "*", effect: "deny" }]).pipe(
        Effect.flatMap(readInitial),
      )

      expect(generation.text).toBe(
        [
          "<mcp_instructions>",
          '  <server name="alpha">',
          "    Alpha instructions",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }).pipe(
      Effect.provide(
        layer(
          () => [instructions("alpha", "Alpha instructions")],
          () => [tool("alpha")],
        ),
      ),
    ),
  )

  it.effect("keeps MCP instructions when Code Mode is disabled for the server and execute is denied", () =>
    Effect.gen(function* () {
      const generation = yield* load([{ action: "execute", resource: "*", effect: "deny" }]).pipe(
        Effect.flatMap(readInitial),
      )

      expect(generation.text).toBe(
        [
          "<mcp_instructions>",
          '  <server name="alpha">',
          "    Alpha instructions",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }).pipe(
      Effect.provide(
        layer(
          () => [instructions("alpha", "Alpha instructions")],
          () => [
            {
              server: Mcp.ServerName.make("alpha"),
              name: "search",
              inputSchema: schema,
              codemode: false,
            } satisfies Mcp.Tool,
          ],
        ),
      ),
    ),
  )

  it.effect("replaces a server entry when Code Mode is disabled for it", () => {
    let tools: Mcp.Tool[] = [tool("alpha")]
    return Effect.gen(function* () {
      const initialized = yield* load().pipe(Effect.flatMap(readInitial))

      tools = [{ ...tool("alpha"), codemode: false }]
      const changed = yield* readUpdate(yield* load(), initialized)
      expect(changed.text).toBe(
        [
          "The following MCP server instructions have changed. Each entry replaces the previously listed server with the same name:",
          '  <server name="alpha">',
          "    Alpha instructions",
          "  </server>",
        ].join("\n"),
      )
    }).pipe(
      Effect.provide(
        layer(
          () => [instructions("alpha", "Alpha instructions")],
          () => tools,
        ),
      ),
    )
  })

  it.effect("renders additions, changes, and removal", () => {
    let catalog = [instructions("alpha", "Alpha instructions")]
    const tools = [tool("alpha"), tool("beta")]
    return Effect.gen(function* () {
      const initialized = yield* load().pipe(Effect.flatMap(readInitial))

      catalog = [instructions("alpha", "Alpha instructions"), instructions("beta", "Beta instructions")]
      const added = yield* readUpdate(yield* load(), initialized)
      expect(added.text).toBe(
        [
          "New MCP server instructions are available in addition to those previously listed:",
          '  <server name="beta">',
          '    Use tools from this server through `execute` under `tools["beta"]`.',
          "    Beta instructions",
          "  </server>",
        ].join("\n"),
      )

      catalog = [instructions("alpha", "Updated alpha"), instructions("beta", "Beta instructions")]
      const changed = yield* readUpdate(yield* load(), added)
      expect(changed.text).toBe(
        [
          "The following MCP server instructions have changed. Each entry replaces the previously listed server with the same name:",
          '  <server name="alpha">',
          '    Use tools from this server through `execute` under `tools["alpha"]`.',
          "    Updated alpha",
          "  </server>",
        ].join("\n"),
      )

      catalog = [instructions("beta", "Beta instructions")]
      const removed = yield* readUpdate(yield* load(), changed)
      expect(removed.text).toBe("Instructions for the following MCP servers are no longer available: alpha.")

      catalog = []
      expect((yield* readUpdate(yield* load(), removed)).text).toBe("MCP server instructions are no longer available.")
    }).pipe(
      Effect.provide(
        layer(
          () => catalog,
          () => tools,
        ),
      ),
    )
  })
})
