import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

const server = new Server(
  { name: "retention", version: "1.0.0" },
  { capabilities: { tools: {}, prompts: {}, resources: {} }, instructions: "Keep user work alive." },
)
let calls = 0
server.setRequestHandler("tools/list", async () => {
  if (process.argv.includes("--elicit-discovery"))
    await server.elicitInput({
      mode: "url",
      message: "Authorize discovery",
      url: "https://example.com/discovery",
      elicitationId: "discovery",
    })
  return {
    tools: ["state", "confirm", "fail"].map((name) => ({ name, inputSchema: { type: "object" as const } })),
  }
})
server.setRequestHandler("tools/call", async (request) => {
  calls++
  if (request.params.name === "fail") throw new Error("Failure after side effect")
  if (request.params.name === "confirm")
    await server.elicitInput({
      mode: "form",
      message: "Keep this operation alive",
      requestedSchema: {
        type: "object",
        properties: {
          proceed: { type: "boolean", title: "Proceed", description: "Confirm the operation", default: false },
        },
        required: ["proceed"],
      },
    })
  return { content: [{ type: "text" as const, text: JSON.stringify({ pid: process.pid, calls }) }] }
})
server.setRequestHandler("prompts/list", () => Promise.resolve({ prompts: [{ name: "state" }] }))
server.setRequestHandler("prompts/get", () =>
  Promise.resolve({
    messages: [{ role: "user" as const, content: { type: "text" as const, text: String(process.pid) } }],
  }),
)
server.setRequestHandler("resources/list", () =>
  Promise.resolve({ resources: [{ name: "state", uri: "state://pid" }] }),
)
server.setRequestHandler("resources/templates/list", () => Promise.resolve({ resourceTemplates: [] }))
server.setRequestHandler("resources/read", () =>
  Promise.resolve({ contents: [{ uri: "state://pid", text: String(process.pid) }] }),
)
await server.connect(new StdioServerTransport())
