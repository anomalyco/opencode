import { beforeAll, describe, expect, test } from "bun:test"
import { define } from "@/session/code-mode"
import { McpCatalog } from "@/mcp/catalog"
import { Agent } from "@/agent/agent"
import { Tool } from "@/tool/tool"
import * as Truncate from "@/tool/truncate"
import { MessageID, SessionID } from "@/session/schema"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import type { Tool as AITool } from "ai"
import { Effect, Layer } from "effect"

// A 1x1 transparent PNG, base64-encoded, used to exercise image attachments.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const SERVER = "fixtures"

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_code-mode-int"),
  messageID: MessageID.make("msg_code-mode-int"),
  agent: "build",
  abort: new AbortController().signal,
  callID: "call_code_mode_int",
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

// Truncate echoes its input so assertions read the exact program output.
const layer = Layer.mergeAll(
  Layer.mock(Truncate.Service, {
    output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
  }),
  Layer.succeed(Agent.Service, Agent.Service.of({ get: () => Effect.succeed({ name: "build" } as any) } as any)),
)

// A real MCP server, exposed over an in-memory transport, with a representative mix
// of tools: plain text, structured data (with an outputSchema), an image, and a
// failing tool. Tools are defined with raw JSON Schema so outputSchema is exact.
const TOOL_DEFS: MCPToolDef[] = [
  {
    name: "get_text",
    description: "Greet someone and return the greeting as text",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "add",
    description: "Add two numbers and return the structured sum",
    inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
    outputSchema: { type: "object", properties: { sum: { type: "number" } }, required: ["sum"] },
  },
  {
    name: "screenshot",
    description: "Capture a screenshot and return it as an image",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "boom",
    description: "A tool that always fails",
    inputSchema: { type: "object", properties: {} },
  },
] as MCPToolDef[]

function handleCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "get_text":
      return { content: [{ type: "text", text: `hello ${args.name}` }] }
    case "add": {
      const sum = (args.a as number) + (args.b as number)
      return { content: [{ type: "text", text: String(sum) }], structuredContent: { sum } }
    }
    case "screenshot":
      return { content: [{ type: "image", data: PNG, mimeType: "image/png" }] }
    case "boom":
      return { content: [{ type: "text", text: "kaboom" }], isError: true }
    default:
      return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true }
  }
}

let tool: Awaited<ReturnType<typeof buildTool>>

async function buildTool() {
  const server = new Server({ name: SERVER, version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }))
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    handleCall(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>),
  )

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: "test-client", version: "1.0.0" })
  await client.connect(clientTransport)

  const listed = (await client.listTools()).tools as MCPToolDef[]
  const mcpTools: Record<string, AITool> = {}
  const mcpDefs: Record<string, MCPToolDef> = {}
  for (const def of listed) {
    const key = McpCatalog.toolName(SERVER, def.name)
    mcpDefs[key] = def
    mcpTools[key] = McpCatalog.convertTool(def, client)
  }
  return Effect.runPromise(define(mcpTools, mcpDefs, [SERVER]).pipe(Effect.flatMap(Tool.init), Effect.provide(layer)))
}

const run = (code: string) => Effect.runPromise(tool.execute({ code }, ctx))

beforeAll(async () => {
  tool = await buildTool()
})

