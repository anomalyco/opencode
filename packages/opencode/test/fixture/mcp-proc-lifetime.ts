import { open } from "node:fs/promises"

const { Server } = await import("@modelcontextprotocol/sdk/server/index.js")
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js")

const file = process.env.PROCLIFETIME_PID_FILE
if (file) {
  const handle = await open(file, "a")
  await handle.write(`${process.pid}\n`)
  await handle.close()
}

const server = new Server({ name: "mcp-proc-lifetime", version: "1.0.0" }, { capabilities: {} })
await server.connect(new StdioServerTransport())