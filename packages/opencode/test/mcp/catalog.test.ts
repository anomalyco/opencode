import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js"
import { McpCatalog } from "@/mcp/catalog"
import { Effect, Logger } from "effect"

const options = { toolCallId: "call_mcp", abortSignal: new AbortController().signal } as any

describe("McpCatalog.defs", () => {
  test("preserves a disconnected transport error", async () => {
    const client = new Client({ name: "disconnected", version: "1.0.0" })
    const error = await Effect.runPromise(McpCatalog.defs(client).pipe(Effect.flip))
    expect(error.message).toContain("Not connected")
  })

  test.each([
    { code: ErrorCode.MethodNotFound, message: "tools/list is not supported" },
    { code: ErrorCode.InternalError, message: "catalog service unavailable" },
  ])("preserves and logs protocol error: $message", async ({ code, message }) => {
    const server = new Server({ name: "errors", version: "1.0.0" }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      throw new McpError(code, message)
    })
    const client = new Client({ name: "errors-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    const logs: unknown[] = []
    try {
      const error = await Effect.runPromise(
        McpCatalog.defs(client).pipe(
          Effect.flip,
          Effect.provide(Logger.layer([Logger.make((entry) => logs.push(entry.message))])),
        ),
      )
      expect(error.message).toContain(message)
      expect(error.cause).toBeInstanceOf(McpError)
      expect(JSON.stringify(logs)).toContain(message)
    } finally {
      await Promise.all([client.close(), server.close()])
    }
  })

  test.each([
    { name: "empty tools", delay: 0, tools: [], error: undefined },
    { name: "invalid response schema", delay: 0, tools: [{ name: "broken" }], error: "inputSchema" },
    { name: "request timeout", delay: 100, tools: [], error: "timed out" },
  ])("handles $name", async ({ delay, tools, error }) => {
    const server = new Server({ name: "catalog", version: "1.0.0" }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (delay) await Bun.sleep(delay)
      return { tools }
    })
    const client = new Client({ name: "catalog-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      const result = McpCatalog.defs(client, 30)
      if (error) {
        const failure = await Effect.runPromise(result.pipe(Effect.flip))
        expect(failure.message).toContain(error)
        return
      }
      expect(await Effect.runPromise(result)).toEqual([])
    } finally {
      await Promise.all([client.close(), server.close()])
    }
  })
})

function clientReturning(result: unknown) {
  return {
    callTool: async () => result,
  } as unknown as Client
}

function mcpTool() {
  return {
    name: "screenshot",
    description: "Take a screenshot",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  } as any
}

describe("McpCatalog.convertTool", () => {
  test("preserves content when structuredContent is also present", async () => {
    const content = [{ type: "image" as const, mimeType: "image/png", data: "AAAA" }]
    const structuredContent = { image: { mimeType: "image/png", data: "AAAA" } }
    const converted = McpCatalog.convertTool(mcpTool(), clientReturning({ content, structuredContent }))

    const output = await converted.execute?.({}, options)

    expect(output).toMatchObject({ content, structuredContent })
  })

  test("falls back to structuredContent only when content is absent", async () => {
    const structuredContent = { results: [{ title: "one" }] }
    const converted = McpCatalog.convertTool(mcpTool(), clientReturning({ content: [], structuredContent }))

    const output = await converted.execute?.({}, options)

    expect(output).toMatchObject({
      structuredContent,
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    })
  })
})

test("preserves output schema validation across paginated tool discovery", async () => {
  const server = new Server({ name: "pagination", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, ({ params }) =>
    Promise.resolve(
      params?.cursor === "page-2"
        ? {
            tools: [
              {
                name: "second",
                inputSchema: { type: "object" },
                outputSchema: {
                  type: "object",
                  properties: { value: { type: "number" } },
                  required: ["value"],
                },
              },
            ],
          }
        : {
            tools: [
              {
                name: "first",
                inputSchema: { type: "object" },
                outputSchema: {
                  type: "object",
                  properties: { value: { type: "string" } },
                  required: ["value"],
                },
              },
            ],
            nextCursor: "page-2",
          },
    ),
  )
  server.setRequestHandler(CallToolRequestSchema, ({ params }) =>
    Promise.resolve({
      content: [],
      structuredContent: { value: params.name === "first" ? 42 : 1 },
    }),
  )

  const client = new Client({ name: "pagination-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  try {
    const tools = await Effect.runPromise(McpCatalog.defs(client))
    expect(tools?.map((tool) => tool.name)).toEqual(["first", "second"])
    await expect(client.callTool({ name: "first", arguments: {} })).rejects.toThrow(
      "Structured content does not match the tool's output schema",
    )
  } finally {
    await Promise.all([client.close(), server.close()])
  }
})
