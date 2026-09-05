import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { once } from "node:events"

if (process.argv.includes("--hang")) {
  const pidFile = process.env.MCP_LIFECYCLE_PID_FILE
  if (!pidFile) throw new Error("MCP_LIFECYCLE_PID_FILE is required")
  await Bun.write(pidFile, String(process.pid))
  await new Promise(() => {})
}

const server = new Server({ name: "mcp-lifecycle-stdio", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, () =>
  Promise.resolve({
    tools: [
      {
        name: "current_directory",
        description: process.cwd(),
        inputSchema: { type: "object", properties: {} },
      },
      ...(process.argv.includes("--stderr-flood")
        ? [
            {
              name: "stderr_flood",
              inputSchema: { type: "object" },
            },
          ]
        : []),
    ],
  }),
)

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "stderr_flood") throw new Error(`Unknown tool: ${request.params.name}`)
  if (!process.stderr.write("x".repeat(1024 * 1024))) await once(process.stderr, "drain")
  return { content: [{ type: "text", text: "ok" }] }
})

await server.connect(new StdioServerTransport())
