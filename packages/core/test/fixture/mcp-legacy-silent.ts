import { createInterface } from "node:readline"

// A 2025-11-25 stdio server that never answers requests it doesn't know, such as server/discover.
const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + "\n")

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue
  const message = JSON.parse(line)
  if (message.id === undefined || message.method === undefined) continue
  if (message.method === "initialize")
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "legacy-silent", version: "1.0.0" },
      },
    })
  if (message.method === "tools/list")
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } })
}
