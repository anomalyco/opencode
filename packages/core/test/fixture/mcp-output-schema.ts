import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

const server = new Server({ name: "output-schema", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler("tools/list", ({ params }) =>
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
