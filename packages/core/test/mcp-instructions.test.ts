import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { MCP } from "@opencode-ai/core/mcp/index"
import { McpInstructions } from "@opencode-ai/core/mcp/instructions"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { McpTool } from "@opencode-ai/core/tool/mcp"
import { it } from "./lib/effect"
import { readInitial, readUpdate } from "./lib/instructions"

const build = AgentV2.ID.make("build")

const selection = (permissions: PermissionV2.Ruleset = []) => {
  const info = AgentV2.Info.make({ ...AgentV2.Info.empty(build), permissions })
  return { id: info.id, info }
}

const instructions = (server: string, text: string) =>
  new MCP.ServerInstructions({ server: MCP.ServerName.make(server), instructions: text })

const tool = (server: string, name = "search") => new MCP.Tool({ server: MCP.ServerName.make(server), name })

const layer = (catalog: () => MCP.ServerInstructions[], tools: () => MCP.Tool[]) =>
  AppNodeBuilder.build(McpInstructions.node, [
    [
      MCP.node,
      Layer.mock(MCP.Service, {
        instructions: () => Effect.succeed(catalog()),
        tools: () => Effect.succeed(tools()),
      }),
    ],
  ])

describe("McpInstructions", () => {
  it.effect("renders instructions for servers with at least one permitted tool", () =>
    Effect.gen(function* () {
      const service = yield* McpInstructions.Service
      const generation = yield* service
        .load(
          selection([
            { action: McpTool.name("alpha", "restricted"), resource: "*", effect: "deny" },
            { action: McpTool.name("hidden", "search"), resource: "*", effect: "deny" },
          ]),
        )
        .pipe(Effect.flatMap(readInitial))

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
            instructions("alpha", "Alpha line one\nAlpha line two"),
          ],
          () => [tool("alpha"), tool("alpha", "restricted"), tool("beta"), tool("hidden")],
        ),
      ),
    ),
  )

  it.effect("omits instructions when the agent cannot use execute", () =>
    Effect.gen(function* () {
      const service = yield* McpInstructions.Service
      const generation = yield* service
        .load(selection([{ action: "execute", resource: "*", effect: "deny" }]))
        .pipe(Effect.flatMap(readInitial))

      expect(generation.text).toBe("")
    }).pipe(
      Effect.provide(
        layer(
          () => [instructions("alpha", "Alpha instructions")],
          () => [tool("alpha")],
        ),
      ),
    ),
  )

  it.effect("renders additions, changes, and removal", () => {
    let catalog = [instructions("alpha", "Alpha instructions")]
    const tools = [tool("alpha"), tool("beta")]
    return Effect.gen(function* () {
      const service = yield* McpInstructions.Service
      const initialized = yield* service.load(selection()).pipe(Effect.flatMap(readInitial))

      catalog = [instructions("alpha", "Alpha instructions"), instructions("beta", "Beta instructions")]
      const added = yield* readUpdate(yield* service.load(selection()), initialized)
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
      const changed = yield* readUpdate(yield* service.load(selection()), added)
      expect(changed.text).toBe(
        [
          "The available MCP server instructions have changed. This list supersedes the previous one.",
          "<mcp_instructions>",
          '  <server name="alpha">',
          '    Use tools from this server through `execute` under `tools["alpha"]`.',
          "    Updated alpha",
          "  </server>",
          '  <server name="beta">',
          '    Use tools from this server through `execute` under `tools["beta"]`.',
          "    Beta instructions",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )

      catalog = [instructions("beta", "Beta instructions")]
      const removed = yield* readUpdate(yield* service.load(selection()), changed)
      expect(removed.text).toBe("Instructions for the following MCP servers are no longer available: alpha.")

      catalog = []
      expect((yield* readUpdate(yield* service.load(selection()), removed)).text).toBe(
        "MCP server instructions are no longer available.",
      )
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
