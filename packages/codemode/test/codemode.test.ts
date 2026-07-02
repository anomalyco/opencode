import { describe, expect, test } from "bun:test"
import { Cause, Effect, Schema } from "effect"
import { CodeMode, ExecuteInputSchema, ExecuteResultSchema, Tool, toolError } from "../src/index.js"
import type { InternalExecutionLimits } from "../src/codemode.js"
import type { Definition } from "../src/tool.js"

const run = (tool: Definition<never>) =>
  Effect.runPromise(CodeMode.make({ tools: { host: { call: tool } } }).execute("return await tools.host.call({})"))

class UnsafeHostError extends Schema.TaggedErrorClass<UnsafeHostError>()("UnsafeHostError", {
  reason: Schema.String,
}) {}

describe("CodeMode host failure boundary", () => {
  test("preserves explicit safe tool failures", async () => {
    const result = await run(
      Tool.make({
        description: "Fail safely",
        input: Schema.Struct({}),
        output: Schema.String,
        run: () => Effect.fail(toolError("Authorized request was refused")),
      }),
    )

    expect(result.ok ? undefined : result.error).toStrictEqual({
      kind: "ToolFailure",
      message: "Authorized request was refused",
    })
  })

  test("sanitizes unknown host failures and defects", async () => {
    for (const failure of [
      Effect.fail(new UnsafeHostError({ reason: "Authorization: Bearer typed-secret" })),
      Effect.die(new Error("postgres://user:defect-secret@example.invalid")),
    ]) {
      const result = await run(
        Tool.make({
          description: "Fail internally",
          input: Schema.Struct({}),
          output: Schema.String,
          run: () => failure,
        }),
      )

      expect(result.ok ? undefined : result.error).toStrictEqual({
        kind: "ToolFailure",
        message: "Tool execution failed",
      })
      expect(JSON.stringify(result)).not.toMatch(/typed-secret|defect-secret|Authorization: Bearer/)
    }
  })

  test("sanitizes invalid host output", async () => {
    const secret = "invalid-output-secret"
    const result = await run(
      Tool.make({
        description: "Return invalid output",
        input: Schema.Struct({}),
        output: Schema.Struct({ safe: Schema.String }),
        run: () => Effect.succeed({ safe: 1, secret } as unknown as { readonly safe: string }),
      }),
    )

    expect(result.ok ? undefined : result.error).toStrictEqual({
      kind: "InvalidToolOutput",
      message: "Invalid output from tool 'host.call'.",
    })
    expect(JSON.stringify(result)).not.toMatch(/invalid-output-secret/)
  })

  test("sanitizes host output that throws while being copied", async () => {
    const result = await run(
      Tool.make({
        description: "Return hostile output",
        input: Schema.Struct({}),
        output: Schema.Unknown,
        run: () =>
          Effect.succeed(
            new Proxy({}, {
              ownKeys: () => {
                throw new Error("host-output-secret")
              },
            }),
          ),
      }),
    )

    expect(result.ok ? undefined : result.error).toStrictEqual({
      kind: "InvalidToolOutput",
      message: "Invalid output from tool 'host.call'.",
    })
    expect(JSON.stringify(result)).not.toMatch(/host-output-secret/)
  })

  test("propagates host interruption instead of returning a diagnostic", async () => {
    const exit = await Effect.runPromiseExit(
      CodeMode.make({
        tools: {
          host: {
            call: Tool.make({
              description: "Interrupt",
              input: Schema.Struct({}),
              output: Schema.String,
              run: () => Effect.interrupt,
            }),
          },
        },
      }).execute("return await tools.host.call({})"),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    }
  })
})

