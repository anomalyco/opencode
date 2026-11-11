import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { CodeModeTool } from "@opencode/core/codemode/tool"
import { Config } from "@opencode/core/config"
import { Flag } from "@opencode/core/flag"
import { Permission } from "@opencode/core/permission"
import { Tool } from "@opencode/core/tool"
import { execute } from "@opencode/core/tool/runtime"
import { Agent } from "@opencode/schema/agent"
import { Document, Info as ConfigInfo } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import type { Info } from "@opencode/schema/tool"
import { Deferred, Effect, Fiber, Schema } from "effect"
import { TestClock } from "effect/testing"
import { it } from "./lib/effect"
import { permissionService } from "./lib/permission"

const context = {
  sessionID: Session.ID.make("ses_execute"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_execute"),
  id: Tool.CallID.make("call_execute"),
  progress: () => Effect.void,
}

const allowAll = permissionService({ assert: () => Effect.void })

const vmFlag = (codemode_vm: boolean): Flag.Interface => {
  const resolve: Flag.Interface["resolve"] = (entries) =>
    Flag.resolve({
      entries,
      channel: codemode_vm ? "dev" : "latest",
      overrides: `${codemode_vm ? "" : "-"}codemode_vm`,
    })
  const all = Effect.sync(() => resolve([]))
  return {
    resolve,
    all,
    enabled: (key) => Effect.map(all, (flags) => flags[key].enabled),
  }
}

const createCodeMode = (tools: ReadonlyMap<string, Info>, permission = allowAll, flag = vmFlag(false)) =>
  CodeModeTool.create({ tools }, (_, tool, input, context) => execute(tool, input, context), permission, flag)

test("execute takes raw code as freeform text, and Code Mode calls freeform tools with a string", async () => {
  const input = Schema.Struct({ text: Schema.NonEmptyString })
  const send = {
    name: "send",
    description: "Send text",
    input,
    output: Schema.String,
    execute: ({ text }) => Effect.succeed({ output: text }),
  } satisfies Info<typeof input, typeof Schema.String>
  const tools = new Map<string, Info>([
    ["echo", { ...send, name: "echo" }],
    ["send", { ...send, freeform: { type: "text" } }],
  ])
  const codeMode = createCodeMode(tools)
  expect(codeMode.freeform).toEqual({ type: "text" })
  expect(CodeModeTool.catalog({ tools }).tools.map((tool) => "signature" in tool && tool.signature)).toEqual([
    "tools.echo({\n  /** @minLength 1 */\n  text: string,\n}): Promise<string>",
    "tools.send(/** @minLength 1 */ text: string): Promise<string>",
  ])
  const calls = await Effect.runPromise(
    codeMode.execute({ code: 'return [await tools.send("first"), await tools.send({text: "second"})]' }, context),
  )
  expect(JSON.parse(calls.output.output)).toEqual(["first", "second"])
  expect(calls.output.toolCalls.map((call) => call.input)).toEqual([{ text: "first" }, { text: "second" }])
})

test("execute describes invariant Code Mode behavior", () => {
  expect(createCodeMode(new Map()).description).toBe(
    [
      "Run JavaScript in a confined Code Mode runtime to script tool calls and HTTP requests and compose their results.",
      "Write plain JavaScript and send it exactly as written: no code fence, and no JSON or other wrapper around it.",
      "`fetch` is available for HTTP requests. Imports, direct filesystem access, and timers are unavailable: there is no `setTimeout` or sleep. All other external access goes through `tools`.",
      "Inside `execute`, the only callable tools are those explicitly listed in the Code Mode catalog instructions or returned by the `search` function. Ignore tools shown outside the Code Mode catalog. They are not available in the Code Mode runtime.",
      'Call tools through `tools` using only exact paths and signatures from the catalog. Do not infer or normalize tool names; preserve bracket notation such as `tools.<namespace>["tool-name"](input)`.',
      "Prefer an explicit `return`; if omitted, the final top-level expression becomes the result.",
      "Await every call whose completion matters; pending calls are interrupted when execution ends. Run independent calls concurrently with `Promise.allSettled`.",
    ].join("\n"),
  )
})

test("canonical execution distinguishes declared, model-only, and raw schema outputs", async () => {
  const declared: Info = {
    name: "declared",
    description: "Declared",
    input: Schema.Struct({ value: Schema.String }),
    output: Schema.Struct({ value: Schema.String }),
    execute: ({ value }) => Effect.succeed({ output: { value } }),
  }
  const modelOnlyInput = Schema.Struct({})
  const modelOnly = {
    name: "model_only",
    description: "Model only",
    input: modelOnlyInput,
    execute: () => Effect.succeed({ content: "visible only", metadata: { kind: "model" } }),
  } satisfies Info<typeof modelOnlyInput, undefined>
  const raw: Info = {
    name: "raw",
    description: "Raw",
    input: {},
    output: {},
    execute: (input) => Effect.succeed({ output: input, content: "raw" }),
  }

  expect(await Effect.runPromise(execute(declared, { value: "encoded" }, context))).toEqual({
    output: { value: "encoded" },
    content: [{ type: "text", text: '{"value":"encoded"}' }],
  })
  expect(await Effect.runPromise(execute(modelOnly, {}, context))).toEqual({
    output: undefined,
    content: [{ type: "text", text: "visible only" }],
    metadata: { kind: "model" },
  })
  expect(await Effect.runPromise(execute(raw, { unchecked: true }, context))).toEqual({
    output: { unchecked: true },
    content: [{ type: "text", text: "raw" }],
  })
})

test("declared outputs cannot bypass validation and raw outputs stay JSON-compatible", async () => {
  const missing: Info = {
    name: "missing",
    description: "Missing output",
    input: Schema.Struct({}),
    output: Schema.String,
    execute: () => Effect.succeed({ content: "not an output" }),
  }
  const invalid: Info = {
    name: "invalid",
    description: "Invalid raw output",
    input: {},
    output: {},
    execute: () => Effect.succeed({ output: 1n, content: "not JSON" }),
  }

  expect((await Effect.runPromiseExit(execute(missing, {}, context))).toString()).toContain(
    "Tool did not return its declared output",
  )
  expect((await Effect.runPromiseExit(execute(invalid, {}, context))).toString()).toContain(
    "Tool returned a non-JSON value",
  )
})

test("foreign typed failures settle as Tool.Error at the untrusted boundary", async () => {
  class ForeignFailure extends Schema.TaggedError<ForeignFailure>()("Plugin.ForeignFailure", {
    message: Schema.String,
  }) {}
  const lying: Info = {
    name: "lying",
    description: "Fails with a non-Tool.Error typed failure",
    input: Schema.Struct({}),
    execute: () => new ForeignFailure({ message: "transport died" }) as never,
  }

  const error = await Effect.runPromise(execute(lying, {}, context).pipe(Effect.flip))
  expect(error).toBeInstanceOf(Tool.Error)
  expect(error.message).toBe("transport died")
})

describe.each([
  ["experimental.codemode_vm off (legacy)", false],
  ["experimental.codemode_vm on (vm)", true],
] as const)("%s", (_, vm) => {
  const flag = vmFlag(vm)
  const createMode = (tools: ReadonlyMap<string, Info>, permission = allowAll) =>
    createCodeMode(tools, permission, flag)
  const provideFlag = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect
  const runFlagged = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

  test("execute rejects filesystem fetches", async () => {
    const result = await runFlagged(
      createMode(new Map()).execute({ code: 'return await fetch("file:///blocked.txt")' }, context),
    )

    expect(result.output.error).toBe(true)
    expect(result.output.output).toContain("fetch cannot be used for filesystem access.")
  })

  describe("fetch permissions", () => {
    const hits: Array<string> = []
    let server: ReturnType<typeof Bun.serve>
    beforeAll(() => {
      server = Bun.serve({
        port: 0,
        fetch: (request) => {
          const url = new URL(request.url)
          hits.push(`${request.method} ${url.pathname}`)
          if (url.pathname === "/redirect") return Response.redirect(`${url.origin}/blocked`, 302)
          return new Response("ok")
        },
      })
    })
    afterAll(() => server.stop(true))

    test("fetch asks the webfetch permission for its URL as the execute call", async () => {
      hits.length = 0
      const asked: Array<Permission.AssertInput> = []
      const url = `${server.url.origin}/allowed`
      const result = await runFlagged(
        createMode(
          new Map(),
          permissionService({ assert: (input) => Effect.sync(() => void asked.push(input)) }),
        ).execute({ code: `return await (await fetch("${url}", { method: "POST" })).text()` }, context),
      )

      expect(result.output.output).toBe("ok")
      expect(hits).toEqual(["POST /allowed"])
      expect(asked).toEqual([
        {
          action: "webfetch",
          resources: [url],
          save: ["*"],
          metadata: { method: "POST", url },
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
        },
      ])
    })

    test("a redirect to a URL denied for webfetch is never requested", async () => {
      hits.length = 0
      const denied = permissionService({
        assert: () => Effect.void,
        assertNotDenied: (input) =>
          Effect.fail(new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources })),
      })
      const result = await runFlagged(
        createMode(new Map(), denied).execute(
          { code: `try { await fetch("${server.url.origin}/redirect") } catch (e) { return e.message }` },
          context,
        ),
      )

      expect(result.output.output).toContain("Permission denied")
      expect(hits).toEqual(["GET /redirect"])
    })

    test("fetch matches rules without the fragment and rejects credentials in the URL", async () => {
      hits.length = 0
      const asked: Array<ReadonlyArray<string>> = []
      const result = await runFlagged(
        createMode(
          new Map(),
          permissionService({ assert: (input) => Effect.sync(() => void asked.push(input.resources)) }),
        ).execute(
          {
            code: `await fetch("${server.url.origin}/allowed#top"); try { await fetch("${server.url.protocol}//user@${server.url.host}/") } catch (e) { return e.message }`,
          },
          context,
        ),
      )

      expect(result.output.output).toBe("fetch cannot be used with credentials in the URL.")
      expect(asked).toEqual([[`${server.url.origin}/allowed`]])
      expect(hits).toEqual(["GET /allowed"])
    })

    test("a rejection with feedback reaches the program as the error message", async () => {
      hits.length = 0
      const url = `${server.url.origin}/corrected`
      const corrected = permissionService({
        assert: () => Effect.fail(new Permission.CorrectedError({ feedback: "use the docs site instead" })),
      })
      const result = await runFlagged(
        createMode(new Map(), corrected).execute(
          { code: `try { await fetch("${url}") } catch (e) { return e.message }` },
          context,
        ),
      )

      expect(result.output.output).toBe(`The user rejected fetching ${url}: use the docs site instead`)
      expect(hits).toEqual([])
    })

    test("a URL denied for webfetch is never requested and rejects like a failed fetch", async () => {
      hits.length = 0
      const url = `${server.url.origin}/denied`
      const denied = permissionService({
        assert: (input) =>
          Effect.fail(new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources })),
      })
      const result = await runFlagged(
        createMode(new Map(), denied).execute(
          { code: `const [denied] = await Promise.allSettled([fetch("${url}")]); return denied.status` },
          context,
        ),
      )

      expect(result.output.output).toBe("rejected")
      expect(hits).toEqual([])
    })
  })

  test("execute supports callable namespace tools", async () => {
    const callable: Info = {
      name: "admin",
      description: "Administer Slack",
      input: Schema.Struct({}),
      output: Schema.String,
      options: { namespace: "slack" },
      execute: () => Effect.succeed({ output: "admin" }),
    }
    const child: Info = {
      name: "create",
      description: "Create a Slack resource",
      input: Schema.Struct({}),
      output: Schema.String,
      options: { namespace: "slack.admin" },
      execute: () => Effect.succeed({ output: "created" }),
    }
    const codeMode = createMode(
      new Map([
        ["slack_admin", callable],
        ["slack_admin_create", child],
      ]),
    )
    const result = await runFlagged(
      codeMode.execute({ code: "return [await tools.slack.admin({}), await tools.slack.admin.create({})]" }, context),
    )

    expect(result.metadata).toEqual({
      toolCalls: [
        { tool: "slack.admin", status: "completed" },
        { tool: "slack.admin.create", status: "completed" },
      ],
    })
    expect(result.content).toEqual([{ type: "text", text: '[\n  "admin",\n  "created"\n]' }])
  })

  test("executions share the prepared runtime of an inventory while keeping per-call state", async () => {
    let conversions = 0
    const echo: Info = {
      name: "echo",
      description: "Echo a value",
      input: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (value: unknown) => ({ value }),
          jsonSchema: {
            input: () => {
              conversions++
              return { type: "object", properties: { value: { type: "string" } }, required: ["value"] }
            },
            output: () => ({}),
          },
        },
      },
      execute: (input, context) => Effect.succeed({ content: `${context.id}:${(input as { value: string }).value}` }),
    }
    const inventory = { tools: new Map([["echo", echo]]) }
    const codeMode = CodeModeTool.create(
      inventory,
      (_, tool, input, context) => execute(tool, input, context),
      allowAll,
      flag,
    )
    const run = (id: string) => {
      const progress: Array<Tool.Metadata> = []
      return CodeModeTool.create(inventory, (_, tool, input, context) => execute(tool, input, context), allowAll, flag)
        .execute(
          { code: `return await tools.echo({ value: "${id}" })` },
          { ...context, id: Tool.CallID.make(id), progress: (update) => Effect.sync(() => progress.push(update)) },
        )
        .pipe(Effect.map((result) => ({ output: result.output.output, progress })))
    }

    const results = await runFlagged(
      Effect.all([run("first"), run("second")], { concurrency: "unbounded" }).pipe(Effect.provide(TestClock.layer())),
    )
    expect(CodeModeTool.catalog(inventory).tools).toHaveLength(1)
    expect<unknown>(results).toEqual(
      ["first", "second"].map((id) => ({
        output: `${id}:${id}`,
        progress: [{ toolCalls: [{ tool: "echo", status: "running", input: { value: id } }] }],
      })),
    )
    expect(
      (await runFlagged(codeMode.execute({ code: 'return await tools.echo({ value: "x" })' }, context))).output.output,
    ).toBe("call_execute:x")
    expect(conversions).toBe(1)

    await runFlagged(
      createMode(new Map(inventory.tools)).execute({ code: 'return await tools.echo({ value: "next" })' }, context),
    )
    expect(conversions).toBe(2)
  })

  const progressCodeMode = (started: Deferred.Deferred<void>, wait: Effect.Effect<void>) =>
    createMode(
      new Map<string, Info>([
        [
          "step",
          {
            name: "step",
            description: "Step",
            input: Schema.Struct({}),
            output: Schema.String,
            execute: () => Effect.succeed({ output: "ok" }),
          },
        ],
        [
          "wait",
          {
            name: "wait",
            description: "Wait",
            input: Schema.Struct({}),
            output: Schema.String,
            execute: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(wait), Effect.as({ output: "ok" })),
          },
        ],
      ]),
    )

  const row = (tool: string, status: string) => ({ tool, status })

  it.effect("execute sends at most one progress update per 100 ms with the latest rows", () =>
    provideFlag(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const progress: Array<Tool.Metadata> = []
        const fiber = yield* progressCodeMode(started, Effect.sleep("250 millis"))
          .execute(
            {
              code: "for (const i of [1, 2, 3]) await tools.step({}); await tools.wait({}); return await tools.step({})",
            },
            { ...context, progress: (update) => Effect.sync(() => progress.push(update)) },
          )
          .pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(started)
        yield* Effect.yieldNow
        expect(progress).toEqual([{ toolCalls: [row("step", "running")] }])

        yield* TestClock.adjust("100 millis")
        const steps = [row("step", "completed"), row("step", "completed"), row("step", "completed")]
        expect(progress.slice(1)).toEqual([{ toolCalls: [...steps, row("wait", "running")] }])

        // The wait ends 150 ms after the trailing update, so its row goes out at once; the last step's never does.
        yield* TestClock.adjust("150 millis")
        const result = yield* Fiber.join(fiber)
        yield* TestClock.adjust("1 second")
        expect(progress.slice(2)).toEqual([{ toolCalls: [...steps, row("wait", "completed")] }])
        expect(result.metadata).toEqual({ toolCalls: [...steps, row("wait", "completed"), row("step", "completed")] })
      }),
    ),
  )

  it.effect("interrupted execute sends its latest progress rows before it settles", () =>
    provideFlag(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const progress: Array<Tool.Metadata> = []
        const fiber = yield* progressCodeMode(started, Effect.never)
          .execute(
            { code: "await tools.step({}); await tools.step({}); return await tools.wait({})" },
            { ...context, progress: (update) => Effect.sync(() => progress.push(update)) },
          )
          .pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(started)
        yield* Fiber.interrupt(fiber)
        yield* TestClock.adjust("1 second")
        expect(progress).toEqual([
          { toolCalls: [row("step", "running")] },
          { toolCalls: [row("step", "completed"), row("step", "completed"), row("wait", "error")] },
        ])
      }),
    ),
  )
})

