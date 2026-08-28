import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { GetPromptRequestSchema, ListPromptsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const server = new Server({ name: "prompts", version: "1.0.0" }, { capabilities: { prompts: {} } })

server.setRequestHandler(ListPromptsRequestSchema, ({ params }) =>
  Promise.resolve(
    params?.cursor === "page-2"
      ? { prompts: [{ name: "second", description: "Second prompt" }] }
      : {
          prompts: [
            {
              name: "first",
              description: "First prompt",
              arguments: [{ name: "topic", description: "Topic to explain", required: true }],
            },
          ],
          nextCursor: "page-2",
        },
  ),
)

server.setRequestHandler(GetPromptRequestSchema, ({ params }) =>
  Promise.resolve({
    messages: [{ role: "user", content: { type: "text", text: params.arguments?.topic ?? "missing" } }],
  }),
)

await server.connect(new StdioServerTransport())
