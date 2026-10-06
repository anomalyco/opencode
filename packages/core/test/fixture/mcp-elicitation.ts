import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

const server = new Server({ name: "elicitation", version: "1.0.0" }, { capabilities: { tools: {} } })
server.setRequestHandler("tools/list", () => ({
  tools: [{ name: "confirm", inputSchema: { type: "object", properties: {} } }],
}))
server.setRequestHandler("tools/call", async (request) => {
  const result = await server.elicitInput({
    mode: "form",
    message: String(request.params.arguments?.label),
    requestedSchema: {
      type: "object",
      properties: { confirmed: { type: "boolean" } },
      required: ["confirmed"],
    },
  })
  return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result }
})
await server.connect(new StdioServerTransport())
