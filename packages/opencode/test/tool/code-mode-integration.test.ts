import { beforeAll, describe, expect, test } from "bun:test"
import { CodeModeTool, describeCatalog } from "@/tool/code-mode"
import { McpCatalog } from "@/mcp/catalog"
import { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { Plugin } from "@/plugin"
import { Session } from "@/session/session"
import { Tool } from "@/tool/tool"
import * as Truncate from "@/tool/truncate"
import { MessageID, SessionID } from "@/session/schema"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  CallToolRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
  type Tool as MCPToolDef,
} from "@modelcontextprotocol/sdk/types.js"
import { Cause, Effect, Exit, Layer } from "effect"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

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

// Avoid the SDK Client here; other MCP tests mock it process-globally.
class RawJsonRpcClient {
  private nextId = 1
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()

  constructor(private transport: InMemoryTransport) {}

  async connect() {
    this.transport.onmessage = (message) => {
      const msg = message as { id?: number; result?: unknown; error?: { message: string } }
      if (msg.id === undefined) return
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(msg.error.message))
      else entry.resolve(msg.result)
    }
    await this.transport.start()
    await this.request("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    })
    await this.transport.send({ jsonrpc: "2.0", method: "notifications/initialized" })
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    void this.transport.send({ jsonrpc: "2.0", id, method, params } as never)
    return result
  }

  listTools() {
    return this.request("tools/list", {})
  }

  callTool(params: { name: string; arguments?: Record<string, unknown> }, _schema?: unknown, _options?: unknown) {
    return this.request("tools/call", params)
  }
}

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

let tool: Awaited<ReturnType<typeof buildTool>>["tool"]
let description: string

async function buildTool() {
  const server = new Server({ name: SERVER, version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }))
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    handleCall(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>),
  )

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new RawJsonRpcClient(clientTransport)
  await client.connect()

  const listed = (await client.listTools()).tools as MCPToolDef[]
  const mcpTools: Record<string, MCP.McpTool> = {}
  for (const def of listed) {
    mcpTools[McpCatalog.toolName(SERVER, def.name)] = { def, client: client as unknown as Client }
  }

  const layer = Layer.mergeAll(
    Layer.mock(Plugin.Service, {
      trigger: ((_name: unknown, _input: unknown, output: unknown) =>
        Effect.succeed(output)) as Plugin.Interface["trigger"],
    }),
    Layer.mock(Truncate.Service, {
      output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
    }),
    Layer.mock(Agent.Service, { get: () => Effect.succeed({ name: "build", permission: [] } as any) }),
    Layer.mock(Session.Service, { get: () => Effect.succeed({ permission: [] } as any) }),
    Layer.mock(MCP.Service, {
      tools: () => Effect.succeed(mcpTools),
      clients: () => Effect.succeed({ [SERVER]: {} as any }),
    }),
  )
  return {
    tool: await Effect.runPromise(CodeModeTool.pipe(Effect.flatMap(Tool.init), Effect.provide(layer))),
    description: describeCatalog(mcpTools, [SERVER]),
  }
}

const run = (code: string) => Effect.runPromise(tool.execute({ code }, ctx))
// Program failures die at the tool boundary; recover the defect for message assertions.
const runFailed = async (code: string) => {
  const exit = await Effect.runPromise(tool.execute({ code }, ctx).pipe(Effect.exit))
  if (Exit.isSuccess(exit)) throw new Error("expected the tool to fail")
  return Cause.squash(exit.cause) as Error
}

beforeAll(async () => {
  const built = await buildTool()
  tool = built.tool
  description = built.description
})

