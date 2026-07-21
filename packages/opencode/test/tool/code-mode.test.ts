import { describe, expect, test } from "bun:test"
import { CODE_MODE_TOOL, CodeModeTool, Parameters, describeCatalog } from "@/tool/code-mode"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Session } from "@/session/session"
import { Tool } from "@/tool/tool"
import * as Truncate from "@/tool/truncate"
import { MessageID, SessionID } from "@/session/schema"
import { Cause, Effect, Exit, Layer, Schema } from "effect"

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

function mcpTool(
  name: string,
  handler: (args: Record<string, unknown>) => unknown,
  inputSchema: Record<string, unknown> = { type: "object", properties: {} },
  outputSchema?: Record<string, unknown>,
): MCP.McpTool {
  return {
    def: { name, description: name, inputSchema, ...(outputSchema ? { outputSchema } : {}) } as MCPToolDef,
    client: {
      callTool: async (params: { arguments?: Record<string, unknown> }) => handler(params.arguments ?? {}),
    } as unknown as MCP.McpTool["client"],
  }
}

function harness(input: {
  mcpTools: Record<string, MCP.McpTool>
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
      clients: () => Effect.succeed(Object.fromEntries(input.servers.map((name) => [name, {} as any]))),
    }),
  )
}

function serverNames(mcpTools: Record<string, MCP.McpTool>, servers?: string[]) {
  return servers ?? [...new Set(Object.keys(mcpTools).map((key) => key.split("_")[0]!))]
}

function build(
  mcpTools: Record<string, MCP.McpTool>,
  servers?: string[],
  permission?: PermissionV1.Rule[],
  trigger?: Plugin.Interface["trigger"],
) {
  const names = serverNames(mcpTools, servers)
  return Effect.runPromise(
    CodeModeTool.pipe(
      Effect.flatMap(Tool.init),
      Effect.provide(harness({ mcpTools, servers: names, permission, trigger })),
    ),
  )
}

function describeFor(mcpTools: Record<string, MCP.McpTool>, servers?: string[], permission: PermissionV1.Rule[] = []) {
  return describeCatalog(Permission.visibleTools(mcpTools, permission), serverNames(mcpTools, servers))
}

// Program failures die at the tool boundary; recover the defect for message assertions.
async function failure(effect: Effect.Effect<unknown>) {
  const exit = await Effect.runPromise(effect.pipe(Effect.exit))
  if (Exit.isSuccess(exit)) throw new Error("expected the tool to fail")
  return Cause.squash(exit.cause) as Error
}