test("runtime cache is keyed per engine when experimental.codemode_vm toggles", async () => {
  let conversions = 0
  const echo: Info = {
    name: "echo",
    description: "Echo a value",
    input: {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
        jsonSchema: {
          input: () => {
            conversions++
            return { type: "object", properties: { value: { type: "string" } }, required: ["value"] }
          },
          output: () => ({}),
        },
      },
    },
    execute: (input) => Effect.succeed({ content: (input as { value: string }).value }),
  }
  const document = (codemode_vm: boolean) =>
    new Document({
      type: "document",
      info: new ConfigInfo({ experimental: new ConfigExperimental.Info({ codemode_vm }) }),
    })
  const inventory = { tools: new Map([["echo", echo]]) }

  await Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* Config.Test
      const flag = yield* Flag.Service
      const codeMode = CodeModeTool.create(
        inventory,
        (_, tool, input, context) => execute(tool, input, context),
        allowAll,
        flag,
      )

      // Legacy engine (flag off) builds and reuses the legacy runtime
      yield* codeMode.execute({ code: 'return await tools.echo({ value: "a" })' }, context)
      yield* codeMode.execute({ code: 'return await tools.echo({ value: "b" })' }, context)
      expect(conversions).toBe(1)

      // VM engine (flag on) builds and reuses its own runtime instance for the same inventory
      yield* config.setEntries([document(true)])
      yield* codeMode.execute({ code: 'return await tools.echo({ value: "c" })' }, context)
      yield* codeMode.execute({ code: 'return await tools.echo({ value: "d" })' }, context)
      expect(conversions).toBe(2)

      // Reading the catalog reuses the cached runtime without rebuilding
      expect(CodeModeTool.catalog(inventory).tools).toHaveLength(1)
      expect(conversions).toBe(2)
    }).pipe(Effect.provide(Flag.testLayer([document(false)]))),
  )
})

