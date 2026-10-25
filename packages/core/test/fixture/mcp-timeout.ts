import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

const server = new Server(
  { name: "timeout", version: "1.0.0" },
  { capabilities: { prompts: {}, resources: {}, tools: {} } },
)

server.setRequestHandler("tools/list", async () => {
  if (process.env.MCP_TIMEOUT_TARGET === "catalog") await Bun.sleep(100)
  return { tools: [{ name: "slow", inputSchema: { type: "object" } }] }
})
server.setRequestHandler("prompts/list", () => Promise.resolve({ prompts: [{ name: "slow" }] }))
server.setRequestHandler("resources/list", async () => {
  if (process.env.MCP_TIMEOUT_TARGET === "resource-catalog") await Bun.sleep(100)
  return { resources: [{ name: "slow", uri: "test://slow" }] }
})
server.setRequestHandler("resources/templates/list", () => Promise.resolve({ resourceTemplates: [] }))
server.setRequestHandler("tools/call", async () => {
  await Bun.sleep(100)
  return { content: [] }
})
server.setRequestHandler("prompts/get", async () => {
  await Bun.sleep(100)
  return { messages: [] }
})
server.setRequestHandler("resources/read", async (request) => {
  await Bun.sleep(100)
  return { contents: [{ uri: request.params.uri, text: "slow" }] }
})

await server.connect(new StdioServerTransport())