describe("code mode execute", () => {
  test("defines execute input with an Effect schema", async () => {
    const decode = Schema.decodeUnknownEffect(Parameters)
    await expect(Effect.runPromise(decode({ code: "return 1" }))).resolves.toEqual({ code: "return 1" })
    await expect(Effect.runPromise(decode({}))).rejects.toThrow()
    expect(Schema.toJsonSchemaDocument(Parameters).schema).toMatchObject({
      properties: {
        code: {
          description: "Script body executed by the confined interpreter.",
        },
      },
    })
  })

  test("groups multi-underscore server names by longest matching prefix", () => {
    const description = describeFor({ my_server_do_thing: mcpTool("do_thing", () => "") }, ["my_server"])
    expect(description).toContain("- my_server (1 tool)")
    expect(description).toContain("tools.my_server.do_thing(")
  })

  test("groupByServer uses the whole key as the server name when it has no underscore", () => {
    const description = describeFor({ standalone: mcpTool("standalone", () => "") }, [])
    expect(description).toContain("- standalone (1 tool)")
    expect(description).toContain("tools.standalone.standalone(")
  })

  test("describeCatalog carries the raw MCP schemas for rendering", () => {
    const description = describeFor(
      {
        weather_current: mcpTool(
          "current",
          () => "",
          { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
          { type: "object", properties: { tempC: { type: "number" } }, required: ["tempC"] },
        ),
      },
      ["weather"],
    )
    expect(description).toContain(
      "tools.weather.current(input: {\n  city: string,\n}): Promise<{\n  tempC: number,\n}>",
    )
  })

  test("the static base description carries no catalog; the registry appends it", async () => {
    const tool = await build({ github_list_issues: mcpTool("list_issues", () => "") })
    expect(tool.id).toBe(CODE_MODE_TOOL)
    expect(tool.description).toBe("Run a confined orchestration script with access to connected MCP tools.")
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
      "tools.github.create_issue(input: {\n  title: string,\n  body?: string,\n}): Promise<unknown>",
    )
    expect(description).toContain("tools.github.list_issues(")
    expect(description).toContain("tools.linear.search(")
    expect(description).toContain("tools.linear.search(input: {}): Promise<unknown>")
    expect(description).not.toContain("$codemode")
    expect(description).not.toContain("Browse one namespace")
    expect(description).toContain("## Workflow")
    expect(description).toContain("1. Pick a tool from the list under `## Available tools`")
    expect(description).not.toContain("JSON.parse(res)")
    expect(description).toContain("check that it is a non-null object and not an array")
    expect(description).toContain("Return only the fields you need")
    expect(description).not.toContain("total_count")
  })

  test("signatures render the declared outputSchema as the return type", () => {
    const description = describeFor({
      weather_current: mcpTool(
        "current",
        () => "",
        { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        {
          type: "object",
          properties: { tempC: { type: "number" }, summary: { type: "string" } },
          required: ["tempC"],
        },
      ),
    })
    expect(description).toContain(
      "tools.weather.current(input: {\n  city: string,\n}): Promise<{\n  tempC: number,\n  summary?: string,\n}>",
    )
  })

  test("large catalogs inline a budgeted PARTIAL list plus runtime search", async () => {
    const tools: Record<string, MCP.McpTool> = {}
    const filler = "a searchable description of this operation that consumes catalog budget ".repeat(3)
    for (let i = 0; i < 150; i++) {
      tools[`alpha_op_${i}`] = {
        def: {
          name: `op_${i}`,
          description: `${filler}${i}`,
          inputSchema: { type: "object", properties: { value: { type: "string" }, count: { type: "number" } } },
        } as MCPToolDef,
        client: { callTool: async () => ({ content: [] }) } as unknown as MCP.McpTool["client"],
      }
    }
    tools["zeta_only_tool"] = mcpTool("only_tool", () => "", {
      type: "object",
      properties: { topic: { type: "string", description: "Subject to look up" } },
      required: ["topic"],
    })
    const description = describeFor(tools, ["alpha", "zeta"])

    expect(description).toContain("Available tools (PARTIAL - ")
    expect(description).toMatch(/- alpha \(150 tools, \d+ shown\)/)
    expect(description).toContain("- zeta (1 tool)\n")
    expect(description).toContain(
      "tools.zeta.only_tool(input: {\n  /** Subject to look up */\n  topic: string,\n}): Promise<unknown>",
    )
    expect(description).toContain("tools.$codemode.search(")
    expect(description).toContain("  limit?: number,\n  offset?: number,")
    expect(description).toContain("  remaining: number,\n  next: {")
    expect(description).toContain("      offset: number,\n    } | null,")
    expect(description).toContain(
      '1. If needed, discover tools: `return await tools.$codemode.search({ query: "<intent + key nouns>" })`.',
    )
    expect(description).toContain(
      '- Browse one namespace: `await tools.$codemode.search({ query: "", namespace: "<name>" })`.',
    )
    expect(description).not.toContain("total_count")
    expect(description).toContain("tools.alpha.op_0(")
    expect(description).not.toContain("tools.alpha.op_99(")

    const tool = await build(tools, ["alpha", "zeta"])
    const out = await Effect.runPromise(
      tool.execute({ code: "return await tools.$codemode.search({ query: 'only tool', limit: 3, offset: 0 })" }, ctx),
    )
    const result = JSON.parse(out.output)
    expect(result.items.map((i: any) => i.path)).toContain("tools.zeta.only_tool")
    expect(result).toMatchObject({ remaining: 0, next: null })
    expect(result.items[0].signature).toContain("tools.")
    const signature = result.items.find((i: any) => i.path === "tools.zeta.only_tool").signature
    expect(signature).toContain("tools.zeta.only_tool(input: {\n")
    expect(signature).toContain("  /** Subject to look up */\n  topic: string")
    expect(description).toContain("/** Subject to look up */")
    expect(out.metadata.toolCalls).toEqual([
      { tool: "$codemode.search", status: "completed", input: { query: "only tool", limit: 3, offset: 0 } },
    ])
  })

  test("runs plain JavaScript and returns the value as text", async () => {
    const tool = await build({})
    const output = await Effect.runPromise(tool.execute({ code: "return 1 + 2" }, ctx))
    expect(output.output).toBe("3")
    expect(output.metadata.toolCalls).toEqual([])
  })

  test("Object.keys(tools) enumerates the MCP server and CodeMode namespaces", async () => {
    const tool = await build({
      github_list_issues: mcpTool("list_issues", () => ""),
      linear_search: mcpTool("search", () => ""),
    })
    const output = await Effect.runPromise(
      tool.execute(
        { code: "const namespaces = Object.keys(tools); return { namespaces, count: namespaces.length }" },
        ctx,
      ),
    )
    expect(JSON.parse(output.output)).toEqual({ namespaces: ["github", "linear", "$codemode"], count: 3 })
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

  test("a program failure fails the tool with a readable error", async () => {
    const tool = await build({})
    const error = await failure(tool.execute({ code: "throw new Error('boom')" }, ctx))
    expect(error.message).toBe("Uncaught: boom")
  })

  test("reports an unknown tool as a failed execution", async () => {
    const tool = await build({ known_tool: mcpTool("tool", () => "ok") })
    const error = await failure(tool.execute({ code: "return await tools.known.missing({})" }, ctx))
    expect(error.message).toContain("Unknown tool 'known.missing'")
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
      undefined,
      undefined,
      trigger,
    )

    const out = await Effect.runPromise(
      tool.execute({ code: "await tools.a.tool({ x: 1 }); await tools.b.tool({}); return 'done'" }, ctx),
    )

    expect(out.output).toBe("done")
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

    expect(out.metadata.error).toBeUndefined()
    expect(out.output).toBe("hook exploded / ok")
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

  test("media-only markers distinguish all-image from mixed attachments", async () => {
    const tool = await build({
      media_images: mcpTool("images", () => ({
        content: [
          { type: "image", data: "PNG1", mimeType: "image/png" },
          { type: "image", data: "PNG2", mimeType: "image/png" },
        ],
      })),
      media_mixed: mcpTool("mixed", () => ({
        content: [
          { type: "image", data: "PNG3", mimeType: "image/png" },
          { type: "resource", resource: { uri: "file:///tmp/report.pdf", mimeType: "application/pdf", blob: "PDF1" } },
        ],
      })),
    })
    const out = await Effect.runPromise(
      tool.execute(
        {
          code: `
            const images = await tools.media.images({})
            const mixed = await tools.media.mixed({})
            return { images, mixed }
          `,
        },
        ctx,
      ),
    )

    expect(JSON.parse(out.output)).toEqual({
      images: "[2 images attached to the result]",
      mixed: "[2 files attached to the result]",
    })
    expect(out.output).not.toContain("PNG")
    expect(out.attachments).toEqual([
      { type: "file", mime: "image/png", url: "data:image/png;base64,PNG1" },
      { type: "file", mime: "image/png", url: "data:image/png;base64,PNG2" },
      { type: "file", mime: "image/png", url: "data:image/png;base64,PNG3" },
      { type: "file", mime: "application/pdf", url: "data:application/pdf;base64,PDF1", filename: "report.pdf" },
    ])
  })

  test("resource links flow to the program as text, never as attachments", async () => {
    const tool = await build({
      docs_find: mcpTool("find", () => ({
        content: [
          {
            type: "resource_link",
            uri: "https://example.com/guide.pdf",
            name: "guide.pdf",
            mimeType: "application/pdf",
          },
          { type: "resource_link", uri: "file:///tmp/notes.md", name: "notes.md" },
        ],
      })),
    })
    const out = await Effect.runPromise(tool.execute({ code: "return await tools.docs.find({})" }, ctx))

    expect(out.output).toBe("guide.pdf: https://example.com/guide.pdf\nnotes.md: file:///tmp/notes.md")
    expect(out.attachments).toBeUndefined()
  })

  test("attachments still flow when the program returns something else entirely", async () => {
    const tool = await build({
      shot_take: mcpTool("take", () => ({ content: [{ type: "image", data: "PNGDATA", mimeType: "image/png" }] })),
    })
    const out = await Effect.runPromise(tool.execute({ code: "await tools.shot.take({}); return 'captured'" }, ctx))
    expect(out.output).toBe("captured")
    expect(out.attachments).toHaveLength(1)
  })

  test("isolates the sandbox from host globals", async () => {
    const tool = await build({})
    const error = await failure(tool.execute({ code: "return process.env" }, ctx))
    expect(error.message).toContain("process")
  })

  test("cancelling via ctx.abort interrupts the running program", async () => {
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

    const error = await failure(tool.execute({ code: "console.log('before the throw'); throw new Error('boom')" }, ctx))
    expect(error.message).toContain("Uncaught: boom")
    expect(error.message).toContain("Logs:\nbefore the throw")
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
    const description = describeFor(mcpTools, ["github"], [deny("github_create_issue")])
    expect(description).toContain("tools.github.list_issues(")
    expect(description).not.toContain("create_issue")
    expect(description).toContain("- github (1 tool)")
  })

  test("an ask-level tool stays fully visible in the catalog", () => {
    const mcpTools = {
      github_create_issue: mcpTool("create_issue", ok),
      github_list_issues: mcpTool("list_issues", ok),
    }
    const description = describeFor(mcpTools, ["github"], [askRule("github_create_issue")])
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
      ["github"],
      [deny("github_create_issue")],
    )

    const denied = await failure(tool.execute({ code: "return await tools.github.create_issue({ title: 'x' })" }, ctx))
    expect(denied.message).toContain("Unknown tool 'github.create_issue'")
    expect(denied.message).not.toContain("permission")
    expect(called).toEqual([])

    const allowed = await Effect.runPromise(tool.execute({ code: "return await tools.github.list_issues({})" }, ctx))
    expect(allowed.metadata.error).toBeUndefined()
    expect(allowed.output).toBe("ok")
  })

  test("an ask-level tool remains callable and still prompts via ctx.ask", async () => {
    const asked: string[] = []
    const askCtx: Tool.Context = { ...ctx, ask: (req) => Effect.sync(() => void asked.push(req.permission)) }
    const tool = await build(
      { github_list_issues: mcpTool("list_issues", ok) },
      ["github"],
      [askRule("github_list_issues")],
    )
    const out = await Effect.runPromise(tool.execute({ code: "return await tools.github.list_issues({})" }, askCtx))
    expect(out.output).toBe("ok")
    expect(asked).toEqual(["github_list_issues"])
  })

  test("Permission.visibleTools hides only hard denies, matching Permission.disabled", () => {
    const tools = { a_tool: 1, b_tool: 2, c_tool: 3 }
    const visible = Permission.visibleTools(tools, [
      deny("a_tool"),
      askRule("b_tool"),
      { permission: "c_tool", pattern: "something", action: "deny" },
    ])
    expect(Object.keys(visible)).toEqual(["b_tool", "c_tool"])
  })
})
