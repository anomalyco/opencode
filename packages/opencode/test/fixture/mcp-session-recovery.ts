import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js"

const mode = process.argv[2] ?? "404"
const posts: Array<{ method: string; session: string | null }> = []
let initializeCount = 0
let pingCount = 0
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (request.method === "GET") return new Response(null, { status: 405 })
    if (request.method === "DELETE") return new Response(null, { status: 200 })

    const message = (await request.json()) as { id?: number; method: string }
    const session = request.headers.get("mcp-session-id")
    posts.push({ method: message.method, session })

    if (message.method === "initialize") {
      initializeCount++
      return Response.json(
        {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "test", version: "1" },
          },
        },
        { headers: { "mcp-session-id": initializeCount === 1 ? "expired" : "replacement" } },
      )
    }

    if (message.method === "notifications/initialized") return new Response(null, { status: 202 })

    pingCount++
    if (pingCount === 1) {
      if (mode === "400-text") return new Response("Bad Request: No valid session ID provided", { status: 400 })
      if (mode === "400-json") {
        return Response.json(
          { jsonrpc: "2.0", id: "server-error", error: { code: -32600, message: "Bad Request: Missing session ID" } },
          { status: 400 },
        )
      }
      if (mode === "400-other") return new Response("Bad Request: invalid tool arguments", { status: 400 })
      return new Response("Session not found", { status: 404 })
    }
    return Response.json({ jsonrpc: "2.0", id: message.id, result: {} })
  },
})
const client = new Client({ name: "test", version: "1" })

try {
  await client.connect(new StreamableHTTPClientTransport(server.url))
  await client.ping()
  process.stdout.write(JSON.stringify({ ok: true, posts }))
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), posts }))
} finally {
  await client.close()
  server.stop(true)
}
