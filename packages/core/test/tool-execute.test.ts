import { expect, test } from "bun:test"
import { CodeModeTool } from "@opencode/core/codemode/tool"
import { Permission } from "@opencode/core/permission"
import { Tool } from "@opencode/core/tool"
import { execute } from "@opencode/core/tool/runtime"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import type { Info } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"

const context = {
  sessionID: Session.ID.make("ses_execute"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_execute"),
  id: Tool.CallID.make("call_execute"),
  progress: () => Effect.void,
}

const createCodeMode = (
  tools: ReadonlyMap<string, Info>,
  guardFetch: (url: string, context: Tool.Context) => Effect.Effect<void, unknown> = () => Effect.void,
) => CodeModeTool.create({ tools }, (_, tool, input, context) => execute(tool, input, context), guardFetch)

test("execute describes invariant Code Mode behavior", () => {
  expect(createCodeMode(new Map()).description).toBe(
    [
      "Run JavaScript in a confined Code Mode runtime to script tool calls and HTTP requests and compose their results.",
      "`fetch` is available for HTTP requests. Imports, direct filesystem access, and timers are unavailable; all other external access goes through `tools`.",
      "Within `{ code }`, the only callable tools are those explicitly listed in the Code Mode catalog instructions or returned by the `search` function. Inside `{ code }`, ignore tools shown outside the Code Mode catalog. They are not available in the Code Mode runtime.",
      'Call tools through `tools` using only exact paths and signatures from the catalog. Do not infer or normalize tool names; preserve bracket notation such as `tools.<namespace>["tool-name"](input)`.',
      "Prefer an explicit `return`; if omitted, the final top-level expression becomes the result.",
      "Await every call whose completion matters; pending calls are interrupted when execution ends. Run independent calls concurrently with `Promise.allSettled`.",
    ].join("\n"),
  )
})

test("execute rejects filesystem fetches", async () => {
  const result = await Effect.runPromise(
    createCodeMode(new Map()).execute({ code: 'return await fetch("file:///blocked.txt")' }, context),
  )

  expect(result.output.error).toBe(true)
  expect(result.output.output).toContain("fetch cannot be used for filesystem access.")
})

test("execute denies a fetch the host guard refuses", async () => {
  const hits: Array<string> = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => {
      hits.push(request.url)
      return new Response("secret")
    },
  })
  const url = `http://127.0.0.1:${server.port}/probe`
  const seen: Array<string> = []
  try {
    const result = await Effect.runPromise(
      createCodeMode(new Map(), (input) => {
        seen.push(input)
        return Effect.fail(new Permission.BlockedError({ rules: [], permission: "webfetch", resources: [input] }))
      }).execute({ code: `return await fetch(${JSON.stringify(url)})` }, context),
    )

    expect(result.output.error).toBe(true)
    expect(result.output.output).toContain("Permission denied: webfetch")
    expect(seen).toEqual([url])
  } finally {
    server.stop(true)
  }
  expect(hits).toEqual([])
})

test("interrupting execute interrupts a fetch permission check that is still waiting", async () => {
  let entered: () => void = () => {}
  const waiting = new Promise<void>((resolve) => (entered = resolve))
  const interrupted = Promise.withResolvers<void>()
  const tool = createCodeMode(new Map(), () =>
    Effect.gen(function* () {
      entered()
      yield* Effect.never
    }).pipe(Effect.onInterrupt(() => Effect.sync(interrupted.resolve))),
  )

  const abort = new AbortController()
  const executed = Effect.runPromise(
    tool.execute({ code: 'return await fetch("https://example.com/probe")' }, context),
    { signal: abort.signal },
  )
  await waiting
  abort.abort()
  await executed.then(
    () => undefined,
    () => undefined,
  )
  await interrupted.promise
})

test("execute reaches the network when the host guard allows the fetch", async () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("secret") })
  const url = `http://127.0.0.1:${server.port}/probe`
  const seen: Array<string> = []
  try {
    const result = await Effect.runPromise(
      createCodeMode(new Map(), (url) => Effect.sync(() => void seen.push(url))).execute(
        { code: `const response = await fetch("${url}")\nreturn await response.text()` },
        context,
      ),
    )

    expect(result.output.error).toBeUndefined()
    expect(result.output.output).toContain("secret")
  } finally {
    server.stop(true)
  }
  expect(seen).toEqual([url])
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
  const codeMode = createCodeMode(
    new Map([
      ["slack_admin", callable],
      ["slack_admin_create", child],
    ]),
  )
  const result = await Effect.runPromise(
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
