import { appendFileSync } from "node:fs"
import { createInterface } from "node:readline"

// A 2026-07-28 stdio server shaped like Python `mcp` 2.x (mcp/server/runner.py): the first request decides the
// connection's era, and `initialize` on one that opened with server/discover is refused with -32022. The
// TypeScript SDK's serveStdio drops the probe and serves legacy instead, so it cannot show this.
// The server starts once MCP_RELEASE_FILE exists, and appends its pid to MCP_PID_FILE before it waits.
if (process.env.MCP_PID_FILE) appendFileSync(process.env.MCP_PID_FILE, `${process.pid}\n`)
const release = process.env.MCP_RELEASE_FILE
while (release && !(await Bun.file(release).exists())) await Bun.sleep(10)

const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + "\n")
// Every 2026-07-28 result carries these; the legacy era has none of them.
const modernFields = { cacheScope: "private", resultType: "complete", ttlMs: 0 }
// Set by server/discover, which then locks the connection to 2026-07-28.
let modern = false

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue
  const message = JSON.parse(line)
  if (message.id === undefined || message.method === undefined) continue
  if (message.method === "server/discover") {
    modern = true
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { ...modernFields, capabilities: { tools: {} }, supportedVersions: ["2026-07-28"] },
    })
  }
  if (message.method === "initialize")
    send({
      jsonrpc: "2.0",
      id: message.id,
      ...(modern
        ? {
            error: {
              code: -32022,
              message: "connection is serving the 2026-07-28 protocol; the initialize handshake is not accepted",
              data: { supported: ["2026-07-28"], requested: message.params.protocolVersion },
            },
          }
        : {
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "era-locked", version: "1.0.0" },
            },
          }),
    })
  if (message.method === "tools/list")
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { tools: [{ name: "echo", inputSchema: { type: "object" } }], ...(modern ? modernFields : {}) },
    })
}
