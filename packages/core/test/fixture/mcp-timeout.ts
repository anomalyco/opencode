import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

const server = new Server(
  { name: "timeout", version: "1.0.0" },
  { capabilities: { prompts: {}, resources: {}, tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (process.env.MCP_TIMEOUT_TARGET === "catalog") await Bun.sleep(100)
  return { tools: [{ name: "slow", inputSchema: { type: "object" } }] }
})
server.setRequestHandler(ListPromptsRequestSchema, () => Promise.resolve({ prompts: [{ name: "slow" }] }))
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  if (process.env.MCP_TIMEOUT_TARGET === "resource-catalog") await Bun.sleep(100)
  return { resources: [{ name: "slow", uri: "test://slow" }] }
})
server.setRequestHandler(ListResourceTemplatesRequestSchema, () => Promise.resolve({ resourceTemplates: [] }))
server.setRequestHandler(CallToolRequestSchema, async () => {
  await Bun.sleep(100)
  return { content: [] }
})
server.setRequestHandler(GetPromptRequestSchema, async () => {
  await Bun.sleep(100)
  return { messages: [] }
})
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  await Bun.sleep(100)
  return { contents: [{ uri: request.params.uri, text: "slow" }] }
})

await server.connect(new StdioServerTransport())
