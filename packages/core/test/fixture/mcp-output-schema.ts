import { isInitializeRequest, Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { appendFileSync } from "node:fs"

const server = new Server({ name: "output-schema", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler("tools/list", ({ params }) => {
  // Like servers that only need a root once asked for their tools.
  if (process.env.MCP_REQUIRE_ROOTS_TO_LIST && !server.getClientCapabilities()?.roots)
    return Promise.reject(new Error("a root is required to list tools"))
  return Promise.resolve(
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
  )
})

const transport = new StdioServerTransport()
await server.connect(transport)

// Appends the method of every message the server receives, so a test can count requests across processes.
if (process.env.MCP_WIRE_LOG) {
  const log = process.env.MCP_WIRE_LOG
  const receive = transport.onmessage
  transport.onmessage = (message) => {
    appendFileSync(log, `${"method" in message ? message.method : "response"}\n`)
    receive?.(message)
  }
}

// Like servers that refuse to run without a root (https://github.com/anomalyco/opencode/issues/2308).
if (process.env.MCP_REQUIRE_ROOTS) {
  const receive = transport.onmessage
  transport.onmessage = (message) => {
    if (isInitializeRequest(message) && !message.params.capabilities.roots) process.exit(1)
    receive?.(message)
  }
}
