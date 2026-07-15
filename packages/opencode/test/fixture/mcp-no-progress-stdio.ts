import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const server = new Server({ name: "mcp-no-progress", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, () =>
  Promise.resolve({
    tools: [
      {
        name: "opaque_lookup",
        description: "Look up a value.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ],
  }),
)

server.setRequestHandler(CallToolRequestSchema, (request) => {
  const query = request.params.arguments?.query
  return Promise.resolve({
    content: [
      {
        type: "text" as const,
        text: query === "break" ? "PROGRESS" : "NO_PROGRESS",
      },
    ],
  })
})

await server.connect(new StdioServerTransport())
