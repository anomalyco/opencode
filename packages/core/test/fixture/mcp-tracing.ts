import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

const server = new Server({ name: "trace-echo", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler("tools/call", (request) =>
  Promise.resolve({ content: [{ type: "text", text: JSON.stringify(request.params._meta ?? {}) }] }),
)

await server.connect(new StdioServerTransport())
