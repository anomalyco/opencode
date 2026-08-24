#!/usr/bin/env bun
// fork(mcp-dual-era-client D1): a real @modelcontextprotocol/server v2
// instance, served via serveStdio — the entry point that actually owns the
// era decision for the connection. A bare `new Server() + new
// StdioServerTransport() + connect()` (tried first) does NOT answer
// server/discover — confirmed empirically (`Method not found`); the modern
// probe/legacy-fallback contract lives in serveStdio's per-connection
// factory model, not automatically on Server/Protocol. This is exactly the
// "dual-era" server this fixture exists to exercise: the same factory
// serves a modern server/discover probe and a legacy plain `initialize`.

import { Server } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"

function makeServer() {
  const server = new Server({ name: "mcp-dual-era-fixture", version: "1.0.0" }, { capabilities: { tools: {} } })

  server.setRequestHandler("tools/list", async () => ({
    tools: [
      {
        name: "echo",
        description: "Echoes the given message back",
        inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
      },
    ],
  }))

  server.setRequestHandler("tools/call", async (request) => {
    const args = (request.params.arguments ?? {}) as { message?: string }
    return { content: [{ type: "text", text: args.message ?? "" }] }
  })

  return server
}

serveStdio(makeServer)
