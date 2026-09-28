import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

const server = new Server({ name: "permission-fixture", version: "1.0.0" }, { capabilities: { tools: {} } })
server.setRequestHandler("tools/list", async () => ({
  tools: [{ name: "echo", description: "Local echo", inputSchema: { type: "object", properties: {} } }],
}))
server.setRequestHandler("tools/call", async () => ({ content: [{ type: "text", text: "echo completed" }] }))
await server.connect(new StdioServerTransport())
