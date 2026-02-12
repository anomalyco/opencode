/**
 * Manual test script for ACP WebSocket endpoint.
 *
 * Usage:
 *   1. Start the server:  bun dev acp-websocket
 *   2. In another terminal:  bun run script/test-acp-websocket.ts
 *
 * Optional:  ACP_WS_URL=ws://host:4096/acp bun run script/test-acp-websocket.ts
 */

const url = process.env.ACP_WS_URL ?? "ws://127.0.0.1:4096/acp"

const ws = new WebSocket(url)

ws.onopen = () => {
  console.log("Connected to", url)
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } }
  ws.send(JSON.stringify(init) + "\n")
  console.log("Sent: initialize")
}

ws.onmessage = (event) => {
  const line = String(event.data).trim()
  if (!line) return
  const msg = JSON.parse(line)
  console.log("Received:", JSON.stringify(msg, null, 2))
  if (msg.id === 1 && msg.result) {
    console.log("\n✓ ACP WebSocket OK – server responded to initialize")
    ws.close()
  }
}

ws.onerror = (e) => {
  console.error("WebSocket error:", e)
}

ws.onclose = () => {
  console.log("Connection closed")
  setImmediate(() => {
    process.exitCode = 0
    process.exit(0)
  })
}