describe("code mode integration (real MCP server)", () => {
  test("the appended catalog inlines full signatures with real MCP schemas", () => {
    expect(description).toContain("Available tools (COMPLETE list")
    expect(description).toContain("- fixtures (4 tools)")
    expect(description).toContain(
      "tools.fixtures.add(input: {\n  a: number,\n  b: number,\n}): Promise<{\n  sum: number,\n}>",
    )
    expect(description).toContain("tools.fixtures.get_text(input: {\n  name: string,\n}): Promise<unknown>")
    expect(description).toContain("// Add two numbers and return the structured sum")
    expect(description).not.toContain("$codemode")
    expect(description).toContain("## Workflow")
    expect(description).toContain("Do not infer or normalize tool names")
    expect(description).toContain("bracket notation and quotes are part of the path")
    expect(description).not.toContain("total_count")
  })

  test("calls a text tool and receives its text as the native result", async () => {
    const out = await run("const r = await tools.fixtures.get_text({ name: 'world' }); return r")
    expect(out.output).toBe("hello world")
    expect(out.metadata.toolCalls).toEqual([
      { tool: "fixtures.get_text", status: "completed", input: { name: "world" } },
    ])
    expect(out.attachments).toBeUndefined()
  })

  test("exposes structured data natively from a tool with an outputSchema", async () => {
    const out = await run("const r = await tools.fixtures.add({ a: 2, b: 3 }); return r.sum")
    expect(out.output).toBe("5")
  })

  test("composes multiple structured calls and returns a plain object", async () => {
    const out = await run(`
      const first = await tools.fixtures.add({ a: 1, b: 2 })
      const second = await tools.fixtures.add({ a: first.sum, b: 10 })
      return { total: second.sum }
    `)
    expect(JSON.parse(out.output)).toEqual({ total: 13 })
    expect(out.metadata.toolCalls).toEqual([
      { tool: "fixtures.add", status: "completed", input: { a: 1, b: 2 } },
      { tool: "fixtures.add", status: "completed", input: { a: 3, b: 10 } },
    ])
  })

  test("an image result becomes an execute attachment and a marker in the sandbox", async () => {
    const out = await run("return await tools.fixtures.screenshot({})")
    expect(out.output).toBe("[1 image attached to the result]")
    expect(out.attachments).toEqual([{ type: "file", mime: "image/png", url: `data:image/png;base64,${PNG}` }])
  })

  test("image bytes never enter the sandbox or the model-facing output", async () => {
    const out = await run(`
      const shot = await tools.fixtures.screenshot({})
      return { sawMarker: typeof shot === 'string' && shot.includes('attached'), value: shot }
    `)
    expect(JSON.parse(out.output)).toEqual({
      sawMarker: true,
      value: "[1 image attached to the result]",
    })
    expect(out.output).not.toContain(PNG)
    expect(out.attachments).toHaveLength(1)
  })

  test("attachments accumulate even when the program returns something else", async () => {
    const out = await run("await tools.fixtures.screenshot({}); return 'captured'")
    expect(out.output).toBe("captured")
    expect(out.attachments).toHaveLength(1)
  })

  test("runs calls in parallel and accumulates every attachment", async () => {
    const out = await run(`
      const both = await Promise.all([tools.fixtures.screenshot({}), tools.fixtures.screenshot({})])
      return 'two shots: ' + both.length
    `)
    expect(out.output).toBe("two shots: 2")
    expect(out.attachments).toHaveLength(2)
    expect(out.metadata.toolCalls.map((c) => c.tool)).toEqual(["fixtures.screenshot", "fixtures.screenshot"])
  })

  test("propagates an MCP isError into the program as a catchable error", async () => {
    const out = await run("try { await tools.fixtures.boom({}) } catch (e) { return 'caught: ' + e.message }")
    expect(out.output).toBe("caught: kaboom")
  })

  test("an uncaught MCP error surfaces as a failed execution", async () => {
    const error = await runFailed("await tools.fixtures.boom({}); return 'unreachable'")
    expect(error.message).toContain("kaboom")
  })

  test("console output is captured and appended as a Logs section after the result", async () => {
    const out = await run(`
      console.log("looking up", { name: "world" })
      const r = await tools.fixtures.get_text({ name: "world" })
      console.warn("got", r)
      return r
    `)
    expect(out.output).toBe('hello world\n\nLogs:\nlooking up {"name":"world"}\n[warn] got hello world')
    expect(out.metadata.error).toBeUndefined()
  })

  test("console output is preserved on the error path", async () => {
    const error = await runFailed(`
      console.log("before the throw")
      await tools.fixtures.boom({})
      return "unreachable"
    `)
    expect(error.message).toContain("kaboom")
    expect(error.message).toContain("Logs:\nbefore the throw")
  })

  test("a program that logs nothing gets no Logs section", async () => {
    const out = await run("return 'quiet'")
    expect(out.output).toBe("quiet")
    expect(out.output).not.toContain("Logs:")
  })

  test("console does not consume the tool-call metadata (logging is not a tool call)", async () => {
    const out = await run("console.log('hi'); console.error('bye'); return 'ok'")
    expect(out.output).toBe("ok\n\nLogs:\nhi\n[error] bye")
    expect(out.metadata.toolCalls).toEqual([])
  })

  test("asks permission for each MCP call, keyed by the flat catalog name", async () => {
    const asked: string[] = []
    const permCtx: Tool.Context = { ...ctx, ask: (req: any) => Effect.sync(() => void asked.push(req.permission)) }
    await Effect.runPromise(
      tool.execute(
        {
          code: `
            await tools.fixtures.add({ a: 1, b: 1 })
            await tools.fixtures.get_text({ name: 'x' })
            return 'done'
          `,
        },
        permCtx,
      ),
    )
    expect(asked).toEqual(["fixtures_add", "fixtures_get_text"])
  })

  test("streams running/completed metadata for child calls over a real transport", async () => {
    const snapshots: Array<{ toolCalls: { tool: string; status: string; input?: Record<string, unknown> }[] }> = []
    const recordingCtx: Tool.Context = {
      ...ctx,
      metadata: (val: any) => Effect.sync(() => void snapshots.push(val.metadata)),
    }
    await Effect.runPromise(
      tool.execute({ code: "await tools.fixtures.add({ a: 1, b: 2 }); return 'done'" }, recordingCtx),
    )
    expect(snapshots).toContainEqual({
      toolCalls: [{ tool: "fixtures.add", status: "running", input: { a: 1, b: 2 } }],
    })
    expect(snapshots).toContainEqual({
      toolCalls: [{ tool: "fixtures.add", status: "completed", input: { a: 1, b: 2 } }],
    })
  })
})
