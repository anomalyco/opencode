import { describe, expect, test } from "bun:test"
import {
  CODE_MODE_TOOL,
  CodeModeTool,
  Parameters,
  catalogInstructions,
  formatValue,
  groupByServer,
  toSandboxResult,
  withLogs,
  type Attachment,
} from "@/tool/code-mode"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Session } from "@/session/session"
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

// Build a real MCP-derived AI SDK tool over a fake transport, so the adapter exercises
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
// consulted by the shared wrapper during truncation AND at execute time for the
// permission ruleset that filters the dispatchable tool tree; Session.get supplies the
// (empty) session-level ruleset half of that merge. Plugin.trigger defaults to the
// pass-through the real service uses when no plugin implements a hook; tests observing
// or failing hooks override it.
function harness(input: {
  mcpTools: Record<string, AITool>
  defs?: Record<string, MCPToolDef>
  servers: string[]
  permission?: PermissionV1.Rule[]
  trigger?: Plugin.Interface["trigger"]
}) {
  return Layer.mergeAll(
    Layer.mock(Plugin.Service, {
      trigger: input.trigger ?? (((_name, _input, output) => Effect.succeed(output)) as Plugin.Interface["trigger"]),
    }),
    Layer.mock(Truncate.Service, {
      output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
    }),
    Layer.mock(Agent.Service, {
      get: () => Effect.succeed({ name: "build", permission: input.permission ?? [] } as any),
    }),
    Layer.mock(Session.Service, {
      get: () => Effect.succeed({ permission: [] } as any),
    }),
    Layer.mock(MCP.Service, {
      tools: () => Effect.succeed(input.mcpTools),
      defs: () => Effect.succeed(input.defs ?? {}),
      clients: () => Effect.succeed(Object.fromEntries(input.servers.map((name) => [name, {} as any]))),
    }),
  )
}

// Derive sanitized server namespaces from the catalog keys, mirroring how the registry
// passes `Object.keys(mcp.clients()).map(sanitize)`.
function serverNames(mcpTools: Record<string, AITool>, servers?: string[]) {
  return servers ?? [...new Set(Object.keys(mcpTools).map((key) => key.split("_")[0]!))]
}

function build(
  mcpTools: Record<string, AITool>,
  defs: Record<string, MCPToolDef> = {},
  servers?: string[],
  permission?: PermissionV1.Rule[],
  trigger?: Plugin.Interface["trigger"],
) {
  const names = serverNames(mcpTools, servers)
  return Effect.runPromise(
    CodeModeTool.pipe(
      Effect.flatMap(Tool.init),
      Effect.provide(harness({ mcpTools, defs, servers: names, permission, trigger })),
    ),
  )
}

// The agent-facing description, as the registry composes it (`describeCodeMode`):
// permission-filtered tool set → grouped catalog → CodeMode instructions.
function describeFor(
  mcpTools: Record<string, AITool>,
  defs: Record<string, MCPToolDef> = {},
  servers?: string[],
  permission: PermissionV1.Rule[] = [],
) {
  return catalogInstructions(Permission.visibleTools(mcpTools, permission), defs, serverNames(mcpTools, servers))
}

