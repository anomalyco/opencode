import { describe, expect, test } from "bun:test"
import { Parameters, define, describe as describeTools, formatValue, groupByServer, toolResultValue } from "@/session/code-mode"
import { Agent } from "@/agent/agent"
import { Tool } from "@/tool/tool"
import * as Truncate from "@/tool/truncate"
import { McpCatalog } from "@/mcp/catalog"
import { MessageID, SessionID } from "@/session/schema"
import type { Tool as AITool } from "ai"
import { Effect, Layer, Schema } from "effect"

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_code-mode"),
  messageID: MessageID.make("msg_code-mode"),
  agent: "build",
  abort: new AbortController().signal,
  callID: "call_code_mode",
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

// Build a real MCP-derived AI SDK tool over a fake transport, so the proxy exercises
// the same `convertTool` execution path that `mcp.tools()` produces at runtime.
function mcpTool(
  name: string,
  handler: (args: Record<string, unknown>) => unknown,
  inputSchema: Record<string, unknown> = { type: "object", properties: {} },
): AITool {
  const client = {
    callTool: async (params: { arguments?: Record<string, unknown> }) => handler(params.arguments ?? {}),
  }
  return McpCatalog.convertTool({ name, description: name, inputSchema } as any, client as any)
}

// Truncate echoes its input so assertions read the exact program output. Agent.get is
// only consulted by the shared wrapper during truncation.
const layer = Layer.mergeAll(
  Layer.mock(Truncate.Service, {
    output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
  }),
  Layer.succeed(Agent.Service, Agent.Service.of({ get: () => Effect.succeed({ name: "build" } as any) } as any)),
)

// Derive sanitized server namespaces from the catalog keys, mirroring how
// session/tools.ts passes `Object.keys(mcp.clients()).map(sanitize)`.
function build(mcpTools: Record<string, AITool>, servers?: string[]) {
  const names = servers ?? [...new Set(Object.keys(mcpTools).map((key) => key.split("_")[0]!))]
  return Effect.runPromise(define(mcpTools, names).pipe(Effect.flatMap(Tool.init), Effect.provide(layer)))
}

