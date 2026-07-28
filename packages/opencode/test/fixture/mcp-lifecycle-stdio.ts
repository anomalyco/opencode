import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

if (process.argv.includes("--hang")) {
  const pidFile = process.env.MCP_LIFECYCLE_PID_FILE
  if (!pidFile) throw new Error("MCP_LIFECYCLE_PID_FILE is required")
  await Bun.write(pidFile, String(process.pid))
  await new Promise(() => {})
}

const server = new Server({ name: "mcp-lifecycle-stdio", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler("tools/list", () =>
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
