import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const pidFile = process.env.MCP_LIFECYCLE_PID_FILE
if (pidFile) await Bun.write(pidFile, String(process.pid))

if (process.argv.includes("--hang")) {
  await new Promise(() => {})
}

// Ignores stdin EOF, like a `docker run` child. Only SIGTERM stops it.
if (process.argv.includes("--keep-alive")) {
  setInterval(() => {}, 1000)
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
    ],
  }),
)

await server.connect(new StdioServerTransport())
