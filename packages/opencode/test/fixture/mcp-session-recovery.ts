import { Client, LATEST_PROTOCOL_VERSION, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"

const posts: Array<{ method: string; session: string | null }> = []
const concurrent = process.env.MCP_RECOVERY_CONCURRENT === "1"
let initializeCount = 0
let pingCount = 0
let replacementStarted!: () => void
const replacement = new Promise<void>((resolve) => (replacementStarted = resolve))
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
      if (initializeCount === 2) replacementStarted()
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
    if (concurrent && pingCount === 2) await replacement
    if (pingCount <= (concurrent ? 2 : 1)) return new Response("Session not found", { status: 404 })
    return Response.json({ jsonrpc: "2.0", id: message.id, result: {} })
  },
})
const client = new Client({ name: "test", version: "1" })

try {
  await client.connect(new StreamableHTTPClientTransport(server.url))
  if (concurrent) await Promise.all([client.ping(), client.ping()])
  else await client.ping()
  process.stdout.write(JSON.stringify(posts))
} finally {
  await client.close()
  server.stop(true)
}