describe("code mode execute", () => {
  test("defines execute input with an Effect schema", async () => {
    const decode = Schema.decodeUnknownEffect(Parameters)
    await expect(Effect.runPromise(decode({ code: "return 1" }))).resolves.toEqual({ code: "return 1" })
    await expect(Effect.runPromise(decode({}))).rejects.toThrow()
  })

  test("describes tools grouped into per-server namespaces with signatures", () => {
    const description = describeTools(
      groupByServer(
        {
          github_create_issue: mcpTool("create_issue", () => "", {
            type: "object",
            properties: { title: { type: "string" }, body: { type: "string" } },
            required: ["title"],
          }),
          linear_search: mcpTool("search", () => ""),
        },
        ["github", "linear"],
      ),
    )

    expect(description).toContain("await tools.<server>.<tool>(input)")
    expect(description).toContain("// github")
    expect(description).toContain("tools.github.create_issue({ title: string; body?: string })")
    expect(description).toContain("// linear")
    expect(description).toContain("tools.linear.search")
  })

  test("groups multi-underscore server names by longest matching prefix", () => {
    const groups = groupByServer({ my_server_do_thing: mcpTool("do_thing", () => "") }, ["my_server"])
    expect([...groups.keys()]).toEqual(["my_server"])
    expect(groups.get("my_server")![0]).toMatchObject({ local: "do_thing", key: "my_server_do_thing" })
  })

  test("runs plain JavaScript and returns the value as text", async () => {
    const tool = await build({})
    const output = await Effect.runPromise(tool.execute({ code: "return 1 + 2" }, ctx))
    expect(output.output).toBe("3")
    expect(output.metadata.toolCalls).toEqual([])
  })

  test("calls a namespaced MCP tool and flows its text result back into the program", async () => {
    const seen: Record<string, unknown>[] = []
    const tool = await build({
      greeter_hello: mcpTool("hello", (args) => {
        seen.push(args)
        return { content: [{ type: "text", text: `hello ${args.name}` }] }
      }),
    })

    const output = await Effect.runPromise(
      tool.execute({ code: "const r = await tools.greeter.hello({ name: 'world' }); return r.toUpperCase()" }, ctx),
    )

    expect(seen).toEqual([{ name: "world" }])
    expect(output.output).toBe("HELLO WORLD")
    expect(output.metadata.toolCalls).toEqual(["greeter_hello"])
  })

  test("exposes structured content as data and composes multiple calls", async () => {
    const tool = await build({
      math_add: mcpTool("add", (args) => ({
        content: [],
        structuredContent: { sum: (args.a as number) + (args.b as number) },
      })),
    })

    const output = await Effect.runPromise(
      tool.execute(
        {
          code: `
            const first = await tools.math.add({ a: 1, b: 2 })
            const second = await tools.math.add({ a: first.sum, b: 10 })
            return { total: second.sum }
          `,
        },
        ctx,
      ),
    )

    expect(JSON.parse(output.output)).toEqual({ total: 13 })
    expect(output.metadata.toolCalls).toEqual(["math_add", "math_add"])
  })

  test("runs tool calls in parallel with Promise.all", async () => {
    const tool = await build({
      echo_one: mcpTool("one", () => ({ content: [{ type: "text", text: "1" }] })),
      echo_two: mcpTool("two", () => ({ content: [{ type: "text", text: "2" }] })),
    })

    const output = await Effect.runPromise(
      tool.execute(
        { code: "const [a, b] = await Promise.all([tools.echo.one({}), tools.echo.two({})]); return a + b" },
        ctx,
      ),
    )

    expect(output.output).toBe("12")
    expect(output.metadata.toolCalls.sort()).toEqual(["echo_one", "echo_two"])
  })

  test("returns a readable error when the program throws", async () => {
    const tool = await build({})
    const output = await Effect.runPromise(tool.execute({ code: "throw new Error('boom')" }, ctx))
    expect(output.output).toBe("boom")
    expect(output.metadata.error).toBe(true)
  })

  test("reports an unknown tool with the available names", async () => {
    const tool = await build({ known_tool: mcpTool("tool", () => "ok") })
    const output = await Effect.runPromise(tool.execute({ code: "return await tools.known.missing({})" }, ctx))
    expect(output.metadata.error).toBe(true)
    expect(output.output).toContain("Unknown tool 'tools.known.missing'")
    expect(output.output).toContain("known_tool")
  })

  test("propagates an MCP tool error into the program", async () => {
    const tool = await build({
      bad_tool: mcpTool("tool", () => ({ isError: true, content: [{ type: "text", text: "server exploded" }] })),
    })
    const output = await Effect.runPromise(
      tool.execute(
        { code: "try { await tools.bad.tool({}) } catch (e) { return 'caught: ' + e.message }" },
        ctx,
      ),
    )
    expect(output.output).toBe("caught: server exploded")
  })

  test("asks permission before each child tool call", async () => {
    const asked: unknown[] = []
    const permissionCtx: Tool.Context = { ...ctx, ask: (req) => Effect.sync(() => void asked.push(req)) }
    const ok = () => ({ content: [{ type: "text", text: "ok" }] })
    const tool = await build({ a_tool: mcpTool("a", ok), b_tool: mcpTool("b", ok) })

    await Effect.runPromise(
      tool.execute({ code: "await tools.a.tool({}); await tools.b.tool({}); return 'done'" }, permissionCtx),
    )

    expect(asked.map((req: any) => req.permission)).toEqual(["a_tool", "b_tool"])
  })

  test("unit: toolResultValue and formatValue", () => {
    expect(toolResultValue({ structuredContent: { x: 1 }, content: [] })).toEqual({ x: 1 })
    expect(toolResultValue({ content: [{ type: "text", text: "hi" }] })).toBe("hi")
    expect(toolResultValue("raw")).toBe("raw")
    expect(formatValue("text")).toBe("text")
    expect(formatValue({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2))
    expect(formatValue(undefined)).toBe("undefined")
  })
})
