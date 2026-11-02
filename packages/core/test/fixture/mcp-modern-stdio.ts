import { appendFileSync } from "node:fs"
import { Server } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"

// A stdio server that speaks 2026-07-28, appending its pid to MCP_PID_FILE so a test can count and stop processes.
if (process.env.MCP_PID_FILE) appendFileSync(process.env.MCP_PID_FILE, `${process.pid}\n`)

serveStdio(() => {
  const server = new Server({ name: "modern-stdio", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler("tools/list", () =>
    Promise.resolve({ tools: [{ name: "echo", inputSchema: { type: "object" as const, properties: {} } }] }),
  )
  server.setRequestHandler("tools/call", () => Promise.resolve({ content: [{ type: "text", text: "ok" }] }))
  return server
})
