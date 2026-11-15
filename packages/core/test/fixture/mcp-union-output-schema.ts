import { createInterface } from "node:readline"

// Speaks JSON-RPC directly: the server SDK would wrap a non-object outputSchema before a legacy client sees it.
const tools = [
  {
    name: "union",
    inputSchema: { type: "object" },
    outputSchema: {
      $defs: {
        callers: { type: "object", properties: { callers: { type: "array" } }, required: ["callers"] },
        fallback: { type: "object", properties: { kind: { type: "string" } }, required: ["kind"] },
      },
      anyOf: [{ $ref: "#/$defs/callers" }, { $ref: "#/$defs/fallback" }],
    },
  },
]

const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + "\n")

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line)
  if (message.id === undefined) continue
  if (message.method === "initialize")
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "union-output-schema", version: "1.0.0" },
      },
    })
  else if (message.method === "tools/list") send({ jsonrpc: "2.0", id: message.id, result: { tools } })
  else if (message.method === "tools/call")
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: '{"kind":"struct"}' }], structuredContent: { kind: "struct" } },
    })
  else send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } })
}
