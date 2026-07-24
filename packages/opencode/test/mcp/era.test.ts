import { expect } from "bun:test"
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { MCP } from "../../src/mcp/index"
import { McpCatalog } from "../../src/mcp/catalog"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(MCP.node))

/**
 * A modern (2026-07-28, stateless per-request) MCP server built on the SDK v2
 * serving entry. `legacy` controls whether 2025-era clients are also served.
 */
function modernServer(legacy: "stateless" | "reject") {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const handler = createMcpHandler(
        () => {
          const server = new McpServer({ name: "mcp-era", version: "1.0.0" })
          server.registerTool("echo", { description: "Reply with a fixed payload" }, () => ({
            content: [{ type: "text", text: "pong" }],
          }))
          return server
        },
        { legacy },
      )
      const http = Bun.serve({ port: 0, fetch: (request) => handler.fetch(request) })
      return { url: http.url.toString(), close: () => http.stop(true) }
    }),
    (server) => Effect.sync(server.close),
  )
}

const remote = (url: string) => ({ type: "remote" as const, url, oauth: false as const })

it.instance("negotiates a modern stateless server and calls tools through it", () =>
  Effect.gen(function* () {
    const server = yield* modernServer("reject")
    const mcp = yield* MCP.Service
    yield* mcp.add("modern-server", remote(server.url))

    expect((yield* mcp.status())["modern-server"]?.status).toBe("connected")
    const tools = yield* mcp.tools()
    const entry = tools["modern-server_echo"]
    expect(entry).toBeDefined()
    if (!entry) return
    expect(entry.client.getProtocolEra()).toBe("modern")

    const converted = McpCatalog.convertTool(entry.def, entry.client, entry.timeout)
    const output = yield* Effect.promise(() =>
      Promise.resolve(
        converted.execute?.({}, {
          toolCallId: "call",
          abortSignal: new AbortController().signal,
          messages: [],
        } as never),
      ),
    )
    expect(output).toMatchObject({ content: [{ type: "text", text: "pong" }] })
  }),
)

it.instance("still serves legacy clients from the same modern endpoint", () =>
  Effect.gen(function* () {
    const server = yield* modernServer("stateless")
    const mcp = yield* MCP.Service
    yield* mcp.add("dual-era-server", remote(server.url))

    expect((yield* mcp.status())["dual-era-server"]?.status).toBe("connected")
    expect(Object.keys(yield* mcp.tools())).toEqual(["dual-era-server_echo"])
  }),
)
