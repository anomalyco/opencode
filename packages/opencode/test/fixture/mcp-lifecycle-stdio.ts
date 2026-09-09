import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const pidFile = process.env.MCP_LIFECYCLE_PID_FILE
if (pidFile) await Bun.write(pidFile, String(process.pid))

const childPidFile = process.env.MCP_LIFECYCLE_CHILD_PID_FILE
if (childPidFile) {
  const child = Bun.spawn([process.execPath, "-e", "await new Promise(() => {})"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  await Bun.write(childPidFile, String(child.pid))
}

if (process.argv.includes("--hang")) {
  if (!pidFile) throw new Error("MCP_LIFECYCLE_PID_FILE is required")
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
    ],
  }),
)

await server.connect(new StdioServerTransport())