describe("codemode_vm follows the flag registry", () => {
  const document = (experimental: ConstructorParameters<typeof ConfigExperimental.Info>[0]) =>
    new Document({
      type: "document",
      info: new ConfigInfo({ experimental: new ConfigExperimental.Info(experimental) }),
    })

  // A fresh inventory prepares its tools once per engine, so a second conversion after a legacy run means the VM ran.
  const engine = async (input: {
    readonly channel: string
    readonly overrides?: string
    readonly entries?: Array<Document>
  }) => {
    let conversions = 0
    const echo: Info = {
      name: "echo",
      description: "Echo a value",
      input: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (value: unknown) => ({ value }),
          jsonSchema: {
            input: () => {
              conversions++
              return { type: "object", properties: { value: { type: "string" } }, required: ["value"] }
            },
            output: () => ({}),
          },
        },
      },
      execute: (input) => Effect.succeed({ content: (input as { value: string }).value }),
    }
    const inventory = { tools: new Map([["echo", echo]]) }
    await Effect.runPromise(
      CodeModeTool.create(inventory, (_, tool, input, context) => execute(tool, input, context), allowAll, vmFlag(false))
        .execute({ code: 'return await tools.echo({ value: "a" })' }, context),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const flag = yield* Flag.Service
        return yield* CodeModeTool.create(
          inventory,
          (_, tool, input, context) => execute(tool, input, context),
          allowAll,
          flag,
        ).execute({ code: 'return await tools.echo({ value: "a" })' }, context)
      }).pipe(
        Effect.provide(
          Flag.testLayer(input.entries ?? [], {
            app: { channel: input.channel },
            overrides: input.overrides,
          }),
        ),
      ),
    )
    expect(result.output.output).toBe("a")
    return conversions === 2 ? "vm" : "legacy"
  }

  test("is on by default in local and dev builds and off in every other channel", async () => {
    const table = await Promise.all(
      ["local", "dev", "latest", "beta", "pr", "my-branch", "unknown"].map(async (channel) => [
        channel,
        await engine({ channel }),
      ]),
    )
    expect(Object.fromEntries(table)).toEqual({
      local: "vm",
      dev: "vm",
      latest: "legacy",
      beta: "legacy",
      pr: "legacy",
      "my-branch": "legacy",
      unknown: "legacy",
    })
  })

  test("a release build opts in with OPENCODE_FLAGS, config, all or all_flags", async () => {
    expect(await engine({ channel: "latest", overrides: "codemode_vm" })).toBe("vm")
    expect(await engine({ channel: "latest", entries: [document({ codemode_vm: true })] })).toBe("vm")
    expect(await engine({ channel: "latest", overrides: "all" })).toBe("vm")
    expect(await engine({ channel: "latest", entries: [document({ all_flags: true })] })).toBe("vm")
  })

  test("a dev build opts out with OPENCODE_FLAGS or config", async () => {
    expect(await engine({ channel: "dev", overrides: "-codemode_vm" })).toBe("legacy")
    expect(await engine({ channel: "dev", overrides: "all,-codemode_vm" })).toBe("legacy")
    expect(await engine({ channel: "dev", entries: [document({ codemode_vm: false })] })).toBe("legacy")
    expect(await engine({ channel: "dev", entries: [document({ all_flags: true, codemode_vm: false })] })).toBe(
      "legacy",
    )
  })
})
