import { describe, expect, test } from "bun:test"
import {
  Parameters,
  define,
  describe as describeTools,
  formatValue,
  groupByServer,
  rankTools,
  toEnvelope,
  type SearchEntry,
} from "@/session/code-mode"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
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
function build(mcpTools: Record<string, AITool>, defs: Record<string, MCPToolDef> = {}, servers?: string[]) {
  const names = servers ?? [...new Set(Object.keys(mcpTools).map((key) => key.split("_")[0]!))]
  return Effect.runPromise(define(mcpTools, defs, names).pipe(Effect.flatMap(Tool.init), Effect.provide(layer)))
}

describe("code mode execute", () => {
  test("defines execute input with an Effect schema", async () => {
    const decode = Schema.decodeUnknownEffect(Parameters)
    await expect(Effect.runPromise(decode({ code: "return 1" }))).resolves.toEqual({ code: "return 1" })
    await expect(Effect.runPromise(decode({}))).rejects.toThrow()
  })

  test("lists all namespaces, previews tools within budget, and documents discovery", () => {
    const groups = groupByServer(
      {
        github_create_issue: mcpTool("create_issue", () => ""),
        github_list_issues: mcpTool("list_issues", () => ""),
        linear_search: mcpTool("search", () => ""),
      },
      ["github", "linear"],
    )
    const description = describeTools(groups)

    expect(description).toContain("tools.search(query")
    expect(description).toContain("tools.describe(path)")
    expect(description).toContain("- github (2 tools)")
    expect(description).toContain("- linear (1 tool)")
    // Small catalog: individual tools are previewed inline as `<server>.<tool>`.
    expect(description).toContain("github.create_issue")
    expect(description).toContain("linear.search")
    // ...but never full signatures (those come from tools.describe).
    expect(description).not.toContain("): Promise<")
  })

  test("falls back to namespaces-only when the catalog exceeds the preview budget", () => {
    const tools: Record<string, AITool> = {}
    const longDesc = "performs a meaningful operation against the service with several options"
    for (let i = 0; i < 60; i++) {
      tools[`alpha_op_${i}`] = mcpTool(`op_${i}`, () => "", { type: "object", properties: {} })
      ;(tools[`alpha_op_${i}`] as any).description = longDesc
    }
    tools["zeta_only_tool"] = mcpTool("only_tool", () => "")
    const groups = groupByServer(tools, ["alpha", "zeta"])
    const description = describeTools(groups)

    // Every namespace is always present, with counts.
    expect(description).toContain("- alpha (60 tools)")
    expect(description).toContain("- zeta (1 tool)")
    // The preview is budget-capped, so the later namespace's tools are not all inlined.
    expect(description).not.toContain("zeta.only_tool")
    // Some early tools are still previewed.
    expect(description).toContain("alpha.op_0")
  })

  test("tools.search and tools.describe expose the catalog on demand", async () => {
    const tool = await build({
      github_create_issue: mcpTool("create_issue", () => "", {
        type: "object",
        properties: { title: { type: "string" }, body: { type: "string" } },
        required: ["title"],
      }),
      github_list_issues: mcpTool("list_issues", () => ""),
      linear_search: mcpTool("search", () => ""),
    })

    const searched = await Effect.runPromise(
      tool.execute({ code: "return await tools.search('issue', { namespace: 'github' })" }, ctx),
    )
    const search = JSON.parse(searched.output)
    expect(search.total).toBe(2)
    expect(search.items.map((i: any) => i.path).sort()).toEqual(["github.create_issue", "github.list_issues"])

    const described = await Effect.runPromise(
      tool.execute({ code: "return await tools.describe('github.create_issue')" }, ctx),
    )
    const desc = JSON.parse(described.output)
    expect(desc.path).toBe("github.create_issue")
    expect(desc.signature).toBe(
      "tools.github.create_issue(input: { title: string; body?: string }): Promise<{ result: unknown; attachments?: Attachment[] }>",
    )

    const missing = await Effect.runPromise(tool.execute({ code: "return await tools.describe('github.nope')" }, ctx))
    expect(JSON.parse(missing.output).error.code).toBe("tool_not_found")
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
      tool.execute({ code: "const r = await tools.greeter.hello({ name: 'world' }); return r.result.toUpperCase()" }, ctx),
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
            const second = await tools.math.add({ a: first.result.sum, b: 10 })
            return { total: second.result.sum }
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
        { code: "const [a, b] = await Promise.all([tools.echo.one({}), tools.echo.two({})]); return a.result + b.result" },
        ctx,
      ),
    )

    expect(output.output).toBe("12")
    expect(output.metadata.toolCalls.sort()).toEqual(["echo_one", "echo_two"])
  })

  test("returns a readable error when the program throws", async () => {
    const tool = await build({})
    const output = await Effect.runPromise(tool.execute({ code: "throw new Error('boom')" }, ctx))
    expect(output.output).toBe("Uncaught: boom")
    expect(output.metadata.error).toBe(true)
  })

  test("reports an unknown tool and points to discovery", async () => {
    const tool = await build({ known_tool: mcpTool("tool", () => "ok") })
    const output = await Effect.runPromise(tool.execute({ code: "return await tools.known.missing({})" }, ctx))
    expect(output.metadata.error).toBe(true)
    expect(output.output).toContain("Unknown tool 'known.missing'")
    expect(output.output).toContain("tools.search")
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

  test("unit: toEnvelope wraps result and extracts media as attachments", () => {
    expect(toEnvelope({ structuredContent: { x: 1 }, content: [] })).toEqual({ result: { x: 1 } })
    expect(toEnvelope({ content: [{ type: "text", text: "hi" }] })).toEqual({ result: "hi" })
    expect(toEnvelope("raw")).toEqual({ result: "raw" })

    // image/audio blocks become data-URL file attachments; text stays in result
    expect(
      toEnvelope({
        content: [
          { type: "text", text: "see image" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
        ],
      }),
    ).toEqual({
      result: "see image",
      attachments: [{ type: "file", mime: "image/png", url: "data:image/png;base64,AAAA" }],
    })

    // media-only result has an undefined result but still surfaces the attachment
    expect(toEnvelope({ content: [{ type: "image", data: "BBBB", mimeType: "image/jpeg" }] })).toEqual({
      result: undefined,
      attachments: [{ type: "file", mime: "image/jpeg", url: "data:image/jpeg;base64,BBBB" }],
    })
  })

  test("unit: formatValue", () => {
    expect(formatValue("text")).toBe("text")
    expect(formatValue({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2))
    expect(formatValue(undefined)).toBe("undefined")
  })

  test("terminates a runaway loop via the operation limit instead of hanging", async () => {
    const tool = await build({})
    const output = await Effect.runPromise(tool.execute({ code: "while (true) {}" }, ctx))
    expect(output.metadata.error).toBe(true)
    expect(output.output.toLowerCase()).toContain("operation")
  })

  test("isolates the sandbox from host globals", async () => {
    const tool = await build({})
    const output = await Effect.runPromise(tool.execute({ code: "return process.env" }, ctx))
    expect(output.metadata.error).toBe(true)
  })

  test("describe shows the structured return type when the tool declares an outputSchema", async () => {
    const tools = { weather_current: mcpTool("current", () => "", { type: "object", properties: { city: { type: "string" } } }) }
    const defs: Record<string, MCPToolDef> = {
      weather_current: {
        name: "current",
        inputSchema: { type: "object", properties: { city: { type: "string" } } },
        outputSchema: { type: "object", properties: { tempC: { type: "number" }, summary: { type: "string" } }, required: ["tempC"] },
      } as any,
    }
    const tool = await build(tools, defs)
    const described = await Effect.runPromise(tool.execute({ code: "return await tools.describe('weather.current')" }, ctx))
    const desc = JSON.parse(described.output)
    expect(desc.signature).toBe(
      "tools.weather.current(input: { city?: string }): Promise<{ result: { tempC: number; summary?: string }; attachments?: Attachment[] }>",
    )
    expect(desc.outputSchema).toBeDefined()
  })

  test("forwards attachments from a returned tool result and drops them when only .result is returned", async () => {
    const tool = await build({
      shot_take: mcpTool("take", () => ({
        content: [{ type: "image", data: "PNGDATA", mimeType: "image/png" }],
        structuredContent: { name: "shot.png" },
      })),
    })

    const forwarded = await Effect.runPromise(tool.execute({ code: "return await tools.shot.take({})" }, ctx))
    expect(forwarded.attachments).toEqual([{ type: "file", mime: "image/png", url: "data:image/png;base64,PNGDATA" }])
    expect(JSON.parse(forwarded.output)).toEqual({ name: "shot.png" })

    const suppressed = await Effect.runPromise(
      tool.execute({ code: "const r = await tools.shot.take({}); return { result: r.result }" }, ctx),
    )
    expect(suppressed.attachments).toBeUndefined()
    expect(JSON.parse(suppressed.output)).toEqual({ name: "shot.png" })
  })

  test("indexes parameter names so tools are searchable by their inputs", async () => {
    const tool = await build({
      // The query word appears only as a parameter name, not in path or description.
      traces_lookup: mcpTool("lookup", () => "", {
        type: "object",
        properties: { trace_id: { type: "string", description: "the distributed trace identifier" } },
      }),
      other_noop: mcpTool("noop", () => ""),
    })
    const out = await Effect.runPromise(tool.execute({ code: "return await tools.search('trace_id')" }, ctx))
    const result = JSON.parse(out.output)
    expect(result.items.map((i: any) => i.path)).toEqual(["traces.lookup"])
  })
})

describe("rankTools", () => {
  const E = (path: string, description: string, params = ""): SearchEntry => ({
    path,
    server: path.split(".")[0]!,
    description,
    searchText: [path, description, params].join("\n").toLowerCase(),
  })

  test("matches multiple non-contiguous terms (not just a contiguous substring)", () => {
    const entries = [
      E("github.create_issue", "Create a new issue on a repository"),
      E("github.list_pulls", "List pull requests"),
    ]
    const { items, total } = rankTools(entries, "create issue")
    expect(total).toBe(1)
    expect(items[0]!.path).toBe("github.create_issue")
  })

  test("ranks an exact tool-name match above a substring match", () => {
    const entries = [E("github.search_issues", "Search issues"), E("github.search", "Full text search")]
    const { items } = rankTools(entries, "search")
    expect(items[0]!.path).toBe("github.search")
  })

  test("ranks a name match above a description-only match", () => {
    const entries = [
      E("datadog.list_monitors", "Enumerate alerting definitions"),
      E("datadog.get_dashboard", "List the monitors on a dashboard"),
    ]
    const { items } = rankTools(entries, "monitors")
    expect(items[0]!.path).toBe("datadog.list_monitors")
  })

  test("matches against indexed parameter text", () => {
    const entries = [E("traces.lookup", "Fetch a span", "trace_id the distributed trace id"), E("other.noop", "Does nothing")]
    const { items, total } = rankTools(entries, "trace_id")
    expect(total).toBe(1)
    expect(items[0]!.path).toBe("traces.lookup")
  })

  test("respects the namespace filter", () => {
    const entries = [E("github.search", "search"), E("linear.search", "search")]
    const { items, total } = rankTools(entries, "search", "linear")
    expect(total).toBe(1)
    expect(items[0]!.path).toBe("linear.search")
  })

  test("an empty query (or bare wildcard) lists everything alphabetically", () => {
    const entries = [E("b.two", "second"), E("a.one", "first")]
    for (const q of ["", "*"]) {
      const { items, total } = rankTools(entries, q)
      expect(total).toBe(2)
      expect(items.map((i) => i.path)).toEqual(["a.one", "b.two"])
    }
  })

  test("honors the limit while reporting the full match total", () => {
    const entries = Array.from({ length: 10 }, (_, i) => E(`s.tool_${i}`, "searchable tool"))
    const { items, total } = rankTools(entries, "searchable", undefined, 3)
    expect(total).toBe(10)
    expect(items).toHaveLength(3)
  })

  test("returns nothing when no term matches", () => {
    const entries = [E("github.search", "search")]
    expect(rankTools(entries, "nonexistent")).toEqual({ items: [], total: 0 })
  })
})
