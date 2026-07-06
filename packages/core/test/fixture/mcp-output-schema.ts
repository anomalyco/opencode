import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const server = new Server({ name: "output-schema", version: "1.0.0" }, { capabilities: { tools: {} } })

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

await server.connect(new StdioServerTransport())
