import { describe, expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { MCP, makeMcpFetch, McpCallContext } from "../../src/mcp/index"

const it = testEffect(LayerNode.compile(MCP.node))

const serve = Effect.acquireRelease(
  Effect.promise(async () => {
    const requests: Headers[] = []
    const protocol = new Server({ name: "wiring", version: "1.0.0" }, { capabilities: { tools: {} } })
    protocol.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools: [] }))
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
    })
    await protocol.connect(transport)
    const http = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(new Headers(request.headers))
        return transport.handleRequest(request)
      },
    })
    return {
      requests,
      url: http.url.toString(),
      close: async () => {
        await http.stop(true)
        await protocol.close()
      },
    }
  }),
  (server) => Effect.promise(server.close),
)

describe("mcp transport fetch wiring", () => {
  // Connecting a remote server exercises the transport's fetch option end to end.
  // If makeMcpFetch were not wired in (or broke the request), the connection would
  // fail or the configured headers would never reach the server.
  it.instance("remote transports connect through the fetch wrapper and forward headers", () =>
    Effect.gen(function* () {
      const server = yield* serve
      const mcp = yield* MCP.Service
      const result = yield* mcp.add("wiring-server", {
        type: "remote",
        url: server.url,
        headers: { Authorization: "Bearer wired" },
      })

      expect(result.status).toMatchObject({ "wiring-server": { status: "connected" } })
      expect(server.requests.length).toBeGreaterThan(0)
      for (const headers of server.requests) {
        expect(headers.get("authorization")).toBe("Bearer wired")
      }
    }),
  )

  it.instance("makeMcpFetch is the context-aware fetch wrapper used by the transports", () =>
    Effect.gen(function* () {
      expect(typeof makeMcpFetch).toBe("function")

      const calls: Array<RequestInit | undefined> = []
      const base = async (_url: string | URL, init?: RequestInit) => {
        calls.push(init)
        return new Response("ok")
      }
      const wrapped = makeMcpFetch(base as never)

      // Without an active call context the wrapper must pass through untouched.
      yield* Effect.promise(() => wrapped("https://example.com/", { headers: { "x-static": "preset" } }))
      // Inside a call context it merges the session headers on top of the static ones.
      yield* Effect.promise(() =>
        McpCallContext.run(
          { server: "wiring", tool: "t", sessionID: "s", callID: "c", headers: { "x-session": "yes" } },
          () => wrapped("https://example.com/", { headers: { "x-static": "preset" } }),
        ),
      )

      expect(calls.length).toBe(2)
      expect(calls[0]?.headers).toEqual({ "x-static": "preset" })
      expect(calls[1]?.headers).toEqual({ "x-static": "preset", "x-session": "yes" })
    }),
  )
})
