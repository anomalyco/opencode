import { appendFileSync } from "node:fs"
import { Server, isJSONRPCRequest, inputRequired } from "@modelcontextprotocol/server"
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio"

const mode = process.argv[2]
const log = process.argv[3]
const record = (method: string) => appendFileSync(log, JSON.stringify({ pid: process.pid, method }) + "\n")
record("spawn")
const transport = new StdioServerTransport()
const start = transport.start.bind(transport)
transport.start = async () => {
  const receive = transport.onmessage
  transport.onmessage = (message) => {
    if ("method" in message) record(message.method)
    if ("method" in message && message.method === "initialize" && mode === "legacy-hang") return
    if (isJSONRPCRequest(message) && message.method === "server/discover") {
      if (mode === "legacy-exit") process.exit(1)
      if (mode === "legacy-silent" || mode === "stall") return
      if (mode === "legacy-error") {
        void transport.send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Initialize first" } })
        return
      }
    }
    receive?.(message)
  }
  await start()
}

const factory = () => {
  const server = new Server(
    { name: "stdio-protocol", version: "1" },
    {
      capabilities: { tools: { listChanged: true }, prompts: { listChanged: true }, resources: { listChanged: true } },
      instructions: "stdio instructions",
    },
  )
  server.setRequestHandler("tools/list", async () => ({ tools: [{ name: "echo", inputSchema: { type: "object" } }] }))
  server.setRequestHandler("tools/call", async (request, ctx) => {
    if (request.params.arguments?.slow) {
      record("executing")
      await new Promise<void>((resolve) =>
        ctx.mcpReq.signal.addEventListener(
          "abort",
          () => {
            record("aborted")
            resolve()
          },
          { once: true },
        ),
      )
    }
    if (!ctx.mcpReq.inputResponses)
      return inputRequired({ inputRequests: { roots: inputRequired.listRoots() }, requestState: "stdio-state" })
    await server.sendToolListChanged()
    await server.sendPromptListChanged()
    await server.sendResourceListChanged()
    return {
      content: [{ type: "text", text: "stdio complete" }],
      structuredContent: { ...ctx.mcpReq.inputResponses, sessionID: request.params._meta?.sessionID },
    }
  })
  return server
}

if (mode.startsWith("legacy")) await factory().connect(transport)
else serveStdio(factory, { transport, legacy: mode === "dual" ? "serve" : "reject" })
