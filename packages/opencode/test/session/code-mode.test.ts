import { describe, expect, test } from "bun:test"
import {
  Parameters,
  attachmentTable,
  define,
  describe as describeTools,
  formatValue,
  groupByServer,
  rankTools,
  renderType,
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

  test("lists all namespaces, previews tool signatures within budget, and documents discovery", () => {
    const groups = groupByServer(
      {
        github_create_issue: mcpTool("create_issue", () => "", {
          type: "object",
          properties: { title: { type: "string" }, body: { type: "string" } },
          required: ["title"],
        }),
        github_list_issues: mcpTool("list_issues", () => ""),
        linear_search: mcpTool("search", () => ""),
      },
      ["github", "linear"],
    )
    const description = describeTools(groups)

    expect(description).toContain("tools.$rune.search(query")
    expect(description).toContain("tools.$rune.describe(path)")
    // Small catalog: the list is comprehensive and says so, with clean counts.
    expect(description).toContain("This is the COMPLETE list")
    expect(description).toContain("- github (2 tools)")
    expect(description).toContain("- linear (1 tool)")
    // Tools are previewed inline as directly-callable signatures that now include the
    // awaited return type (Result<T>) so the model sees the result shape up front.
    expect(description).toContain("tools.github.create_issue(input: { title: string; body?: string }): Result<unknown>")
    expect(description).toContain("tools.linear.search(input: object): Result<unknown>")
    // The Result<T> envelope alias is defined once in the prose.
    expect(description).toContain("type Result<T> = { result: T; attachments?: Attachment[] }")
    // ...but the preview drops the uniform Promise<…> wrapper — that full form comes from describe.
    expect(description).not.toContain("): Promise<")
  })

  test("falls back to namespaces-only when the catalog exceeds the preview budget", () => {
    const tools: Record<string, AITool> = {}
    for (let i = 0; i < 60; i++) {
      tools[`alpha_op_${i}`] = mcpTool(`op_${i}`, () => "", {
        type: "object",
        properties: { value: { type: "string" }, count: { type: "number" } },
      })
    }
    tools["zeta_only_tool"] = mcpTool("only_tool", () => "")
    const groups = groupByServer(tools, ["alpha", "zeta"])
    const description = describeTools(groups)

    // The list states it is partial, and every namespace is still present with its total.
    expect(description).toContain("This is a PARTIAL list")
    expect(description).toContain("- alpha (60 tools")
    // The later namespace is fully truncated, and says so.
    expect(description).toContain("- zeta (1 tool, none shown)")
    expect(description).not.toContain("tools.zeta.only_tool(")
    // Some early signatures are still previewed.
    expect(description).toContain("tools.alpha.op_0(")
  })

  test("tools.$rune.search and tools.$rune.describe expose the catalog on demand", async () => {
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
      tool.execute({ code: "return await tools.$rune.search('issue', { namespace: 'github' })" }, ctx),
    )
    const search = JSON.parse(searched.output)
    expect(search.total).toBe(2)
    expect(search.items.map((i: any) => i.path).sort()).toEqual(["github.create_issue", "github.list_issues"])
    expect(searched.metadata.toolCalls).toEqual([
      { tool: "$rune.search", status: "completed", input: { query: "issue", namespace: "github" } },
    ])

    const described = await Effect.runPromise(
      tool.execute({ code: "return await tools.$rune.describe('github.create_issue')" }, ctx),
    )
    const desc = JSON.parse(described.output)
    expect(desc.path).toBe("github.create_issue")
    expect(desc.signature).toBe(
      "tools.github.create_issue(input: { title: string; body?: string }): Promise<Result<unknown>>",
    )
    expect(described.metadata.toolCalls).toEqual([
      { tool: "$rune.describe", status: "completed", input: { path: "github.create_issue" } },
    ])

    const missing = await Effect.runPromise(tool.execute({ code: "return await tools.$rune.describe('github.nope')" }, ctx))
    expect(JSON.parse(missing.output).error.code).toBe("tool_not_found")
    expect(missing.metadata.toolCalls).toEqual([
      { tool: "$rune.describe", status: "completed", input: { path: "github.nope" } },
    ])
  })

  test("describe resolves a tool path regardless of separator (dot, slash, or underscore)", async () => {
    const tool = await build({ "context7_resolve-library-id": mcpTool("resolve-library-id", () => "") })
    for (const path of ["context7.resolve-library-id", "context7/resolve-library-id", "context7_resolve-library-id"]) {
      const described = await Effect.runPromise(tool.execute({ code: `return await tools.$rune.describe(${JSON.stringify(path)})` }, ctx))
      expect(JSON.parse(described.output).path).toBe("context7.resolve-library-id")
    }
  })

  test("describe suggests the real tool for a mistyped path (did-you-mean)", async () => {
    const tool = await build({ "context7_resolve-library-id": mcpTool("resolve-library-id", () => "") })
    // Wrong leaf within the right namespace falls back to a namespace-scoped search.
    const missing = await Effect.runPromise(
      tool.execute({ code: "return await tools.$rune.describe('context7/resolve-library')" }, ctx),
    )
    const error = JSON.parse(missing.output).error
    expect(error.code).toBe("tool_not_found")
    expect(error.suggestions).toContain("context7.resolve-library-id")
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
    expect(output.metadata.toolCalls).toEqual([{ tool: "greeter.hello", status: "completed", input: { name: "world" } }])
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
    expect(output.metadata.toolCalls).toEqual([
      { tool: "math.add", status: "completed", input: { a: 1, b: 2 } },
      { tool: "math.add", status: "completed", input: { a: 3, b: 10 } },
    ])
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
    expect(output.metadata.toolCalls.map((c) => c.tool).sort()).toEqual(["echo.one", "echo.two"])
    expect(output.metadata.toolCalls.every((c) => c.status === "completed")).toBe(true)
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
    expect(output.output).toContain("tools.$rune.search")
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

  test("streams live per-call metadata as a call starts and finishes", async () => {
    const snapshots: Array<{ toolCalls: { tool: string; status: string; input?: Record<string, unknown> }[] }> = []
    const recordingCtx: Tool.Context = {
      ...ctx,
      metadata: (val: any) => Effect.sync(() => void snapshots.push(val.metadata)),
    }
    const tool = await build({ greeter_hello: mcpTool("hello", () => ({ content: [{ type: "text", text: "hi" }] })) })

    await Effect.runPromise(tool.execute({ code: "await tools.greeter.hello({ name: 'Ada' }); return 'done'" }, recordingCtx))

    // The UI sees the call appear as running, then resolve to completed.
    expect(snapshots).toContainEqual({ toolCalls: [{ tool: "greeter.hello", status: "running", input: { name: "Ada" } }] })
    expect(snapshots).toContainEqual({ toolCalls: [{ tool: "greeter.hello", status: "completed", input: { name: "Ada" } }] })
  })

  test("streams discovery helpers with the same per-call metadata shape", async () => {
    const snapshots: Array<{ toolCalls: { tool: string; status: string; input?: Record<string, unknown> }[] }> = []
    const recordingCtx: Tool.Context = {
      ...ctx,
      metadata: (val: any) => Effect.sync(() => void snapshots.push(val.metadata)),
    }
    const tool = await build({ github_create_issue: mcpTool("create_issue", () => "") })

    await Effect.runPromise(
      tool.execute(
        {
          code: `
            await tools.$rune.search('issue', { namespace: 'github' })
            await tools.$rune.describe('github.create_issue')
            return 'done'
          `,
        },
        recordingCtx,
      ),
    )

    expect(snapshots).toContainEqual({
      toolCalls: [{ tool: "$rune.search", status: "running", input: { query: "issue", namespace: "github" } }],
    })
    expect(snapshots).toContainEqual({
      toolCalls: [
        { tool: "$rune.search", status: "completed", input: { query: "issue", namespace: "github" } },
        { tool: "$rune.describe", status: "completed", input: { path: "github.create_issue" } },
      ],
    })
  })

  test("marks a failed child call as error in the live metadata", async () => {
    const snapshots: Array<{ toolCalls: { tool: string; status: string; input?: Record<string, unknown> }[] }> = []
    const recordingCtx: Tool.Context = {
      ...ctx,
      metadata: (val: any) => Effect.sync(() => void snapshots.push(val.metadata)),
    }
    const tool = await build({
      bad_tool: mcpTool("tool", () => ({ isError: true, content: [{ type: "text", text: "boom" }] })),
    })

    await Effect.runPromise(
      tool.execute({ code: "try { await tools.bad.tool({ reason: 'test' }) } catch (e) { return 'caught' }" }, recordingCtx),
    )

    expect(snapshots).toContainEqual({ toolCalls: [{ tool: "bad.tool", status: "error", input: { reason: "test" } }] })
  })

  test("unit: toEnvelope wraps result and extracts media as opaque attachment handles", () => {
    const table = attachmentTable()
    expect(toEnvelope({ structuredContent: { x: 1 }, content: [] }, table.seal)).toEqual({ result: { x: 1 } })
    expect(toEnvelope({ content: [{ type: "text", text: "hi" }] }, table.seal)).toEqual({ result: "hi" })
    expect(toEnvelope("raw", table.seal)).toEqual({ result: "raw" })

    // image/audio blocks become OPAQUE handles (mime/bytes, NO url/data); text stays in result
    const withImage = toEnvelope(
      {
        content: [
          { type: "text", text: "see image" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
        ],
      },
      table.seal,
    )
    expect(withImage.result).toBe("see image")
    expect(withImage.attachments).toEqual([{ type: "file", id: "att_1", mime: "image/png", bytes: 3 }])
    // The handle exposes no bytes, but resolves back to the real attachment host-side.
    expect((withImage.attachments![0] as any).url).toBeUndefined()
    expect(table.resolve(withImage.attachments![0])).toEqual({
      type: "file",
      mime: "image/png",
      url: "data:image/png;base64,AAAA",
    })

    // media-only result: undefined result, still surfaces the handle
    const mediaOnly = toEnvelope({ content: [{ type: "image", data: "BBBB", mimeType: "image/jpeg" }] }, table.seal)
    expect(mediaOnly.result).toBeUndefined()
    expect(mediaOnly.attachments).toEqual([{ type: "file", id: "att_2", mime: "image/jpeg", bytes: 3 }])
  })

  test("unit: attachmentTable resolve drops fabricated or stale handles", () => {
    const table = attachmentTable()
    expect(table.resolve({ type: "file", id: "att_999", mime: "image/png" })).toBeUndefined()
    expect(table.resolve({ type: "file" })).toBeUndefined()
    expect(table.resolve("nope")).toBeUndefined()
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
    const described = await Effect.runPromise(tool.execute({ code: "return await tools.$rune.describe('weather.current')" }, ctx))
    const desc = JSON.parse(described.output)
    expect(desc.signature).toBe(
      "tools.weather.current(input: { city?: string }): Promise<Result<{ tempC: number; summary?: string }>>",
    )
    // describe now returns the return shape as pretty TypeScript, not raw JSON Schema.
    expect(desc.output).toBe("{\n  tempC: number\n  summary?: string\n}")
    expect(desc.outputSchema).toBeUndefined()
  })

  test("describe returns the input type as TypeScript with JSDoc and enum literals", async () => {
    const tool = await build({
      docs_resolve: mcpTool("resolve", () => "", {
        type: "object",
        properties: {
          library: { type: "string", description: "The library name to resolve" },
          kind: { enum: ["react", "vue"] },
        },
        required: ["library"],
      }),
    })
    const described = await Effect.runPromise(tool.execute({ code: "return await tools.$rune.describe('docs.resolve')" }, ctx))
    const desc = JSON.parse(described.output)
    expect(desc.input).toBe(
      '{\n  /** The library name to resolve */\n  library: string\n  kind?: "react" | "vue"\n}',
    )
    expect(desc.inputSchema).toBeUndefined()
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
    const out = await Effect.runPromise(tool.execute({ code: "return await tools.$rune.search('trace_id')" }, ctx))
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

describe("renderType", () => {
  test("renders primitives, integers, and arrays", () => {
    expect(renderType({ type: "string" })).toBe("string")
    expect(renderType({ type: "integer" })).toBe("number")
    expect(renderType({ type: "array", items: { type: "string" } })).toBe("string[]")
  })

  test("renders enums and const as literal types", () => {
    expect(renderType({ enum: ["a", "b", "c"] })).toBe('"a" | "b" | "c"')
    expect(renderType({ const: 42 })).toBe("42")
  })

  test("renders a nullable type array as a union (does not drop null)", () => {
    expect(renderType({ type: ["string", "null"] })).toBe("string | null")
  })

  test("parenthesizes a union inside an array", () => {
    expect(renderType({ type: "array", items: { type: ["string", "null"] } })).toBe("(string | null)[]")
  })

  test("renders additionalProperties as an index signature", () => {
    expect(renderType({ type: "object", additionalProperties: { type: "number" } })).toBe("{ [key: string]: number }")
    expect(renderType({ type: "object", additionalProperties: true })).toBe("{ [key: string]: any }")
  })

  test("resolves a local $ref against the document root", () => {
    const schema = {
      type: "object",
      properties: { node: { $ref: "#/$defs/Node" } },
      required: ["node"],
      $defs: { Node: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    } as any
    expect(renderType(schema)).toBe("{ node: { id: string } }")
  })

  test("collapses a self-referential $ref to its name instead of looping", () => {
    const schema = {
      $defs: { Node: { type: "object", properties: { next: { $ref: "#/$defs/Node" } } } },
      $ref: "#/$defs/Node",
    } as any
    // Must terminate; the recursive position falls back to the ref name.
    expect(renderType(schema)).toBe("{ next?: Node }")
  })

  test("pretty mode emits an indented block with JSDoc for described fields", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", description: "The library name to resolve" },
        kind: { enum: ["lib", "app"] },
      },
      required: ["name"],
    } as any
    expect(renderType(schema, { pretty: true })).toBe(
      '{\n  /** The library name to resolve */\n  name: string\n  kind?: "lib" | "app"\n}',
    )
  })

  test("renders anyOf / oneOf as a union", () => {
    expect(renderType({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe("string | number")
    expect(renderType({ oneOf: [{ const: "a" }, { const: "b" }] })).toBe('"a" | "b"')
  })

  test("empty enum / anyOf / type arrays render as never, not an empty string", () => {
    expect(renderType({ enum: [] })).toBe("never")
    expect(renderType({ anyOf: [] })).toBe("never")
    expect(renderType({ type: [] as any })).toBe("never")
  })

  test("renders a tuple's first item type", () => {
    expect(renderType({ type: "array", items: [{ type: "string" }, { type: "number" }] as any })).toBe("string[]")
  })

  test("combines named properties with an additionalProperties index signature", () => {
    const schema = {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: { type: "number" },
    } as any
    expect(renderType(schema)).toBe("{ id: string; [key: string]: number }")
  })

  test("quotes non-identifier property names", () => {
    const schema = { type: "object", properties: { "content-type": { type: "string" } } } as any
    expect(renderType(schema)).toBe('{ "content-type"?: string }')
  })

  test("nests pretty objects with increasing indentation", () => {
    const schema = {
      type: "object",
      properties: { outer: { type: "object", properties: { inner: { type: "string" } }, required: ["inner"] } },
      required: ["outer"],
    } as any
    expect(renderType(schema, { pretty: true })).toBe("{\n  outer: {\n    inner: string\n  }\n}")
  })

  test("resolves mutually recursive $refs without looping", () => {
    const schema = {
      $ref: "#/$defs/A",
      $defs: {
        A: { type: "object", properties: { b: { $ref: "#/$defs/B" } } },
        B: { type: "object", properties: { a: { $ref: "#/$defs/A" } } },
      },
    } as any
    // A -> B -> A: the second A is on the resolution path, so it collapses to its name.
    expect(renderType(schema)).toBe("{ b?: { a?: A } }")
  })

  test("preserves a multi-line description as a multi-line JSDoc block", () => {
    const schema = {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query.\nSupports globs.\n\nExamples: *.ts" },
      },
      required: ["query"],
    } as any
    expect(renderType(schema, { pretty: true })).toBe(
      "{\n  /**\n   * The search query.\n   * Supports globs.\n   *\n   * Examples: *.ts\n   */\n  query: string\n}",
    )
  })

  test("emits JSDoc tags for schema constraints TypeScript can't express", () => {
    const schema = {
      type: "object",
      properties: {
        when: { type: "string", format: "date-time", default: "now", description: "start time" },
        legacy: { type: "boolean", deprecated: true },
        tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      },
      required: ["when"],
    } as any
    expect(renderType(schema, { pretty: true })).toBe(
      [
        "{",
        "  /**",
        "   * start time",
        '   * @default "now"',
        "   * @format date-time",
        "   */",
        "  when: string",
        "  /** @deprecated */",
        "  legacy?: boolean",
        "  /**",
        "   * @minItems 1",
        "   * @maxItems 5",
        "   */",
        "  tags?: string[]",
        "}",
      ].join("\n"),
    )
  })

  test("neutralizes a comment terminator inside a JSDoc description", () => {
    const schema = { type: "object", properties: { x: { type: "string", description: "danger */ oops" } } } as any
    const out = renderType(schema, { pretty: true })
    expect(out).toContain("/** danger * / oops */")
    expect(out).not.toContain("*/ oops")
  })

  test("is total on a self-referential union (never throws)", () => {
    const a: any = { anyOf: [] }
    a.anyOf.push(a) // structural cycle with no $ref
    expect(() => renderType(a)).not.toThrow()
  })

  test("unwraps the Pydantic allOf: [{ $ref }] shape with sibling description", () => {
    const schema = {
      type: "object",
      properties: {
        config: { allOf: [{ $ref: "#/$defs/Config" }], description: "the config block" },
      },
      required: ["config"],
      $defs: { Config: { type: "object", properties: { level: { type: "integer" } }, required: ["level"] } },
    } as any
    expect(renderType(schema)).toBe("{ config: { level: number } }")
  })

  test("renders multi-member allOf as an intersection", () => {
    const schema = {
      allOf: [
        { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        { type: "object", properties: { b: { type: "number" } }, required: ["b"] },
      ],
    } as any
    expect(renderType(schema)).toBe("{ a: string } & { b: number }")
  })

  test("renders a base object's properties even when it also carries a require-one-of anyOf", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      anyOf: [{ required: ["a"] }, { required: ["b"] }],
    } as any
    expect(renderType(schema)).toBe("{ a?: string; b?: string }")
  })
})
