import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

const server = new Server(
  { name: "trace-echo", version: "1.0.0" },
  { capabilities: { tools: {}, prompts: {}, resources: {} } },
)

server.setRequestHandler("tools/call", (request) =>
  Promise.resolve({ content: [{ type: "text", text: JSON.stringify(request.params._meta ?? {}) }] }),
)
server.setRequestHandler("prompts/get", (request) =>
  Promise.resolve({
    messages: [{ role: "user", content: { type: "text", text: JSON.stringify(request.params._meta ?? {}) } }],
  }),
)
server.setRequestHandler("resources/read", (request) =>
  Promise.resolve({ contents: [{ uri: request.params.uri, text: JSON.stringify(request.params._meta ?? {}) }] }),
)

await server.connect(new StdioServerTransport())
