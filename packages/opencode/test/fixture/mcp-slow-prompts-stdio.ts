import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListPromptsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

// Simulates a slow-to-connect MCP server: sleeps before the stdio handshake
// becomes responsive, then serves a single prompt. Used by command tests to
// assert that file-based commands are listed without waiting on MCP.
const delay = Number(process.argv[process.argv.indexOf("--delay-ms") + 1])
await Bun.sleep(delay)

const server = new Server({ name: "mcp-slow-prompts-stdio", version: "1.0.0" }, { capabilities: { prompts: {} } })

server.setRequestHandler(ListPromptsRequestSchema, () =>
  Promise.resolve({
    prompts: [{ name: "slow_prompt", description: "A prompt from a slow MCP server" }],
  }),
)

await server.connect(new StdioServerTransport())
