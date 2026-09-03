import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpCatalog } from "@/mcp/catalog"
import { Effect } from "effect"

// Issue #3523: OpenAI rejects `tools[].function.name` strings longer than 64
// chars. Combined `<sanitized-server>_<sanitized-tool>` names can overflow,
// which silently kills the request because the provider 400 never reaches
// the TUI. The provider-facing helper truncates to `prefix(55) + "_" +
// hash(8)` so collisions on the readable prefix still produce distinct keys.
const MAX_TOOL_NAME_LENGTH = 64

describe("McpCatalog.buildToolName", () => {
  test("leaves short names byte-for-byte unchanged", () => {
    const result = McpCatalog.buildToolName("short", "ping")
    expect(result.name).toBe("short_ping")
    expect(result.truncated).toBe(false)
    expect(result.name.length).toBeLessThanOrEqual(MAX_TOOL_NAME_LENGTH)
  })

  test("truncates overflow to at most 64 chars with a hash suffix", () => {
    // 35-char server name from the issue's reproducer + 1 ("_") + 35-char tool
    // name = 71 chars (post-sanitize). Exceeds the provider limit.
    const longServer = "chrome-devtools-aaaaaaaaaaaaaaaaaaa"
    const longTool = "perform_extremely_specific_workflow_step_alpha"

    const result = McpCatalog.buildToolName(longServer, longTool)

    expect(result.truncated).toBe(true)
    expect(result.name.length).toBeLessThanOrEqual(MAX_TOOL_NAME_LENGTH)
    expect(result.name).toMatch(/_[0-9a-f]{8}$/)
  })

  test("collision-safe: two long names sharing a 55-char prefix stay distinct", () => {
    // The two combined names below share their first 64 chars; blind
    // .slice(0, 64) would collapse them into a single registry key.
    const longServer = "chrome-devtools-aaaaaaaaaaaaaaaaaaa"
    const toolAlpha = "perform_extremely_specific_workflow_step_alpha"
    const toolBeta = "perform_extremely_specific_workflow_step_beta"

    const alpha = McpCatalog.buildToolName(longServer, toolAlpha)
    const beta = McpCatalog.buildToolName(longServer, toolBeta)

    expect(alpha.name).not.toBe(beta.name)
    expect(alpha.name.length).toBeLessThanOrEqual(MAX_TOOL_NAME_LENGTH)
    expect(beta.name.length).toBeLessThanOrEqual(MAX_TOOL_NAME_LENGTH)
    // The readable 55-char prefix is preserved unchanged on both sides.
    expect(alpha.name.startsWith(alpha.name.slice(0, 55))).toBe(true)
    expect(beta.name.startsWith(beta.name.slice(0, 55))).toBe(true)
  })

  test("hash is stable for the same combined input", () => {
    const longServer = "chrome-devtools-aaaaaaaaaaaaaaaaaaa"
    const longTool = "perform_extremely_specific_workflow_step_alpha"

    const first = McpCatalog.buildToolName(longServer, longTool)
    const second = McpCatalog.buildToolName(longServer, longTool)

    expect(first.name).toBe(second.name)
  })
})

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
