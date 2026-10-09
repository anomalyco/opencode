import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpCatalog } from "@/mcp/catalog"
import { Effect } from "effect"

const options = { toolCallId: "call_mcp", abortSignal: new AbortController().signal } as any

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

  test("notifies onAuthFailure and rethrows when the server rejects with 401", async () => {
    const client = {
      callTool: async () => {
        throw new UnauthorizedError("Server returned 401 after re-authentication (HTTP 401)")
      },
    } as unknown as Client

    let notified = 0
    const converted = McpCatalog.convertTool(mcpTool(), client, undefined, () => {
      notified += 1
    })

    await expect(converted.execute?.({}, options)).rejects.toThrow("401")
    expect(notified).toBe(1)
  })

  test("notifies onAuthFailure for a plain error carrying a 401 message", async () => {
    const client = {
      callTool: async () => {
        throw new Error("HTTP 401 Unauthorized")
      },
    } as unknown as Client

    let notified = 0
    const converted = McpCatalog.convertTool(mcpTool(), client, undefined, () => {
      notified += 1
    })

    await expect(converted.execute?.({}, options)).rejects.toThrow("401")
    expect(notified).toBe(1)
  })

  test("does not notify onAuthFailure for non-auth errors", async () => {
    const client = {
      callTool: async () => {
        throw new Error("boom")
      },
    } as unknown as Client

    let notified = 0
    const converted = McpCatalog.convertTool(mcpTool(), client, undefined, () => {
      notified += 1
    })

    await expect(converted.execute?.({}, options)).rejects.toThrow("boom")
    expect(notified).toBe(0)
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
