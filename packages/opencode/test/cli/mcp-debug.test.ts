import { describe, expect } from "bun:test"
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

describe("opencode mcp debug", () => {
  cliIt.live(
    "negotiates a modern-only MCP server through the runtime client path",
    ({ opencode }) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const handler = createMcpHandler(
            () => {
              const mcp = new McpServer({ name: "debug-modern", version: "1.0.0" })
              mcp.registerTool("echo", { description: "echo" }, () => ({
                content: [{ type: "text", text: "pong" }],
              }))
              return mcp
            },
            { legacy: "reject" },
          )
          const server = Bun.serve({ port: 0, fetch: (request) => handler.fetch(request) })
          return server
        }),
        (server) =>
          Effect.gen(function* () {
            const result = yield* opencode.spawn(
              ["mcp", "debug", "modern"],
              {
                timeoutMs: 60_000,
                env: {
                  OPENCODE_CONFIG_CONTENT: JSON.stringify({
                    mcp: {
                      modern: {
                        type: "remote",
                        url: server.url.toString(),
                      },
                    },
                  }),
                },
              },
            )

            opencode.expectExit(result, 0)
            expect(`${result.stdout}\n${result.stderr}`).toContain(
              "Connected using MCP 2026-07-28 (modern)",
            )
          }),
        (server) => Effect.sync(() => server.stop(true)),
      ),
    90_000,
  )
})
