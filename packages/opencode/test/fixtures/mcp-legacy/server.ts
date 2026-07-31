#!/usr/bin/env bun
// fork(mcp-dual-era-client D1): a deliberately hand-rolled, pre-2026-07-28
// MCP server. It speaks the plain `initialize` handshake and nothing else —
// crucially, it has no `server/discover` handler at all, so an `auto`-mode
// v2 client's probe gets a real "Method not found" and must fall back to
// the legacy handshake. Hand-rolled rather than built on
// @modelcontextprotocol/server (which is itself v2 and would understand
// server/discover), so this fixture proves the client's *fallback* path
// against a server that genuinely cannot speak the modern era, not one that
// merely chooses not to.

const encoder = new TextEncoder()

function respond(id: unknown, result: unknown) {
  process.stdout.write(encoder.encode(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"))
}

function respondError(id: unknown, code: number, message: string) {
  process.stdout.write(encoder.encode(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n"))
}

const TOOLS = [
  {
    name: "echo",
    description: "Echoes the given message back",
    inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
  },
]

async function handleLine(line: string) {
  if (!line.trim()) return
  let msg: { jsonrpc: string; id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.id === undefined) {
    // Notification — no response, regardless of method.
    return
  }

  switch (msg.method) {
    case "initialize":
      respond(msg.id, {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "mcp-legacy-fixture", version: "1.0.0" },
      })
      return
    case "tools/list":
      respond(msg.id, { tools: TOOLS })
      return
    case "tools/call": {
      const args = (msg.params?.arguments ?? {}) as { message?: string }
      respond(msg.id, { content: [{ type: "text", text: args.message ?? "" }] })
      return
    }
    default:
      // Includes server/discover — this server has never heard of it.
      respondError(msg.id, -32601, `Method not found: ${msg.method}`)
      return
  }
}

let buffer = ""
process.stdin.on("data", (chunk: Buffer) => {
  buffer += chunk.toString("utf8")
  let newlineIndex: number
  while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newlineIndex)
    buffer = buffer.slice(newlineIndex + 1)
    void handleLine(line)
  }
})

process.stdin.on("end", () => process.exit(0))
