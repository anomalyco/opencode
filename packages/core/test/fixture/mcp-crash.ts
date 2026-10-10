import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

const server = new Server({ name: "crash", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler("tools/list", () => {
  // Drop the connection shortly after the handshake settles so a test can observe a runtime close.
  setTimeout(() => process.exit(1), 500)
  return Promise.resolve({
    tools: [{ name: "hello", description: "Greets", inputSchema: { type: "object", properties: {} } }],
  })
})

await server.connect(new StdioServerTransport())
