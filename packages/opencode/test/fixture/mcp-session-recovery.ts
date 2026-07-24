import { Client, LATEST_PROTOCOL_VERSION, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { McpCatalog } from "../../src/mcp/catalog"

const posts: Array<{ method: string; session: string | null }> = []
let initializeCount = 0
let callCount = 0
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
            capabilities: { tools: {} },
            serverInfo: { name: "test", version: "1" },
          },
        },
        { headers: { "mcp-session-id": initializeCount === 1 ? "expired" : "replacement" } },
      )
    }

    if (message.method === "notifications/initialized") return new Response(null, { status: 202 })

    if (message.method === "tools/list") {
      return Response.json({
        jsonrpc: "2.0",
        id: message.id,
        result: { tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] },
      })
    }

    callCount++
    if (callCount === 1) return new Response("Session not found", { status: 404 })
    return Response.json({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: "ok" }] },
    })
  },
})

async function connect() {
  const client = new Client({ name: "test", version: "1" })
  await client.connect(new StreamableHTTPClientTransport(server.url))
  return client
}

let client = await connect()
try {
  const { tools } = await client.listTools()
  const def = tools.at(0)
  if (!def) throw new Error("server returned no tools")
  const tool = McpCatalog.convertTool(def, client, undefined, async () => {
    await client.close().catch(() => {})
    client = await connect()
    return client
  })
  const result = (await tool.execute?.(
    {},
    { toolCallId: "call", abortSignal: new AbortController().signal, messages: [] },
  )) as { isError?: boolean } | undefined
  if (!result || result.isError) throw new Error("tool call did not recover")
  process.stdout.write(JSON.stringify(posts))
} finally {
  await client.close()
  server.stop(true)
}
