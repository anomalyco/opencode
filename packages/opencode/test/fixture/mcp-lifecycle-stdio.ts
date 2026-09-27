import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const pidFile = process.env.MCP_LIFECYCLE_PID_FILE
if (pidFile) await Bun.write(pidFile, String(process.pid))

if (process.argv.includes("--hang")) {
  await new Promise(() => {})
}

// Simulates a subprocess (e.g. a `docker run` wrapper) that keeps running
// after its stdin closes instead of exiting on EOF. Only an explicit SIGTERM
// can stop it, same as a real container process.
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
