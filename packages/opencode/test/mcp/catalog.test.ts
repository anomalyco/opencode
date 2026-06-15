import { expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { convertTool } from "../../src/mcp/catalog"

test("marks MCP error results as tool errors", async () => {
  const client = new Client({ name: "test-client", version: "1" })
  const server = new Server({ name: "test-server", version: "1" }, { capabilities: { tools: {} } })
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    isError: true,
    content: [
      { type: "text", text: "validation failed" },
      { type: "text", text: "labels must be an object" },
    ],
  }))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  try {
    const tool = convertTool({ name: "example", inputSchema: { type: "object" } }, client)
    if (!tool.execute) throw new Error("expected executable tool")
    await expect(tool.execute({}, { toolCallId: "call-1", messages: [] })).rejects.toThrow(
      "validation failed\n\nlabels must be an object",
    )
  } finally {
    await Promise.all([client.close(), server.close()])
  }
})
