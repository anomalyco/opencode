import { afterEach, describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { convertTool } from "../../src/mcp/catalog"

const definition = {
  name: "example",
  description: "Example tool",
  inputSchema: { type: "object" as const, properties: {} },
}

const connections: Array<{ client: Client; server: Server }> = []

afterEach(async () => {
  await Promise.all(connections.splice(0).flatMap(({ client, server }) => [client.close(), server.close()]))
})

async function tool(result: CallToolResult) {
  const client = new Client({ name: "test-client", version: "1" })
  const server = new Server({ name: "test-server", version: "1" }, { capabilities: { tools: {} } })
  server.setRequestHandler(CallToolRequestSchema, async () => result)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  connections.push({ client, server })

  const converted = convertTool(definition, client)
  if (!converted.execute) throw new Error("expected executable tool")
  return converted.execute
}

describe("mcp catalog", () => {
  test("returns ordinary tool results", async () => {
    const result = {
      content: [{ type: "text" as const, text: "ordinary output" }],
      structuredContent: { value: 42 },
    }
    const execute = await tool(result)

    await expect(execute({}, { toolCallId: "call-1", messages: [] })).resolves.toEqual({
      ...result,
      content: [{ type: "text", text: '{"value":42}' }],
    })
  })

  test("throws MCP tool errors with text diagnostics", async () => {
    const execute = await tool({
      isError: true,
      content: [
        { type: "text", text: "validation failed" },
        { type: "text", text: "labels must be an object" },
        { type: "resource", resource: { uri: "error://details", text: "resource details" } },
      ],
      structuredContent: { field: "labels", expected: "object" },
    })

    await expect(execute({}, { toolCallId: "call-1", messages: [] })).rejects.toThrow(
      "validation failed\n\nlabels must be an object",
    )
  })
})
