import { appendFile } from "node:fs/promises"
import { createInterface } from "node:readline"
import { Schema } from "effect"

const mode = process.argv[2]
const log = process.argv[3]
const decodeRequest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
      method: Schema.String,
      params: Schema.optional(Schema.Struct({ cursor: Schema.optional(Schema.String) })),
    }),
  ),
)

for await (const line of createInterface({ input: process.stdin })) {
  const request = decodeRequest(line)
  if (log) await appendFile(log, JSON.stringify(request) + "\n")
  if (request.id === undefined) continue

  const result = (() => {
    if (request.method === "initialize")
      return {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "mcp-tools-fixture", version: "1.0.0" },
        capabilities: { tools: {} },
      }
    if (request.method === "tools/list") {
      if (mode === "empty") return { tools: [] }
      if (request.params?.cursor === "page-2")
        return {
          tools: [
            {
              name: "search.docs",
              description: "  Search\n  documentation\tby name.  ",
              inputSchema: { type: "object" },
            },
            { name: "alpha", inputSchema: { type: "object" } },
          ],
        }
      return {
        tools: [
          { name: "zebra", description: "Last tool", inputSchema: { type: "object" } },
          { name: "search_docs", description: "  ", inputSchema: { type: "object" } },
        ],
        nextCursor: "page-2",
      }
    }
    if (request.method === "ping") return {}
  })()

  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      ...(result === undefined ? { error: { code: -32601, message: "Method not found" } } : { result }),
    }) + "\n",
  )
}
