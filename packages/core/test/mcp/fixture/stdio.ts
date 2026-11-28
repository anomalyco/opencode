import { appendFileSync } from "node:fs"
import type { JSONRPCMessage } from "@modelcontextprotocol/server"
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio"
import { make, type Spec, type State } from "./server"

// The fixture over stdio. MCP_FIXTURE holds its spec as JSON plus `era`; each process appends its pid to
// MCP_PID_FILE, so a test can count and stop processes.
// `silent` is a legacy server that never answers requests it doesn't know, such as the version probe.
const spec: Spec & { readonly era?: "modern" | "legacy"; readonly silent?: boolean } = JSON.parse(
  process.env.MCP_FIXTURE ?? "{}",
)
if (process.env.MCP_PID_FILE) appendFileSync(process.env.MCP_PID_FILE, `${process.pid}\n`)
const state: State = { added: [] }

if (spec.era === "legacy") {
  const server = make(spec, state, () => void server.sendToolListChanged())
  const transport = new StdioServerTransport()
  await server.connect(transport)
  const receive = transport.onmessage
  transport.onmessage = (message: JSONRPCMessage) => {
    if (spec.silent && "method" in message && message.method === "server/discover") return
    receive?.(message)
  }
} else {
  serveStdio(
    () => {
      const server = make(spec, state, () => void server.sendToolListChanged())
      return server
    },
    { legacy: "reject" },
  )
}