describe("code mode integration (real MCP server)", () => {
  test("describe exposes the typed return signature from the tool's outputSchema", async () => {
    const out = await run("return await tools.$rune.describe('fixtures.add')")
    const desc = JSON.parse(out.output)
    expect(desc.path).toBe("fixtures.add")
    expect(desc.signature).toBe(
      "tools.fixtures.add(input: { a: number; b: number }): Promise<{ result: { sum: number }; attachments?: Attachment[] }>",
    )
    expect(desc.outputSchema).toBeDefined()
  })

  test("describe falls back to result: unknown when no outputSchema is declared", async () => {
    const out = await run("return await tools.$rune.describe('fixtures.get_text')")
    const desc = JSON.parse(out.output)
    expect(desc.signature).toContain("Promise<{ result: unknown; attachments?: Attachment[] }>")
  })

  test("search finds a tool by keyword", async () => {
    const out = await run("return await tools.$rune.search('screenshot')")
    const result = JSON.parse(out.output)
    expect(result.items.map((i: any) => i.path)).toContain("fixtures.screenshot")
  })

  test("calls a text tool and unwraps the result envelope", async () => {
    const out = await run("const r = await tools.fixtures.get_text({ name: 'world' }); return r.result")
    expect(out.output).toBe("hello world")
    expect(out.metadata.toolCalls).toEqual([{ tool: "fixtures.get_text", status: "completed" }])
    expect(out.attachments).toBeUndefined()
  })

  test("exposes structured data from a tool with an outputSchema", async () => {
    const out = await run("const r = await tools.fixtures.add({ a: 2, b: 3 }); return r.result.sum")
    expect(out.output).toBe("5")
  })

  test("composes multiple structured calls and returns a plain object", async () => {
    const out = await run(`
      const first = await tools.fixtures.add({ a: 1, b: 2 })
      const second = await tools.fixtures.add({ a: first.result.sum, b: 10 })
      return { total: second.result.sum }
    `)
    expect(JSON.parse(out.output)).toEqual({ total: 13 })
    expect(out.metadata.toolCalls).toEqual([
      { tool: "fixtures.add", status: "completed" },
      { tool: "fixtures.add", status: "completed" },
    ])
  })

  test("forwards an image as an attachment when the whole result is returned", async () => {
    const out = await run("return await tools.fixtures.screenshot({})")
    expect(out.attachments).toEqual([{ type: "file", mime: "image/png", url: `data:image/png;base64,${PNG}` }])
  })

  test("an attachment's bytes are readable and routable in code, not opaque", async () => {
    // The data: URL carrying the base64 payload is an ordinary string in the
    // sandbox: the program can inspect it (and thus route it into another tool).
    const out = await run(`
      const shot = await tools.fixtures.screenshot({})
      const url = shot.attachments[0].url
      return { result: { mime: shot.attachments[0].mime, isDataUrl: url.startsWith('data:'), bytes: url.length } }
    `)
    expect(JSON.parse(out.output)).toEqual({
      mime: "image/png",
      isDataUrl: true,
      bytes: `data:image/png;base64,${PNG}`.length,
    })
    expect(out.attachments).toBeUndefined()
  })

  test("drops media when only .result is returned", async () => {
    const out = await run("const r = await tools.fixtures.screenshot({}); return { result: 'captured' }")
    expect(out.output).toBe("captured")
    expect(out.attachments).toBeUndefined()
  })

  test("runs calls in parallel and forwards multiple attachments the model curates", async () => {
    const out = await run(`
      const [a, b] = await Promise.all([tools.fixtures.screenshot({}), tools.fixtures.screenshot({})])
      return { result: 'two shots', attachments: [...(a.attachments ?? []), ...(b.attachments ?? [])] }
    `)
    expect(out.output).toBe("two shots")
    expect(out.attachments).toHaveLength(2)
    expect(out.metadata.toolCalls.map((c) => c.tool)).toEqual(["fixtures.screenshot", "fixtures.screenshot"])
  })

  test("propagates an MCP isError into the program as a catchable error", async () => {
    const out = await run("try { await tools.fixtures.boom({}) } catch (e) { return 'caught: ' + e.message }")
    expect(out.output).toBe("caught: kaboom")
  })

  test("an uncaught MCP error surfaces as a failed execution", async () => {
    const out = await run("await tools.fixtures.boom({}); return 'unreachable'")
    expect(out.metadata.error).toBe(true)
    expect(out.output).toContain("kaboom")
  })

  test("asks permission for each MCP call but not for discovery helpers", async () => {
    const asked: string[] = []
    const permCtx: Tool.Context = { ...ctx, ask: (req: any) => Effect.sync(() => void asked.push(req.permission)) }
    await Effect.runPromise(
      tool.execute(
        {
          code: `
            await tools.$rune.search('add')
            await tools.$rune.describe('fixtures.add')
            await tools.fixtures.add({ a: 1, b: 1 })
            return 'done'
          `,
        },
        permCtx,
      ),
    )
    expect(asked).toEqual(["fixtures_add"])
  })
})
