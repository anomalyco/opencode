import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Mcp } from "@opencode/core/mcp/index"
import { McpInstructions } from "@opencode/core/mcp/instructions"
import { McpTool } from "@opencode/core/tool/mcp"
import { it } from "./lib/effect"
import { readInitial, readUpdate } from "./lib/instructions"

const instructions = (server: string, text: string) =>
  ({ server: Mcp.ServerName.make(server), instructions: text }) satisfies Mcp.ServerInstructions

const schema = { type: "object" as const }
const tool = (server: string, name = "search") =>
  ({ server: Mcp.ServerName.make(server), name, inputSchema: schema }) satisfies Mcp.Tool

const view = (instructions: Mcp.ServerInstructions[], tools: Mcp.Tool[]) => ({ instructions, tools, owned: [] })

describe("McpInstructions", () => {
  it.effect("renders instructions for servers with at least one permitted tool", () =>
    Effect.gen(function* () {
      const service = yield* McpInstructions.Service
      const generation = yield* service
        .load(
          [
            { action: McpTool.name("alpha", "restricted"), resource: "*", effect: "deny" },
            { action: McpTool.name("hidden", "search"), resource: "*", effect: "deny" },
          ],
          view(
            [
              instructions("beta", "Beta instructions"),
              instructions("unused", "No tools"),
              instructions("hidden", "Denied tool"),
              instructions("alpha", "Alpha line one\nAlpha line two"),
            ],
            [tool("alpha"), tool("alpha", "restricted"), tool("beta"), tool("hidden")],
          ),
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
    }).pipe(Effect.provide(McpInstructions.layer)),
  )

  it.effect("omits instructions when the agent cannot use execute", () =>
    Effect.gen(function* () {
      const service = yield* McpInstructions.Service
      const generation = yield* service
        .load(
          [{ action: "execute", resource: "*", effect: "deny" }],
          view([instructions("alpha", "Alpha instructions")], [tool("alpha")]),
        )
        .pipe(Effect.flatMap(readInitial))

      expect(generation.text).toBe("")
    }).pipe(Effect.provide(McpInstructions.layer)),
  )

  it.effect("keeps MCP instructions when Code Mode is disabled and execute is denied", () =>
    Effect.gen(function* () {
      const service = yield* McpInstructions.Service
      const generation = yield* service
        .load(
          [{ action: "execute", resource: "*", effect: "deny" }],
          view([instructions("alpha", "Alpha instructions")], [{ ...tool("alpha"), codemode: false }]),
        )
        .pipe(Effect.flatMap(readInitial))

      expect(generation.text).toBe(
        [
          "<mcp_instructions>",
          '  <server name="alpha">',
          "    Alpha instructions",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }).pipe(Effect.provide(McpInstructions.layer)),
  )

  it.effect("restates guidance when Code Mode is disabled for a server", () =>
    Effect.gen(function* () {
      const service = yield* McpInstructions.Service
      const catalog = [instructions("alpha", "Alpha instructions")]
      const initialized = yield* service.load([], view(catalog, [tool("alpha")])).pipe(Effect.flatMap(readInitial))

      const changed = yield* readUpdate(
        yield* service.load([], view(catalog, [{ ...tool("alpha"), codemode: false }])),
        initialized,
      )
      expect(changed.text).toBe(
        [
          "The available MCP server instructions have changed. This list supersedes the previous one.",
          "<mcp_instructions>",
          '  <server name="alpha">',
          "    Alpha instructions",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }).pipe(Effect.provide(McpInstructions.layer)),
  )

  it.effect("renders additions, changes, and removal", () =>
    Effect.gen(function* () {
      const service = yield* McpInstructions.Service
      const tools = [tool("alpha"), tool("beta")]
      const load = (catalog: Mcp.ServerInstructions[]) => service.load([], view(catalog, tools))
      const initialized = yield* load([instructions("alpha", "Alpha instructions")]).pipe(Effect.flatMap(readInitial))

      const added = yield* readUpdate(
        yield* load([instructions("alpha", "Alpha instructions"), instructions("beta", "Beta instructions")]),
        initialized,
      )
      expect(added.text).toBe(
        [
          "New MCP server instructions are available in addition to those previously listed:",
          '  <server name="beta">',
          '    Use tools from this server through `execute` under `tools["beta"]`.',
          "    Beta instructions",
          "  </server>",
        ].join("\n"),
      )

      const changed = yield* readUpdate(
        yield* load([instructions("alpha", "Updated alpha"), instructions("beta", "Beta instructions")]),
        added,
      )
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

      const removed = yield* readUpdate(yield* load([instructions("beta", "Beta instructions")]), changed)
      expect(removed.text).toBe("Instructions for the following MCP servers are no longer available: alpha.")

      expect((yield* readUpdate(yield* load([]), removed)).text).toBe(
        "MCP server instructions are no longer available.",
      )
    }).pipe(Effect.provide(McpInstructions.layer)),
  )
})
