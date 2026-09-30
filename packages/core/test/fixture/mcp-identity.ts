import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

const [identity = "unknown", pidFile] = process.argv.slice(2)
if (pidFile) await Bun.write(pidFile, String(process.pid))

const server = new Server({ name: `identity-${identity}`, version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler("tools/list", () =>
  Promise.resolve({
    tools: [
      { name: "whoami", inputSchema: { type: "object" } },
      { name: `only_${identity}`, inputSchema: { type: "object" } },
    ],
  }),
)

server.setRequestHandler("tools/call", () => Promise.resolve({ content: [{ type: "text", text: identity }] }))

await server.connect(new StdioServerTransport())
