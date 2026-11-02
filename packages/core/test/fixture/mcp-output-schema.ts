import { isInitializeRequest, Server } from "@modelcontextprotocol/server"
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

const transport = new StdioServerTransport()
await server.connect(transport)

// Like servers that refuse to run without a root (https://github.com/anomalyco/opencode/issues/2308).
if (process.env.MCP_REQUIRE_ROOTS) {
  const receive = transport.onmessage
  transport.onmessage = (message) => {
    if (isInitializeRequest(message) && !message.params.capabilities.roots) process.exit(1)
    receive?.(message)
  }
}