describe("code mode execute", () => {
  test("defines execute input with an Effect schema", async () => {
    const decode = Schema.decodeUnknownEffect(Parameters)
    await expect(Effect.runPromise(decode({ code: "return 1" }))).resolves.toEqual({ code: "return 1" })
    await expect(Effect.runPromise(decode({}))).rejects.toThrow()
  })

  test("groups multi-underscore server names by longest matching prefix", () => {
    const groups = groupByServer({ my_server_do_thing: mcpTool("do_thing", () => "") }, ["my_server"])
    expect([...groups.keys()]).toEqual(["my_server"])
    expect(groups.get("my_server")![0]).toMatchObject({
      path: "my_server.do_thing",
      local: "do_thing",
      key: "my_server_do_thing",
    })
  })

  test("groupByServer uses the whole key as the server name when it has no underscore", () => {
    const groups = groupByServer({ standalone: mcpTool("standalone", () => "") }, [])
    expect([...groups.keys()]).toEqual(["standalone"])
    expect(groups.get("standalone")![0]).toMatchObject({
      path: "standalone.standalone",
      server: "standalone",
      local: "standalone",
      key: "standalone",
    })
  })

  test("groupByServer carries the raw MCP schemas for rendering", () => {
    const defs: Record<string, MCPToolDef> = {
      weather_current: {
        name: "current",
        inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        outputSchema: { type: "object", properties: { tempC: { type: "number" } }, required: ["tempC"] },
      } as any,
    }
    const groups = groupByServer({ weather_current: mcpTool("current", () => "") }, ["weather"], defs)
    const entry = groups.get("weather")![0]!
    expect(entry.inputSchema).toEqual(defs.weather_current!.inputSchema as any)
    expect(entry.outputSchema).toEqual(defs.weather_current!.outputSchema as any)
  })

  test("the static base description carries no catalog; the registry appends it", async () => {
    const tool = await build({ github_list_issues: mcpTool("list_issues", () => "") })
    expect(tool.id).toBe(CODE_MODE_TOOL)
    expect(tool.description).toContain("confined runtime")
    expect(tool.description).not.toContain("Available tools")
    expect(tool.description).not.toContain("list_issues")
  })

  test("small catalogs inline every full signature in the appended catalog", () => {
    const description = describeFor({
      github_create_issue: mcpTool("create_issue", () => "", {
        type: "object",
        properties: { title: { type: "string" }, body: { type: "string" } },
        required: ["title"],
      }),
      github_list_issues: mcpTool("list_issues", () => ""),
      linear_search: mcpTool("search", () => ""),
    })

    expect(description).toContain("Available tools (COMPLETE list")
    expect(description).toContain("- github (2 tools)")
    expect(description).toContain("- linear (1 tool)")
    expect(description).toContain(
      "tools.github.create_issue(input: { title: string; body?: string }): Promise<unknown>",
    )
    expect(description).toContain("tools.github.list_issues(")
    expect(description).toContain("tools.linear.search(")
    // A schema with no properties renders as an empty object, not `{  }`.
    expect(description).toContain("tools.linear.search(input: {}): Promise<unknown>")
    // Fully inlined catalog: no discovery round-trip is needed or advertised.
    expect(description).not.toContain("$codemode")
    expect(description).not.toContain("Browse one namespace")
    // The workflow/rules sections use placeholder call forms only — the example machinery
    // never cherry-picks a catalog tool or fabricates result fields.
    expect(description).toContain("## Workflow")
    expect(description).toContain("1. Pick a tool from the list under `## Available tools`")
    expect(description).toContain('`const data = typeof res === "string" ? JSON.parse(res) : res` — most tools return JSON as a string')
    expect(description).toContain("Return only the fields you need")
    expect(description).not.toContain("total_count")
  })

  test("signatures render the declared outputSchema as the return type", () => {
    const defs: Record<string, MCPToolDef> = {
      weather_current: {
        name: "current",
        inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        outputSchema: {
          type: "object",
          properties: { tempC: { type: "number" }, summary: { type: "string" } },
          required: ["tempC"],
        },
      } as any,
    }
    const description = describeFor({ weather_current: mcpTool("current", () => "") }, defs)
    expect(description).toContain(
      "tools.weather.current(input: { city: string }): Promise<{ tempC: number; summary?: string }>",
    )
  })

  test("large catalogs inline a budgeted PARTIAL list plus runtime search", async () => {
    const tools: Record<string, AITool> = {}
    const filler = "a searchable description of this operation that consumes catalog budget ".repeat(3)
    for (let i = 0; i < 150; i++) {
      const client = { callTool: async () => ({ content: [] }) }
      tools[`alpha_op_${i}`] = McpCatalog.convertTool(
        {
          name: `op_${i}`,
          description: `${filler}${i}`,
          inputSchema: { type: "object", properties: { value: { type: "string" }, count: { type: "number" } } },
        } as any,
        client as any,
      )
    }
    tools["zeta_only_tool"] = mcpTool("only_tool", () => "", {
      type: "object",
      properties: { topic: { type: "string", description: "Subject to look up" } },
      required: ["topic"],
    })
    const description = describeFor(tools, {}, ["alpha", "zeta"])

    // Every namespace is listed with counts; signatures inline round-robin across
    // namespaces (cheapest-first within each) until the budget runs out, and the
    // description states exactly how comprehensive the list is. Round-robin fairness:
    // the small zeta namespace is fully shown even though alpha alone could exhaust
    // the whole budget.
    expect(description).toContain("Available tools (PARTIAL — ")
    expect(description).toMatch(/- alpha \(150 tools, \d+ shown\)/)
    expect(description).toContain("- zeta (1 tool)\n")
    expect(description).toContain("tools.zeta.only_tool(input: { topic: string }): Promise<unknown>")
    expect(description).toContain("tools.$codemode.search(")
    // PARTIAL catalogs put search first in the workflow and advertise namespace browsing.
    expect(description).toContain("1. Find a tool (skip when it is already listed below)")
    expect(description).toContain('- Browse one namespace: `await tools.$codemode.search({ query: "", namespace: "<name>" })`.')
    expect(description).not.toContain("total_count")
    // All op lines cost the same estimated tokens (chars/4 rounds away the 1- vs 3-digit
    // name difference), so the path tiebreak decides: the lexicographically-first ops made
    // the cut and the lexicographic tail (op_99 is maximal) did not.
    expect(description).toContain("tools.alpha.op_0(")
    expect(description).not.toContain("tools.alpha.op_99(")

    // The runtime search tool works in-program and returns complete signatures.
    const tool = await build(tools, {}, ["alpha", "zeta"])
    const out = await Effect.runPromise(
      tool.execute({ code: "return await tools.$codemode.search({ query: 'only tool', limit: 3 })" }, ctx),
    )
    const result = JSON.parse(out.output)
    // Search-result paths carry the `tools.` prefix so each is directly usable as a call site.
    expect(result.items.map((i: any) => i.path)).toContain("tools.zeta.only_tool")
    expect(result.items[0].signature).toContain("tools.")
    // Search results render the pretty multiline signature: MCP input-property
    // descriptions ride along as JSDoc field comments. The inline catalog stays compact.
    const signature = result.items.find((i: any) => i.path === "tools.zeta.only_tool").signature
    expect(signature).toContain("tools.zeta.only_tool(input: {\n")
    expect(signature).toContain("  /** Subject to look up */\n  topic: string")
    expect(description).not.toContain("/**")
    expect(out.metadata.toolCalls).toEqual([
      { tool: "$codemode.search", status: "completed", input: { query: "only tool", limit: 3 } },
    ])
  })

  test("runs plain JavaScript and returns the value as text", async () => {
    const tool = await build({})
    const output = await Effect.runPromise(tool.execute({ code: "return 1 + 2" }, ctx))
    expect(output.output).toBe("3")
    expect(output.metadata.toolCalls).toEqual([])
  })

  test("Object.keys(tools) enumerates the MCP server namespaces", async () => {
    const tool = await build({
      github_list_issues: mcpTool("list_issues", () => ""),
      linear_search: mcpTool("search", () => ""),
    })
    const output = await Effect.runPromise(
      tool.execute({ code: "const namespaces = Object.keys(tools); return { namespaces, count: namespaces.length }" }, ctx),
    )
    expect(JSON.parse(output.output)).toEqual({ namespaces: ["github", "linear"], count: 2 })
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
    expect(output.metadata.toolCalls).toEqual([
      { tool: "greeter.hello", status: "completed", input: { name: "world" } },
    ])
  })

  test("exposes structured content as native data and composes multiple calls", async () => {
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
        { code: "const [a, b] = await Promise.all([tools.echo.one({}), tools.echo.two({})]); return a + b" },
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

  test("reports an unknown tool as a failed execution", async () => {
    const tool = await build({ known_tool: mcpTool("tool", () => "ok") })
    const output = await Effect.runPromise(tool.execute({ code: "return await tools.known.missing({})" }, ctx))
    expect(output.metadata.error).toBe(true)
    expect(output.output).toContain("Unknown tool 'known.missing'")
  })

  test("propagates an MCP tool error into the program as a catchable failure", async () => {
    const tool = await build({
      bad_tool: mcpTool("tool", () => ({ isError: true, content: [{ type: "text", text: "server exploded" }] })),
    })
    const output = await Effect.runPromise(
      tool.execute({ code: "try { await tools.bad.tool({}) } catch (e) { return 'caught: ' + e.message }" }, ctx),
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

  test("a denied permission fails the child call with a catchable message, not the whole execute", async () => {
    const denyCtx: Tool.Context = { ...ctx, ask: () => Effect.die(new Error("permission denied by user")) }
    const called: string[] = []
    const tool = await build({
      a_tool: mcpTool("a", () => {
        called.push("a")
        return { content: [{ type: "text", text: "ok" }] }
      }),
    })

    const output = await Effect.runPromise(
      tool.execute({ code: "try { await tools.a.tool({}) } catch (e) { return 'denied: ' + e.message }" }, denyCtx),
    )

    expect(output.output).toBe("denied: permission denied by user")
    expect(output.metadata.error).toBeUndefined()
    // The MCP tool itself never ran.
    expect(called).toEqual([])
    expect(output.metadata.toolCalls).toEqual([{ tool: "a.tool", status: "error" }])
  })

  test("child calls fire plugin tool.execute hooks with the MCP key and synthetic parent/N call ids", async () => {
    const events: { name: string; input: any; output: any }[] = []
    const trigger = ((name: unknown, input: unknown, output: unknown) =>
      Effect.sync(() => {
        events.push({ name: name as string, input, output })
        return output
      })) as Plugin.Interface["trigger"]
    const tool = await build(
      {
        a_tool: mcpTool("a", () => ({ content: [{ type: "text", text: "one" }] })),
        b_tool: mcpTool("b", () => ({ content: [{ type: "text", text: "two" }] })),
      },
      {},
      undefined,
      undefined,
      trigger,
    )

    const out = await Effect.runPromise(
      tool.execute({ code: "await tools.a.tool({ x: 1 }); await tools.b.tool({}); return 'done'" }, ctx),
    )

    expect(out.output).toBe("done")
    // callID is synthetic and per-execution: `${parentCallID}/${n}`, n starting at 1.
    expect(events.map((e) => [e.name, e.input.tool, e.input.callID])).toEqual([
      ["tool.execute.before", "a_tool", "call_code_mode/1"],
      ["tool.execute.after", "a_tool", "call_code_mode/1"],
      ["tool.execute.before", "b_tool", "call_code_mode/2"],
      ["tool.execute.after", "b_tool", "call_code_mode/2"],
    ])
    const [before, after] = events
    expect(before!.input.sessionID).toBe(ctx.sessionID)
    expect(before!.output).toEqual({ args: { x: 1 } })
    expect(after!.input.args).toEqual({ x: 1 })
    // The after hook sees the raw MCP result — the same payload the legacy path passes.
    expect(after!.output).toEqual({ content: [{ type: "text", text: "one" }] })
  })

  test("a failing before hook fails only that child call as a catchable in-program error", async () => {
    const trigger = ((name: unknown, input: any, output: unknown) => {
      if (name === "tool.execute.before" && input.tool === "a_tool") return Effect.die(new Error("hook exploded"))
      return Effect.succeed(output)
    }) as Plugin.Interface["trigger"]
    const called: string[] = []
    const record = (name: string) => () => {
      called.push(name)
      return { content: [{ type: "text", text: "ok" }] }
    }
    const tool = await build(
      { a_tool: mcpTool("a", record("a")), b_tool: mcpTool("b", record("b")) },
      {},
      undefined,
      undefined,
      trigger,
    )

    const out = await Effect.runPromise(
      tool.execute(
        {
          code: `
            let caught
            try { await tools.a.tool({}) } catch (e) { caught = e.message }
            const r = await tools.b.tool({})
            return caught + " / " + r
          `,
        },
        ctx,
      ),
    )

    // The program handled the hook failure; the rest ran and the outer result is ok.
    expect(out.metadata.error).toBeUndefined()
    expect(out.output).toBe("hook exploded / ok")
    // The before hook gates dispatch: the failed child's tool never executed.
    expect(called).toEqual(["b"])
  })

  test("streams live per-call metadata as a call starts and finishes", async () => {
    const snapshots: Array<{ toolCalls: { tool: string; status: string; input?: Record<string, unknown> }[] }> = []
    const recordingCtx: Tool.Context = {
      ...ctx,
      metadata: (val: any) => Effect.sync(() => void snapshots.push(val.metadata)),
    }
    const tool = await build({ greeter_hello: mcpTool("hello", () => ({ content: [{ type: "text", text: "hi" }] })) })

    await Effect.runPromise(
      tool.execute({ code: "await tools.greeter.hello({ name: 'Ada' }); return 'done'" }, recordingCtx),
    )

    // The UI sees the call appear as running, then resolve to completed.
    expect(snapshots).toContainEqual({
      toolCalls: [{ tool: "greeter.hello", status: "running", input: { name: "Ada" } }],
    })
    expect(snapshots).toContainEqual({
      toolCalls: [{ tool: "greeter.hello", status: "completed", input: { name: "Ada" } }],
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
      tool.execute(
        { code: "try { await tools.bad.tool({ reason: 'test' }) } catch (e) { return 'caught' }" },
        recordingCtx,
      ),
    )

    expect(snapshots).toContainEqual({ toolCalls: [{ tool: "bad.tool", status: "error", input: { reason: "test" } }] })
  })

  test("accumulates stripped media as execute attachments the sandbox never sees", async () => {
    const tool = await build({
      shot_take: mcpTool("take", () => ({
        content: [{ type: "image", data: "PNGDATA", mimeType: "image/png" }],
        structuredContent: { name: "shot.png" },
      })),
    })

    const out = await Effect.runPromise(tool.execute({ code: "return await tools.shot.take({})" }, ctx))
    // The program received the structured content; the media rode along host-side.
    expect(JSON.parse(out.output)).toEqual({ name: "shot.png" })
    expect(out.attachments).toEqual([{ type: "file", mime: "image/png", url: "data:image/png;base64,PNGDATA" }])
    expect(out.output).not.toContain("PNGDATA")
  })

  test("a media-only result returns a text marker so the program knows it succeeded", async () => {
    const tool = await build({
      shot_take: mcpTool("take", () => ({ content: [{ type: "image", data: "PNGDATA", mimeType: "image/png" }] })),
    })
    const out = await Effect.runPromise(tool.execute({ code: "return await tools.shot.take({})" }, ctx))
    expect(out.output).toBe("[1 image attached to the result]")
    expect(out.attachments).toEqual([{ type: "file", mime: "image/png", url: "data:image/png;base64,PNGDATA" }])
  })

  test("attachments still flow when the program returns something else entirely", async () => {
    const tool = await build({
      shot_take: mcpTool("take", () => ({ content: [{ type: "image", data: "PNGDATA", mimeType: "image/png" }] })),
    })
    const out = await Effect.runPromise(
      tool.execute({ code: "await tools.shot.take({}); return 'captured'" }, ctx),
    )
    expect(out.output).toBe("captured")
    expect(out.attachments).toHaveLength(1)
  })

  test("isolates the sandbox from host globals", async () => {
    const tool = await build({})
    const output = await Effect.runPromise(tool.execute({ code: "return process.env" }, ctx))
    expect(output.metadata.error).toBe(true)
  })

  test("cancelling via ctx.abort interrupts the running program", async () => {
    // The child call triggers the abort itself, deterministically, while the program
    // swallows the call's failure and heads into an infinite loop. If abort did not
    // interrupt the execution fiber, this test would hang on the busy loop.
    const controller = new AbortController()
    const tool = await build({
      host_trigger: mcpTool("trigger", () => {
        controller.abort()
        return new Promise(() => {})
      }),
    })
    const output = await Effect.runPromise(
      tool.execute(
        { code: "try { await tools.host.trigger({}) } catch {} while (true) {}" },
        { ...ctx, abort: controller.signal },
      ),
    )
    expect(output.output).toBe("Execution cancelled.")
    expect(output.metadata.error).toBe(true)
    expect(output.metadata.toolCalls).toEqual([{ tool: "host.trigger", status: "running" }])
  })

  test("a pre-aborted signal cancels before the program runs", async () => {
    const controller = new AbortController()
    controller.abort()
    const ran: string[] = []
    const tool = await build({ host_touch: mcpTool("touch", () => (ran.push("called"), "ok")) })
    const output = await Effect.runPromise(
      tool.execute({ code: "return await tools.host.touch({})" }, { ...ctx, abort: controller.signal }),
    )
    expect(output.output).toBe("Execution cancelled.")
    expect(ran).toEqual([])
  })

  test("leaves oversized results to OpenCode's native tool-output truncation", async () => {
    // No CodeMode output limit is set, so the full result reaches the shared Tool.define
    // wrapper intact (the harness Truncate fake passes it through un-truncated).
    const tool = await build({})
    const output = await Effect.runPromise(tool.execute({ code: "return 'x'.repeat(40000)" }, ctx))
    expect(output.metadata.error).toBeUndefined()
    expect(output.output).not.toContain("[result truncated:")
    expect(output.output.length).toBeGreaterThanOrEqual(40_000)
  })

  test("appends logs after the result on success and after the message on error", async () => {
    const tool = await build({})

    const ok = await Effect.runPromise(
      tool.execute({ code: "console.log('step one'); console.warn('careful'); return 'done'" }, ctx),
    )
    expect(ok.output).toBe("done\n\nLogs:\nstep one\n[warn] careful")

    const err = await Effect.runPromise(
      tool.execute({ code: "console.log('before the throw'); throw new Error('boom')" }, ctx),
    )
    expect(err.metadata.error).toBe(true)
    expect(err.output).toContain("Uncaught: boom")
    expect(err.output).toContain("Logs:\nbefore the throw")
  })
})

describe("code mode permission visibility", () => {
  const deny = (permission: string): PermissionV1.Rule => ({ permission, pattern: "*", action: "deny" })
  const askRule = (permission: string): PermissionV1.Rule => ({ permission, pattern: "*", action: "ask" })
  const ok = () => ({ content: [{ type: "text", text: "ok" }] })

  test("a hard-denied tool never enters the catalog or its search index", () => {
    const mcpTools = {
      github_create_issue: mcpTool("create_issue", ok),
      github_list_issues: mcpTool("list_issues", ok),
    }
    const description = describeFor(mcpTools, {}, ["github"], [deny("github_create_issue")])
    expect(description).toContain("tools.github.list_issues(")
    expect(description).not.toContain("create_issue")
    expect(description).toContain("- github (1 tool)")
  })

  test("an ask-level tool stays fully visible in the catalog", () => {
    const mcpTools = {
      github_create_issue: mcpTool("create_issue", ok),
      github_list_issues: mcpTool("list_issues", ok),
    }
    const description = describeFor(mcpTools, {}, ["github"], [askRule("github_create_issue")])
    expect(description).toContain("tools.github.create_issue(")
    expect(description).toContain("tools.github.list_issues(")
    expect(description).toContain("- github (2 tools)")
  })

  test("a hard-denied tool is not dispatchable: the program gets the unknown-tool diagnostic", async () => {
    const called: string[] = []
    const tool = await build(
      {
        github_create_issue: mcpTool("create_issue", () => {
          called.push("create_issue")
          return ok()
        }),
        github_list_issues: mcpTool("list_issues", ok),
      },
      {},
      ["github"],
      [deny("github_create_issue")],
    )

    const denied = await Effect.runPromise(
      tool.execute({ code: "return await tools.github.create_issue({ title: 'x' })" }, ctx),
    )
    expect(denied.metadata.error).toBe(true)
    expect(denied.output).toContain("Unknown tool 'github.create_issue'")
    expect(denied.output).not.toContain("permission")
    expect(called).toEqual([])

    // The rest of the namespace still works.
    const allowed = await Effect.runPromise(
      tool.execute({ code: "return await tools.github.list_issues({})" }, ctx),
    )
    expect(allowed.metadata.error).toBeUndefined()
    expect(allowed.output).toBe("ok")
  })

  test("an ask-level tool remains callable and still prompts via ctx.ask", async () => {
    const asked: string[] = []
    const askCtx: Tool.Context = { ...ctx, ask: (req) => Effect.sync(() => void asked.push(req.permission)) }
    const tool = await build(
      { github_list_issues: mcpTool("list_issues", ok) },
      {},
      ["github"],
      [askRule("github_list_issues")],
    )
    const out = await Effect.runPromise(
      tool.execute({ code: "return await tools.github.list_issues({})" }, askCtx),
    )
    expect(out.output).toBe("ok")
    expect(asked).toEqual(["github_list_issues"])
  })

  test("Permission.visibleTools hides only hard denies, matching Permission.disabled", () => {
    const tools = { a_tool: 1, b_tool: 2, c_tool: 3 }
    const visible = Permission.visibleTools(tools, [
      deny("a_tool"),
      askRule("b_tool"),
      // A scoped (non-"*") deny does not hide the tool from the catalog.
      { permission: "c_tool", pattern: "something", action: "deny" },
    ])
    expect(Object.keys(visible)).toEqual(["b_tool", "c_tool"])
  })
})

describe("toSandboxResult", () => {
  const collector = () => {
    const attachments: Attachment[] = []
    return { attachments, collect: (a: Attachment) => void attachments.push(a) }
  }

  test("prefers structuredContent over text", () => {
    const { collect } = collector()
    expect(toSandboxResult({ structuredContent: { x: 1 }, content: [{ type: "text", text: "hi" }] }, collect)).toEqual(
      { x: 1 },
    )
  })

  test("joins text content when no structured content is present", () => {
    const { collect } = collector()
    expect(
      toSandboxResult(
        { content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] },
        collect,
      ),
    ).toBe("one\ntwo")
  })

  test("passes non-MCP values through untouched", () => {
    const { collect } = collector()
    expect(toSandboxResult("raw", collect)).toBe("raw")
    expect(toSandboxResult(42, collect)).toBe(42)
    expect(toSandboxResult(null, collect)).toBeNull()
    expect(toSandboxResult({ some: "object" }, collect)).toEqual({ some: "object" })
  })

  test("strips media into the accumulator; text stays the sandbox value", () => {
    const { attachments, collect } = collector()
    const value = toSandboxResult(
      {
        content: [
          { type: "text", text: "see image" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
        ],
      },
      collect,
    )
    expect(value).toBe("see image")
    expect(attachments).toEqual([{ type: "file", mime: "image/png", url: "data:image/png;base64,AAAA" }])
  })

  test("a media-only result yields a marker; counts and nouns follow the content", () => {
    const one = collector()
    expect(toSandboxResult({ content: [{ type: "image", data: "A", mimeType: "image/png" }] }, one.collect)).toBe(
      "[1 image attached to the result]",
    )

    const two = collector()
    expect(
      toSandboxResult(
        {
          content: [
            { type: "image", data: "A", mimeType: "image/png" },
            { type: "image", data: "B", mimeType: "image/jpeg" },
          ],
        },
        two.collect,
      ),
    ).toBe("[2 images attached to the result]")
    expect(two.attachments).toHaveLength(2)

    const mixed = collector()
    expect(
      toSandboxResult(
        {
          content: [
            { type: "image", data: "A", mimeType: "image/png" },
            { type: "audio", data: "B", mimeType: "audio/wav" },
          ],
        },
        mixed.collect,
      ),
    ).toBe("[2 files attached to the result]")
  })

  test("extracts embedded resources: text inline, blobs as attachments with filenames", () => {
    const { attachments, collect } = collector()
    const value = toSandboxResult(
      {
        content: [
          { type: "resource", resource: { uri: "file:///tmp/notes.txt", mimeType: "text/plain", text: "note text" } },
          { type: "resource", resource: { uri: "file:///tmp/doc.pdf", mimeType: "application/pdf", blob: "PDF" } },
        ],
      },
      collect,
    )
    expect(value).toBe("note text")
    expect(attachments).toEqual([
      { type: "file", mime: "application/pdf", url: "data:application/pdf;base64,PDF", filename: "doc.pdf" },
    ])
  })

  test("collects resource_link blocks as external-URL attachments", () => {
    const { attachments, collect } = collector()
    const value = toSandboxResult(
      { content: [{ type: "resource_link", uri: "https://example.com/report.csv", mimeType: "text/csv" }] },
      collect,
    )
    expect(value).toBe("[1 file attached to the result]")
    expect(attachments).toEqual([
      { type: "file", mime: "text/csv", url: "https://example.com/report.csv", filename: "report.csv" },
    ])
  })

  test("an MCP-shaped result with nothing extractable becomes null", () => {
    const { collect } = collector()
    expect(toSandboxResult({ content: [] }, collect)).toBeNull()
    expect(toSandboxResult({ content: [{ type: "mystery" }] }, collect)).toBeNull()
  })
})

describe("formatting helpers", () => {
  test("formatValue", () => {
    expect(formatValue("text")).toBe("text")
    expect(formatValue({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2))
    expect(formatValue(null)).toBe("null")
    expect(formatValue(undefined)).toBe("undefined")
  })

  test("withLogs", () => {
    // No logs: output is returned untouched.
    expect(withLogs("result", [])).toBe("result")
    expect(withLogs("result")).toBe("result")
    // Logs are appended as a trailing section, one line each.
    expect(withLogs("result", ["a", "[warn] b"])).toBe("result\n\nLogs:\na\n[warn] b")
    // Empty output still gets the section (no leading blank lines).
    expect(withLogs("", ["[error] boom"])).toBe("Logs:\n[error] boom")
  })
})