describe("CodeMode tool-call observation", () => {
  test("reports the tools actually invoked with decoded input", async () => {
    const calls: Array<unknown> = []
    const lookup = Tool.make({
      description: "Look up a value",
      input: Schema.Struct({ query: Schema.String }),
      output: Schema.String,
      run: ({ query }) => Effect.succeed(query),
    })

    const result = await Effect.runPromise(
      CodeMode.make({
        tools: { context: { lookup } },
        onToolCallStart: (call) => Effect.sync(() => calls.push(call)),
      }).execute(`
        if (false) await tools.context.lookup({ query: "not called" })
        return await tools.context.lookup({ query: "deployment failure" })
      `),
    )

    expect(result.ok).toBe(true)
    expect(calls).toStrictEqual([
      { index: 0, name: "context.lookup", input: { query: "deployment failure" } },
    ])
  })

  test("observes settled calls with outcome and duration", async () => {
    const events: Array<{ phase: string; index: number; name: string; outcome?: string; message?: string }> = []
    const lookup = Tool.make({
      description: "Look up a value",
      input: Schema.Struct({ query: Schema.String }),
      output: Schema.String,
      run: ({ query }) =>
        query === "boom" ? Effect.fail(toolError("Lookup refused")) : Effect.succeed(query),
    })

    const runtime = CodeMode.make({
      tools: { context: { lookup } },
      onToolCallStart: (call) => Effect.sync(() => {
        events.push({ phase: "start", index: call.index, name: call.name })
      }),
      onToolCallEnd: (call) => Effect.sync(() => {
        expect(call.durationMs).toBeGreaterThanOrEqual(0)
        events.push({
          phase: "end",
          index: call.index,
          name: call.name,
          outcome: call.outcome,
          ...(call.message === undefined ? {} : { message: call.message }),
        })
      }),
    })

    const success = await Effect.runPromise(runtime.execute(`return await tools.context.lookup({ query: "ok" })`))
    expect(success.ok).toBe(true)
    const failure = await Effect.runPromise(runtime.execute(`return await tools.context.lookup({ query: "boom" })`))
    expect(failure.ok).toBe(false)

    expect(events).toStrictEqual([
      { phase: "start", index: 0, name: "context.lookup" },
      { phase: "end", index: 0, name: "context.lookup", outcome: "success" },
      { phase: "start", index: 0, name: "context.lookup" },
      { phase: "end", index: 0, name: "context.lookup", outcome: "failure", message: "Lookup refused" },
    ])
  })
})

describe("CodeMode console capture", () => {
  test("captures console output as bounded result logs", async () => {
    const result = await Effect.runPromise(CodeMode.execute({
      code: `
        const returned = console.log("Thread info:", { name: "Demo", count: 2 })
        console.warn("careful")
        return returned
      `,
    }))

    expect(result).toStrictEqual({
      ok: true,
      value: null,
      logs: ['Thread info: {"name":"Demo","count":2}', "[warn] careful"],
      toolCalls: [],
    })
    expect(Schema.decodeUnknownSync(ExecuteResultSchema)(JSON.parse(JSON.stringify(result)))).toStrictEqual(result)
  })

  test("keeps logs captured before failures", async () => {
    const result = await Effect.runPromise(CodeMode.execute({
      code: `
        console.log("before failure")
        throw new Error("boom")
      `,
    }))

    expect(result.ok ? undefined : result.logs).toStrictEqual(["before failure"])
    expect(result.ok ? undefined : result.error.message).toBe("Uncaught: boom")
  })

  test("captures console.dir and console.table output", async () => {
    const result = await Effect.runPromise(CodeMode.execute({
      code: `
        console.dir({ nested: { ok: true } })
        console.table([
          { name: "Kit", count: 1, hidden: "x" },
          { name: "Olive", count: 2, hidden: "y" }
        ], ["name", "count"])
        return "done"
      `,
    }))

    expect(result).toStrictEqual({
      ok: true,
      value: "done",
      logs: [
        '{"nested":{"ok":true}}',
        "(index)\tname\tcount\n0\tKit\t1\n1\tOlive\t2",
      ],
      toolCalls: [],
    })
  })
})

