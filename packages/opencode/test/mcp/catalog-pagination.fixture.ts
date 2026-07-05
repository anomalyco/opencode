import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpCatalog } from "@/mcp/catalog"
import { Effect } from "effect"

const server = new Server({ name: "pagination", version: "1.0.0" }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, ({ params }) =>
  Promise.resolve(
    params?.cursor === "page-2"
      ? {
          tools: [
            {
              name: "second",
              inputSchema: { type: "object" },
              outputSchema: {
                type: "object",
                properties: { value: { type: "number" } },
                required: ["value"],
              },
            },
          ],
        }
      : {
          tools: [
            {
              name: "first",
              inputSchema: { type: "object" },
              outputSchema: {
                type: "object",
                properties: { value: { type: "string" } },
                required: ["value"],
              },
            },
          ],
          nextCursor: "page-2",
        },
  ),
)
server.setRequestHandler(CallToolRequestSchema, ({ params }) =>
  Promise.resolve({
    content: [],
    structuredContent: { value: params.name === "first" ? 42 : 1 },
  }),
)

const client = new Client({ name: "pagination-test", version: "1.0.0" })
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

try {
  const tools = await Effect.runPromise(McpCatalog.defs(client))
  if (tools?.map((tool) => tool.name).join(",") !== "first,second") throw new Error("Missing paginated tools")

  await client.callTool({ name: "first", arguments: {} })
  throw new Error("Expected invalid structured output to be rejected")
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Structured content does not match the tool's output schema")) {
    throw error
  }
} finally {
  await Promise.all([client.close(), server.close()])
}
