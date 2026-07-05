import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpCatalog } from "@/mcp/catalog"
import { asSchema } from "ai"
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
  test("preserves the declared output schema", () => {
    const outputSchema = {
      type: "object" as const,
      properties: { value: { type: "string" as const } },
      required: ["value"],
    }
    const converted = McpCatalog.convertTool({ ...mcpTool(), outputSchema }, clientReturning({ content: [] }))

    expect(asSchema(converted.outputSchema!).jsonSchema).toEqual(outputSchema)
  })

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

test("isolates malformed output schemas while caching valid sibling schemas", async () => {
  const server = new Server({ name: "schemas", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: [
        {
          name: "malformed",
          inputSchema: { type: "object" },
          outputSchema: { type: "object", properties: { value: { $ref: "#/$defs/Missing" } } },
        },
        {
          name: "valid",
          inputSchema: { type: "object" },
          outputSchema: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
        },
      ],
    }),
  )
  server.setRequestHandler(CallToolRequestSchema, () =>
    Promise.resolve({ content: [], structuredContent: { value: 42 } }),
  )

  const client = new Client({ name: "schema-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  try {
    const tools = await Effect.runPromise(McpCatalog.defs(client))
    expect(tools?.map((tool) => tool.name)).toEqual(["malformed", "valid"])
    await expect(client.callTool({ name: "valid", arguments: {} })).rejects.toThrow(
      "Structured content does not match the tool's output schema",
    )
  } finally {
    await Promise.all([client.close(), server.close()])
  }
})

test("refreshes valid sibling metadata when another output schema is malformed", async () => {
  let refreshed = false
  const server = new Server({ name: "schema-refresh", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: [
        ...(refreshed
          ? [
              {
                name: "malformed",
                inputSchema: { type: "object" as const },
                outputSchema: { type: "object" as const, properties: { value: { $ref: "#/$defs/Missing" } } },
              },
            ]
          : []),
        {
          name: "valid",
          inputSchema: { type: "object" },
          outputSchema: {
            type: "object",
            properties: { value: { type: refreshed ? ("number" as const) : ("string" as const) } },
            required: ["value"],
          },
        },
      ],
    }),
  )
  server.setRequestHandler(CallToolRequestSchema, () =>
    Promise.resolve({ content: [], structuredContent: { value: 42 } }),
  )

  const client = new Client({ name: "schema-refresh-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  try {
    expect(await Effect.runPromise(McpCatalog.defs(client))).toHaveLength(1)
    refreshed = true
    expect(await Effect.runPromise(McpCatalog.defs(client))).toHaveLength(2)
    await expect(client.callTool({ name: "valid", arguments: {} })).resolves.toMatchObject({
      structuredContent: { value: 42 },
    })
  } finally {
    await Promise.all([client.close(), server.close()])
  }
})

test("retains the previous metadata when a continuation page fails", async () => {
  let failContinuation = false
  const server = new Server({ name: "failure", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, ({ params }) => {
    if (params?.cursor === "page-2") throw new Error("continuation failed")
    return Promise.resolve({
      tools: [
        {
          name: "lookup",
          inputSchema: { type: "object" },
          outputSchema: {
            type: "object",
            properties: { value: { type: failContinuation ? "number" : "string" } },
            required: ["value"],
          },
        },
      ],
      nextCursor: failContinuation ? "page-2" : undefined,
    })
  })
  server.setRequestHandler(CallToolRequestSchema, () =>
    Promise.resolve({ content: [], structuredContent: { value: 42 } }),
  )

  const client = new Client({ name: "failure-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  try {
    expect(await Effect.runPromise(McpCatalog.defs(client))).toHaveLength(1)
    failContinuation = true
    expect(await Effect.runPromise(McpCatalog.defs(client))).toBeUndefined()
    await expect(client.callTool({ name: "lookup", arguments: {} })).rejects.toThrow(
      "Structured content does not match the tool's output schema",
    )
  } finally {
    await Promise.all([client.close(), server.close()])
  }
})

test("does not let an older overlapping listing replace newer metadata", async () => {
  let listing = 0
  let releaseOld: (() => void) | undefined
  let markOldContinuationStarted: (() => void) | undefined
  const oldContinuationStarted = new Promise<void>((resolve) => (markOldContinuationStarted = resolve))
  const oldContinuation = new Promise<void>((resolve) => (releaseOld = resolve))
  const server = new Server({ name: "overlap", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async ({ params }) => {
    if (params?.cursor === "old-page-2") {
      markOldContinuationStarted?.()
      await oldContinuation
      return { tools: [] }
    }
    listing++
    return {
      tools: [
        {
          name: "lookup",
          inputSchema: { type: "object" },
          outputSchema: {
            type: "object",
            properties: { value: { type: listing === 1 ? "string" : "number" } },
            required: ["value"],
          },
        },
      ],
      nextCursor: listing === 1 ? "old-page-2" : undefined,
    }
  })
  server.setRequestHandler(CallToolRequestSchema, () =>
    Promise.resolve({ content: [], structuredContent: { value: 42 } }),
  )

  const client = new Client({ name: "overlap-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  try {
    const old = Effect.runPromise(McpCatalog.defs(client))
    await oldContinuationStarted
    expect(await Effect.runPromise(McpCatalog.defs(client))).toHaveLength(1)
    releaseOld?.()
    expect(await old).toHaveLength(1)
    await expect(client.callTool({ name: "lookup", arguments: {} })).resolves.toMatchObject({
      structuredContent: { value: 42 },
    })
  } finally {
    releaseOld?.()
    await Promise.all([client.close(), server.close()])
  }
})

test("commits an older overlapping listing when the newer listing fails", async () => {
  let listing = 0
  let releaseOld: (() => void) | undefined
  let markOldContinuationStarted: (() => void) | undefined
  const oldContinuationStarted = new Promise<void>((resolve) => (markOldContinuationStarted = resolve))
  const oldContinuation = new Promise<void>((resolve) => (releaseOld = resolve))
  const server = new Server({ name: "overlap-failure", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async ({ params }) => {
    if (params?.cursor === "old-page-2") {
      markOldContinuationStarted?.()
      await oldContinuation
      return { tools: [] }
    }
    if (params?.cursor === "new-page-2") throw new Error("newer continuation failed")
    listing++
    return {
      tools: [
        {
          name: "lookup",
          inputSchema: { type: "object" },
          outputSchema: {
            type: "object",
            properties: { value: { type: listing === 1 ? "string" : "number" } },
            required: ["value"],
          },
        },
      ],
      nextCursor: listing === 1 ? "old-page-2" : "new-page-2",
    }
  })
  server.setRequestHandler(CallToolRequestSchema, () =>
    Promise.resolve({ content: [], structuredContent: { value: 42 } }),
  )

  const client = new Client({ name: "overlap-failure-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  try {
    const old = Effect.runPromise(McpCatalog.defs(client))
    await oldContinuationStarted
    expect(await Effect.runPromise(McpCatalog.defs(client))).toBeUndefined()
    releaseOld?.()
    expect(await old).toHaveLength(1)
    await expect(client.callTool({ name: "lookup", arguments: {} })).rejects.toThrow(
      "Structured content does not match the tool's output schema",
    )
  } finally {
    releaseOld?.()
    await Promise.all([client.close(), server.close()])
  }
})