describe("CodeMode output budget", () => {
  test("truncates an oversized result value with a marker instead of failing", async () => {
    const limits: InternalExecutionLimits = { maxOutputBytes: 40 }
    const result = await Effect.runPromise(CodeMode.execute({
      code: `return { data: "${"x".repeat(200)}" }`,
      limits,
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.truncated).toBe(true)
    expect(typeof result.value).toBe("string")
    expect(result.value).toMatch(/^\{"data":"x+ \[result truncated: \d+ bytes exceeds the 40-byte output limit; return a smaller value\]$/)
    expect(Schema.decodeUnknownSync(ExecuteResultSchema)(JSON.parse(JSON.stringify(result)))).toStrictEqual(result)
  })

  test("keeps leading logs within the remaining budget and marks the cut", async () => {
    const limits: InternalExecutionLimits = { maxOutputBytes: 40 }
    const result = await Effect.runPromise(CodeMode.execute({
      code: `
        console.log("first line")
        console.log("${"y".repeat(200)}")
        return "ok"
      `,
      limits,
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe("ok")
    expect(result.truncated).toBe(true)
    expect(result.logs).toStrictEqual(["first line", "[logs truncated: showing 1 of 2 lines]"])
  })

  test("does not mark results within the budget", async () => {
    const result = await Effect.runPromise(CodeMode.execute({
      code: `
        console.log("fits")
        return { fits: true }
      `,
    }))
    expect(result).toStrictEqual({
      ok: true,
      value: { fits: true },
      logs: ["fits"],
      toolCalls: [],
    })
  })
})

describe("CodeMode schema flexibility", () => {
  test("accepts render-only JSON Schema input and omitted output", async () => {
    const observed: Array<unknown> = []
    const call = Tool.make({
      description: "Call an adapter-described tool",
      input: {
        type: "object",
        properties: { id: { type: "string" }, count: { type: "number" } },
        required: ["id"],
      },
      run: (input) => Effect.sync(() => {
        observed.push(input)
        return { echoed: input }
      }),
    })
    const runtime = CodeMode.make({ tools: { adapter: { call } } })

    expect(runtime.catalog()).toStrictEqual([{
      path: "adapter.call",
      description: "Call an adapter-described tool",
      signature: "tools.adapter.call(input: { id: string; count?: number }): Promise<unknown>",
    }])

    // JSON Schema is render-only: mistyped input passes through unvalidated.
    const result = await Effect.runPromise(runtime.execute(`return await tools.adapter.call({ id: 42 })`))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toStrictEqual({ echoed: { id: 42 } })
    expect(observed).toStrictEqual([{ id: 42 }])
  })

  test("renders JSON Schema outputs and $defs references", async () => {
    const lookup = Tool.make({
      description: "Look up a user",
      input: { type: "object", properties: { login: { type: "string" } }, required: ["login"] },
      output: {
        $ref: "#/$defs/User",
        $defs: { User: { type: "object", properties: { login: { type: "string" }, id: { type: "number" } }, required: ["login", "id"] } },
      },
      run: () => Effect.succeed({ login: "kit", id: 7 }),
    })
    const runtime = CodeMode.make({ tools: { users: { lookup } } })

    expect(runtime.catalog()).toStrictEqual([{
      path: "users.lookup",
      description: "Look up a user",
      signature: "tools.users.lookup(input: { login: string }): Promise<{ login: string; id: number }>",
    }])

    const result = await Effect.runPromise(runtime.execute(`return await tools.users.lookup({ login: "kit" })`))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toStrictEqual({ login: "kit", id: 7 })
  })

  test("Effect Schema output without an input transform still renders unknown when omitted", async () => {
    const ping = Tool.make({
      description: "Ping",
      input: Schema.Struct({ host: Schema.String }),
      run: () => Effect.succeed("pong"),
    })
    const runtime = CodeMode.make({ tools: { net: { ping } } })
    expect(runtime.catalog()[0]?.signature).toBe("tools.net.ping(input: { host: string }): Promise<unknown>")

    const result = await Effect.runPromise(runtime.execute(`return await tools.net.ping({ host: "example.test" })`))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe("pong")
  })
})

describe("CodeMode public contract", () => {
  const lookup = Tool.make({
    description: "Look up an order by ID",
    input: Schema.Struct({ id: Schema.String }),
    output: Schema.Struct({ id: Schema.String, status: Schema.String }),
    run: ({ id }) => Effect.succeed({ id, status: "open" }),
  })
  const tools = { orders: { lookup } }
  const source = `return await tools.orders.lookup({ id: "order_42" })`

  test("keeps one-shot, reusable, and agent-tool execution equivalent", async () => {
    const runtime = CodeMode.make({ tools })
    const agentTool = runtime.agentTool()
    const [oneShot, reusable, projected] = await Promise.all([
      Effect.runPromise(CodeMode.execute({ tools, code: source })),
      Effect.runPromise(runtime.execute(source)),
      Effect.runPromise(agentTool.execute({ code: source })),
    ])

    expect(reusable).toStrictEqual(oneShot)
    expect(projected).toStrictEqual(oneShot)
    expect(agentTool.name).toBe("code")
    expect(agentTool.input).toBe(ExecuteInputSchema)
    expect(agentTool.output).toBe(ExecuteResultSchema)
    expect(agentTool.description).toBe(runtime.instructions())
    expect(Schema.decodeUnknownSync(ExecuteResultSchema)(JSON.parse(JSON.stringify(projected)))).toStrictEqual(projected)
  })

  test("inlines a COMPLETE small catalog and keeps search registered but unadvertised", async () => {
    const runtime = CodeMode.make({ tools })
    expect(runtime.catalog()).toStrictEqual([{
      path: "orders.lookup",
      description: "Look up an order by ID",
      signature: "tools.orders.lookup(input: { id: string }): Promise<{ id: string; status: string }>",
    }])
    expect(runtime.instructions()).toContain("Available tools (COMPLETE list")
    expect(runtime.instructions()).toContain("- orders (1 tool)")
    expect(runtime.instructions()).toContain(
      "  - tools.orders.lookup(input: { id: string }): Promise<{ id: string; status: string }> // Look up an order by ID",
    )
    // A fully inlined catalog does not advertise search in the instructions...
    expect(runtime.instructions()).not.toMatch(/\$codemode/)

    // ...but the search tool stays registered, so a speculative call still works.
    const result = await Effect.runPromise(runtime.execute(`return await tools.$codemode.search({ query: "order" })`))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toStrictEqual({
        items: [{
          path: "tools.orders.lookup",
          description: "Look up an order by ID",
          signature: "tools.orders.lookup(input: { id: string }): Promise<{ id: string; status: string }>",
        }],
        total: 1,
      })
    }
  })

  test("instructions use markdown sections with placeholder-only call forms", () => {
    const runtime = CodeMode.make({ tools })
    const instructions = runtime.instructions()
    // Sections in order: workflow at the top, catalog at the bottom.
    expect(instructions).toContain("## Workflow")
    expect(instructions).toContain("## Rules")
    expect(instructions).toContain("## Syntax")
    expect(instructions.indexOf("## Workflow")).toBeLessThan(instructions.indexOf("## Rules"))
    expect(instructions.indexOf("## Rules")).toBeLessThan(instructions.indexOf("## Syntax"))
    expect(instructions.indexOf("## Syntax")).toBeLessThan(instructions.indexOf("\n## Available tools (COMPLETE list"))
    // Rules carry the result-shape guidance.
    expect(instructions).toContain("if a result is a string, JSON.parse it before reading fields")
    expect(instructions).toContain("Return small: extract only the fields you need")
    expect(instructions).toContain("Call a tool by its path: `await tools.<namespace>.<tool>(input)`.")
    // Placeholders use the <namespace>.<tool>/<field> style ONLY — no fabricated tool
    // names, and no real catalog tools cherry-picked into example lines.
    expect(instructions).toContain("`return { <field>: data.<field> }`")
    expect(instructions).not.toContain("total_count")
    expect(instructions).not.toContain("list_issues")
    expect(instructions).not.toContain("tools.orders.lookup({")
    // COMPLETE: step 1 picks from the inlined list; search is not advertised.
    expect(instructions).toContain("1. Pick a tool from the list under `## Available tools`")
    expect(instructions).not.toContain("Browse one namespace")

    const partial = CodeMode.make({ tools, discovery: { maxInlineCatalogBytes: 0 } }).instructions()
    // PARTIAL: the workflow starts with search and the browse-namespace rule appears.
    expect(partial).toContain(
      '1. Find a tool (skip when it is already listed below): `const { items } = await tools.$codemode.search({ query: "<intent + key nouns>" })`',
    )
    expect(partial).toContain('- Browse one namespace: `await tools.$codemode.search({ query: "", namespace: "<name>" })`.')
    expect(partial).not.toContain("total_count")
    expect(partial).not.toContain("tools.orders.lookup({")
  })

  test("zero tools keep minimal sections and the no-tools notice", () => {
    const runtime = CodeMode.make({})
    const instructions = runtime.instructions()
    expect(instructions).toContain("No tools are currently available.")
    expect(instructions).toContain("## Syntax")
    expect(instructions).toContain("## Available tools")
    expect(instructions).not.toContain("## Workflow")
    expect(instructions).not.toContain("## Rules")
    expect(instructions).not.toMatch(/\$codemode/)
  })

  test("uses one ranked search returning complete definitions for large catalogs", async () => {
    const upload = Tool.make({
      description: "Upload one readable local file to the current Discord thread",
      input: Schema.Struct({ path: Schema.String }),
      output: Schema.Struct({ sent: Schema.Boolean }),
      run: () => Effect.succeed({ sent: true }),
    })
    const generate = Tool.make({
      description: "Generate an image and upload it to the current Discord thread",
      input: Schema.Struct({ prompt: Schema.String }),
      output: Schema.Struct({ sent: Schema.Boolean }),
      run: () => Effect.succeed({ sent: true }),
    })
    const runtime = CodeMode.make({
      tools: { thread: { uploadFile: upload, generateImage: generate }, orders: { lookup } },
      discovery: { maxInlineCatalogBytes: 0 },
    })
    expect(runtime.instructions()).toContain("Available tools (PARTIAL — 0 of 3 shown; find the rest with tools.$codemode.search)")
    expect(runtime.instructions()).toContain("- thread (2 tools, none shown)")
    expect(runtime.instructions()).toContain("- orders (1 tool, none shown)")
    expect(runtime.instructions()).toMatch(/\$codemode\.search/)
    expect(runtime.instructions()).not.toMatch(/tools\.thread\.uploadFile\(input/)

    const result = await Effect.runPromise(runtime.execute(`
      return await tools.$codemode.search({
        query: "send message attachment upload file to current Discord thread",
        limit: 2
      })
    `))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toStrictEqual({
      items: [
        {
          path: "tools.thread.uploadFile",
          description: "Upload one readable local file to the current Discord thread",
          signature: "tools.thread.uploadFile(input: { path: string }): Promise<{ sent: boolean }>",
        },
        {
          path: "tools.thread.generateImage",
          description: "Generate an image and upload it to the current Discord thread",
          signature: "tools.thread.generateImage(input: { prompt: string }): Promise<{ sent: boolean }>",
        },
      ],
      total: 2,
    })
    expect(result.toolCalls).toStrictEqual([{ name: "$codemode.search" }])

    const variants = await Effect.runPromise(runtime.execute(`
      return await Promise.all([
        tools.$codemode.search({ query: "file" }),
        tools.$codemode.search({ query: "image" })
      ])
    `))
    expect(variants.ok).toBe(true)
    if (variants.ok) {
      expect((variants.value as Array<{ items: Array<{ path: string }> }>)[0]?.items[0]?.path).toBe("tools.thread.uploadFile")
      expect((variants.value as Array<{ items: Array<{ path: string }> }>)[1]?.items[0]?.path).toBe("tools.thread.generateImage")
    }

    const removed = await Effect.runPromise(runtime.execute(`return await tools.$codemode.describe({ path: "thread.uploadFile" })`))
    expect(removed.ok).toBe(false)
    if (!removed.ok) expect(removed.error.kind).toBe("UnknownTool")
  })

  test("search defaults to 10 results and resolves exact tool paths", async () => {
    const tool = (index: number) =>
      Tool.make({
        description: `Numbered tool ${index}`,
        input: Schema.Struct({ id: Schema.String }),
        output: Schema.String,
        run: () => Effect.succeed("ok"),
      })
    const runtime = CodeMode.make({
      tools: {
        many: Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`tool${index}`, tool(index)])),
      },
    })

    const browse = await Effect.runPromise(runtime.execute(`return await tools.$codemode.search({})`))
    expect(browse.ok).toBe(true)
    if (browse.ok) {
      const value = browse.value as { items: Array<{ path: string }>; total: number }
      expect(value.items).toHaveLength(10)
      expect(value.total).toBe(14)
    }

    for (const query of ["many.tool13", "tools.many.tool13"]) {
      const exact = await Effect.runPromise(runtime.execute(`return await tools.$codemode.search({ query: ${JSON.stringify(query)} })`))
      expect(exact.ok).toBe(true)
      if (exact.ok) {
        expect(exact.value).toStrictEqual({
          items: [{
            path: "tools.many.tool13",
            description: "Numbered tool 13",
            signature: "tools.many.tool13(input: { id: string }): Promise<string>",
          }],
          total: 1,
        })
      }
    }
  })

  test("scopes search to one namespace and browses it alphabetically", async () => {
    const simple = (description: string) =>
      Tool.make({
        description,
        input: Schema.Struct({ id: Schema.String }),
        output: Schema.String,
        run: () => Effect.succeed("ok"),
      })
    const runtime = CodeMode.make({
      tools: {
        github: { list_issues: simple("List issues"), create_issue: simple("Create an issue") },
        linear: { list_issues: simple("List Linear issues") },
      },
    })

    // Empty query + namespace browses just that namespace, alphabetical by path.
    const browse = await Effect.runPromise(runtime.execute(
      `return await tools.$codemode.search({ query: "", namespace: "github" })`,
    ))
    expect(browse.ok).toBe(true)
    if (browse.ok) {
      const value = browse.value as { items: Array<{ path: string }>; total: number }
      expect(value.total).toBe(2)
      expect(value.items.map((item) => item.path)).toStrictEqual(["tools.github.create_issue", "tools.github.list_issues"])
    }

    // A query + namespace ranks within that namespace only.
    const scoped = await Effect.runPromise(runtime.execute(
      `return await tools.$codemode.search({ query: "issues", namespace: "linear" })`,
    ))
    expect(scoped.ok).toBe(true)
    if (scoped.ok) {
      const value = scoped.value as { items: Array<{ path: string }>; total: number }
      expect(value.total).toBe(1)
      expect(value.items[0]?.path).toBe("tools.linear.list_issues")
    }

    const invalid = await Effect.runPromise(runtime.execute(
      `return await tools.$codemode.search({ query: "issues", namespace: 7 })`,
    ))
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.kind).toBe("InvalidToolInput")
  })

  test("matches input parameter names and partial-word substrings", async () => {
    const upload = Tool.make({
      description: "Send a document to the workspace",
      input: {
        type: "object",
        properties: { attachment: { type: "string", description: "Local path of the payload to send" } },
        required: ["attachment"],
      },
      run: () => Effect.succeed("ok"),
    })
    const other = Tool.make({
      description: "Rename the workspace",
      input: Schema.Struct({ name: Schema.String }),
      output: Schema.String,
      run: () => Effect.succeed("ok"),
    })
    const runtime = CodeMode.make({ tools: { files: { upload, other } } })

    // "attachment" appears in neither path nor description — only in the input schema's
    // property names, which the searchable text includes.
    const byParameter = await Effect.runPromise(runtime.execute(
      `return await tools.$codemode.search({ query: "attachment" })`,
    ))
    expect(byParameter.ok).toBe(true)
    if (byParameter.ok) {
      const value = byParameter.value as { items: Array<{ path: string }>; total: number }
      expect(value.total).toBe(1)
      expect(value.items[0]?.path).toBe("tools.files.upload")
    }

    // Substring matching: a partial word ("docum") still hits the description.
    const bySubstring = await Effect.runPromise(runtime.execute(
      `return await tools.$codemode.search({ query: "docum" })`,
    ))
    expect(bySubstring.ok).toBe(true)
    if (bySubstring.ok) {
      const value = bySubstring.value as { items: Array<{ path: string }>; total: number }
      expect(value.total).toBe(1)
      expect(value.items[0]?.path).toBe("tools.files.upload")
    }
  })

  test("empty query lists everything alphabetically by path", async () => {
    const simple = (description: string) =>
      Tool.make({
        description,
        input: Schema.Struct({}),
        output: Schema.String,
        run: () => Effect.succeed("ok"),
      })
    // Deliberately declared out of alphabetical order.
    const runtime = CodeMode.make({
      tools: {
        zeta: { last: simple("Last") },
        alpha: { beta: simple("Middle"), aardvark: simple("First") },
      },
    })
    const browse = await Effect.runPromise(runtime.execute(`return await tools.$codemode.search({})`))
    expect(browse.ok).toBe(true)
    if (browse.ok) {
      const value = browse.value as { items: Array<{ path: string }>; total: number }
      expect(value.items.map((item) => item.path)).toStrictEqual([
        "tools.alpha.aardvark",
        "tools.alpha.beta",
        "tools.zeta.last",
      ])
    }
  })

  test("inlines cheapest signatures first within the byte budget and labels every namespace", () => {
    const cheap = Tool.make({
      description: "Cheap",
      input: Schema.Struct({ q: Schema.String }),
      output: Schema.String,
      run: () => Effect.succeed("ok"),
    })
    const expensive = Tool.make({
      description: "An expensive tool whose description alone consumes far more than the remaining inline catalog byte budget for this runtime",
      input: Schema.Struct({ someRatherLongParameterName: Schema.String, anotherEvenLongerParameterName: Schema.Number }),
      output: Schema.String,
      run: () => Effect.succeed("ok"),
    })
    // Budget fits alpha.cheap (70 bytes incl. newline) and would numerically fit
    // beta.cheap, but alpha.expensive exhausts the budget first — inlining stops for
    // every remaining namespace, exactly like the ported preview algorithm.
    const runtime = CodeMode.make({
      tools: { alpha: { cheap, expensive }, beta: { cheap } },
      discovery: { maxInlineCatalogBytes: 145 },
    })

    const instructions = runtime.instructions()
    expect(instructions).toContain("Available tools (PARTIAL — 1 of 3 shown; find the rest with tools.$codemode.search)")
    expect(instructions).toContain("- alpha (2 tools, 1 shown)")
    expect(instructions).toContain("  - tools.alpha.cheap(input: { q: string }): Promise<string> // Cheap")
    expect(instructions).not.toContain("tools.alpha.expensive(")
    expect(instructions).toContain("- beta (1 tool, none shown)")
    expect(instructions).toMatch(/\$codemode\.search/)
  })

  test("decodes tool input and output before exposing either side", async () => {
    const observed: Array<unknown> = []
    const transformed = Tool.make({
      description: "Double a number",
      input: Schema.Struct({ value: Schema.NumberFromString }),
      output: Schema.NumberFromString,
      run: ({ value }) => Effect.sync(() => {
        observed.push(value)
        return String(value * 2)
      }),
    })
    const runtime = CodeMode.make({
      tools: { math: { double: transformed } },
      onToolCallStart: (call) => Effect.sync(() => observed.push(call.input)),
    })

    const success = await Effect.runPromise(runtime.execute(`return await tools.math.double({ value: "21" })`))
    expect(success).toStrictEqual({ ok: true, value: 42, toolCalls: [{ name: "math.double" }] })
    expect(observed).toStrictEqual([{ value: 21 }, 21])

    const invalid = await Effect.runPromise(runtime.execute(`return await tools.math.double({ value: 21 })`))
    expect(invalid.ok).toBe(false)
    if (invalid.ok) return
    expect(invalid.error.kind).toBe("InvalidToolInput")
    expect(observed).toStrictEqual([{ value: 21 }, 21])
  })

  test("returns JSON-safe data and normalizes undefined to null", async () => {
    const result = await Effect.runPromise(CodeMode.execute({
      code: `return { top: undefined, nested: [1, undefined] }`,
    }))
    expect(result).toStrictEqual({
      ok: true,
      value: { top: null, nested: [1, null] },
      toolCalls: [],
    })
    expect(Schema.decodeUnknownSync(ExecuteResultSchema)(JSON.parse(JSON.stringify(result)))).toStrictEqual(result)

    const dataLimits: InternalExecutionLimits = { maxDataBytes: 5 }
    const oversized = await Effect.runPromise(CodeMode.execute({
      code: `return { value: undefined }`,
      limits: dataLimits,
    }))
    expect(oversized.ok).toBe(false)
    if (!oversized.ok) expect(oversized.error.kind).toBe("InvalidDataValue")
  })

  test("rejects invalid configuration and discovery limits", async () => {
    const invalidConcurrency: InternalExecutionLimits = { maxConcurrency: 0 }
    expect(() => CodeMode.make({ limits: invalidConcurrency })).toThrow(RangeError)
    expect(() => CodeMode.execute({ code: "return 1", limits: { timeoutMs: Number.POSITIVE_INFINITY } })).toThrow(RangeError)
    expect(() => CodeMode.execute({ code: "return 1", limits: { maxOutputBytes: -1 } })).toThrow(RangeError)

    expect(() => CodeMode.make({ tools, discovery: { maxInlineCatalogBytes: -1 } })).toThrow(RangeError)

    const result = await Effect.runPromise(CodeMode.make({
      tools,
      discovery: { maxInlineCatalogBytes: 0 },
    }).execute(
      `return await tools.$codemode.search({ query: "order", limit: 0.5 })`,
    ))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("InvalidToolInput")
  })

  test("enforces source, operation, and tool-call limits as diagnostics", async () => {
    const sourceLimits: InternalExecutionLimits = { maxSourceBytes: 1 }
    const operationLimits: InternalExecutionLimits = { maxOperations: 10 }
    const cases = [
      [CodeMode.execute({ code: "return 1", limits: sourceLimits }), "InvalidDataValue"],
      [CodeMode.execute({ code: "while (true) {}", limits: operationLimits }), "OperationLimitExceeded"],
      [CodeMode.execute({ tools, code: source, limits: { maxToolCalls: 0 } }), "ToolCallLimitExceeded"],
    ] as const

    for (const [effect, kind] of cases) {
      const result = await Effect.runPromise(effect)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe(kind)
    }
  })

  test("reserves the discovery namespace", () => {
    expect(() => CodeMode.make({ tools: { $codemode: { lookup } } })).toThrow(
      /reserved for CodeMode discovery tools/,
    )
  })
})
