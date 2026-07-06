import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

const server = new Server({ name: "timeout", version: "1.0.0" }, { capabilities: { prompts: {}, tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (process.env.MCP_TIMEOUT_TARGET === "catalog") await Bun.sleep(100)
  return { tools: [{ name: "slow", inputSchema: { type: "object" } }] }
})
server.setRequestHandler(ListPromptsRequestSchema, () => Promise.resolve({ prompts: [{ name: "slow" }] }))
server.setRequestHandler(CallToolRequestSchema, async () => {
  await Bun.sleep(100)
  return { content: [] }
})
server.setRequestHandler(GetPromptRequestSchema, async () => {
  await Bun.sleep(100)
  return { messages: [] }
})

await server.connect(new StdioServerTransport())
