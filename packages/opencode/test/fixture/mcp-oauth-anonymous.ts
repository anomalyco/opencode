import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"
import { MCP } from "../../src/mcp/index"
import { withTmpdirInstance } from "./fixture"

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request): Promise<Response> {
    if (request.method !== "POST") return new Response(null, { status: 405 })

    const message = (await request.json()) as { id?: number; method: string }
    if (message.method === "initialize") {
      return Response.json({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "anonymous-oauth-test", version: "1" },
        },
      })
    }
    if (message.method === "notifications/initialized") return new Response(null, { status: 202 })
    if (message.method === "tools/list") {
      return Response.json({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [{ name: "protected", inputSchema: { type: "object", properties: {} } }],
        },
      })
    }
    if (message.method === "tools/call") {
      return new Response("Authentication required", {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource", request.url)}"`,
        },
      })
    }
    return Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } })
  },
})

try {
  const result = await Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const added = yield* mcp.add("anonymous-oauth", { type: "remote", url: server.url.toString() })
    const initialTools = Object.keys(yield* mcp.tools())
    const client = (yield* mcp.clients())["anonymous-oauth"]
    const protectedToolFailed = yield* Effect.promise(() =>
      client
        .callTool({ name: "protected", arguments: {} })
        .then(() => false)
        .catch(() => true),
    )
    const auth = yield* mcp.authenticate("anonymous-oauth")

    return {
      initialStatus: "status" in added.status ? added.status.status : added.status["anonymous-oauth"]?.status,
      initialTools,
      protectedToolFailed,
      authStatus: auth.status,
      authError: auth.status === "failed" ? auth.error : undefined,
      hasStoredTokens: yield* mcp.hasStoredTokens("anonymous-oauth"),
      finalStatus: (yield* mcp.status())["anonymous-oauth"]?.status,
      finalTools: Object.keys(yield* mcp.tools()),
    }
  }).pipe(
    withTmpdirInstance({
      config: { mcp: { "anonymous-oauth": { type: "remote", url: server.url.toString() } } },
    }),
    Effect.provide(MCP.defaultLayer),
    Effect.scoped,
    Effect.runPromise,
  )
  process.stdout.write(`MCP_OAUTH_RESULT=${JSON.stringify(result)}`)
} finally {
  server.stop(true)
}
