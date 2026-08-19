import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { spawn } from "node:child_process"

const lifecycleDir = process.env.MCP_LIFECYCLE_DIR
const subprocesses: ReturnType<typeof spawn>[] = []

async function waitFor(name: string) {
  if (!lifecycleDir) throw new Error("MCP_LIFECYCLE_DIR is required")
  while (!(await Bun.file(`${lifecycleDir}/${name}`).exists())) await Bun.sleep(10)
}

if (process.argv.includes("--tree")) {
  if (!lifecycleDir) throw new Error("MCP_LIFECYCLE_DIR is required")
  await Bun.write(`${lifecycleDir}/parent.pid`, String(process.pid))
  const node = Bun.which("node")
  if (!node) throw new Error("node is required for the MCP lifecycle fixture")
  const subprocess = spawn(node, [`${import.meta.dir}/mcp-lifecycle-child.mjs`, "--child"], {
    env: process.env,
    stdio: ["ignore", "ignore", "inherit"],
  })
  subprocesses.push(subprocess)
  await waitFor("grandchild.pid")
}

if (process.argv.includes("--hang")) {
  const pidFile = process.env.MCP_LIFECYCLE_PID_FILE
  if (!pidFile) throw new Error("MCP_LIFECYCLE_PID_FILE is required")
  await Bun.write(pidFile, String(process.pid))
  await new Promise(() => {})
}

const server = new Server({ name: "mcp-lifecycle-stdio", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, () => {
  if (process.argv.includes("--list-error")) throw new Error("list tools failed")
  return Promise.resolve({
    tools: [
      {
        name: "current_directory",
        description: process.cwd(),
        inputSchema: { type: "object", properties: {} },
      },
    ],
  })
})

await server.connect(new StdioServerTransport())
