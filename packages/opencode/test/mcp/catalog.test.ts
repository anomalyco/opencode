import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpCatalog } from "@/mcp/catalog"
import { ProviderTransform } from "@/provider/transform"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { asSchema } from "ai"
import { Effect } from "effect"
import { ProviderTest } from "../fake/provider"

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

describe("McpCatalog.convertTool argument repair (real MCP server)", () => {
  async function connect() {
    const received: unknown[] = []
    const server = new Server({ name: "repair", version: "1.0.0" }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, () =>
      Promise.resolve({
        tools: [
          {
            // Shape emitted by the Python MCP SDK for `def get_employee(employee_id: int | None = None)`.
            name: "get_employee",
            inputSchema: {
              type: "object",
              properties: { employee_id: { anyOf: [{ type: "integer" }, { type: "null" }], default: null } },
            },
          },
          {
            name: "update_settings",
            inputSchema: {
              type: "object",
              properties: { settings: { $ref: "#/$defs/Settings" }, attempts: { type: "integer", enum: [1, 3] } },
              required: ["settings"],
              additionalProperties: false,
              $defs: {
                Settings: {
                  type: "object",
                  properties: { notifications: { type: "boolean" } },
                  required: ["notifications"],
                },
              },
            },
          },
        ],
      }),
    )
    server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
      received.push(params.arguments)
      return Promise.resolve({ content: [{ type: "text", text: "ok" }] })
    })

    const client = new Client({ name: "repair-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    const tools = Object.fromEntries(
      ((await Effect.runPromise(McpCatalog.defs(client))) ?? []).map((tool) => [
        tool.name,
        McpCatalog.convertTool(tool, client),
      ]),
    )
    return {
      received,
      tools,
      call: (name: string, args: unknown) => tools[name]?.execute?.(args, options),
      [Symbol.asyncDispose]: () => Promise.all([client.close(), server.close()]).then(() => undefined),
    }
  }

  test("sends malformed arguments to the server repaired against its advertised schema", async () => {
    await using mcp = await connect()

    await mcp.call("get_employee", { employee_id: "88708" })
    await mcp.call("update_settings", { settings: '{"notifications":"false"}', attempts: "3" })

    expect(mcp.received).toEqual([{ employee_id: 88708 }, { settings: { notifications: false }, attempts: 3 }])
  })

  test("sends valid arguments unchanged", async () => {
    await using mcp = await connect()

    await mcp.call("get_employee", { employee_id: 88708 })
    await mcp.call("get_employee", { employee_id: null })
    await mcp.call("update_settings", { settings: { notifications: true }, attempts: 1 })

    expect(mcp.received).toEqual([
      { employee_id: 88708 },
      { employee_id: null },
      { settings: { notifications: true }, attempts: 1 },
    ])
  })

  test("repairs the string a Gemini model is told to send for an integer enum", async () => {
    await using mcp = await connect()
    const tool = mcp.tools.update_settings
    if (!tool) throw new Error("update_settings was not converted")

    // Same steps as SessionTools for MCP tools: the converted schema, then the provider transform.
    const schema = await Promise.resolve(asSchema(tool.inputSchema).jsonSchema)
    const id = ModelV2.ID.make("gemini-2.5-pro")
    const gemini = ProviderTest.model({
      id,
      providerID: ProviderV2.ID.make("google"),
      api: { id, url: "https://generativelanguage.googleapis.com/v1beta", npm: "@ai-sdk/google" },
    })
    const shown = ProviderTransform.schema(gemini, { ...schema, properties: schema.properties ?? {} })
    expect(shown.properties?.attempts).toEqual({ type: "string", enum: ["1", "3"] })

    await mcp.call("update_settings", { settings: { notifications: true }, attempts: "3" })

    expect(mcp.received).toEqual([{ settings: { notifications: true }, attempts: 3 }])
  })

  test("keeps unknown keys for open server schemas and drops them only for closed ones", async () => {
    await using mcp = await connect()

    await mcp.call("get_employee", { employee_id: "7", verbose: true })
    await mcp.call("update_settings", { settings: { notifications: true }, verbose: true })

    expect(mcp.received).toEqual([{ employee_id: 7, verbose: true }, { settings: { notifications: true } }])
  })
})
