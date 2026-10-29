import { expect, test } from "bun:test"
import { CodeModeTool } from "@opencode/core/codemode/tool"
import { Tool } from "@opencode/core/tool"
import { execute } from "@opencode/core/tool/runtime"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import type { Info } from "@opencode/schema/tool"
import { Deferred, Effect, Fiber, Schema } from "effect"
import { TestClock } from "effect/testing"
import { it } from "./lib/effect"

const context = {
  sessionID: Session.ID.make("ses_execute"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_execute"),
  id: Tool.CallID.make("call_execute"),
  progress: () => Effect.void,
}

const createCodeMode = (tools: ReadonlyMap<string, Info>) =>
  CodeModeTool.create({ tools }, (_, tool, input, context) => execute(tool, input, context))

test("execute describes invariant Code Mode behavior", () => {
  expect(createCodeMode(new Map()).description).toBe(
    [
      "Run JavaScript in a confined Code Mode runtime to script tool calls and HTTP requests and compose their results.",
      "`fetch` is available for HTTP requests. Imports, direct filesystem access, and timers are unavailable: there is no `setTimeout` or sleep. All other external access goes through `tools`.",
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
  const codeMode = CodeModeTool.create(inventory, (_, tool, input, context) => execute(tool, input, context))
  const run = (id: string) => {
    const progress: Array<Tool.Metadata> = []
    return CodeModeTool.create(inventory, (_, tool, input, context) => execute(tool, input, context))
      .execute(
        { code: `return await tools.echo({ value: "${id}" })` },
        { ...context, id: Tool.CallID.make(id), progress: (update) => Effect.sync(() => progress.push(update)) },
      )
      .pipe(Effect.map((result) => ({ output: result.output.output, progress })))
  }

  expect(CodeModeTool.catalog(inventory).tools).toHaveLength(1)
  const results = await Effect.runPromise(
    Effect.all([run("first"), run("second")], { concurrency: "unbounded" }).pipe(Effect.provide(TestClock.layer())),
  )
  expect<unknown>(results).toEqual(
    ["first", "second"].map((id) => ({
      output: `${id}:${id}`,
      progress: [{ toolCalls: [{ tool: "echo", status: "running", input: { value: id } }] }],
    })),
  )
  expect(
    (await Effect.runPromise(codeMode.execute({ code: 'return await tools.echo({ value: "x" })' }, context))).output
      .output,
  ).toBe("call_execute:x")
  expect(conversions).toBe(1)

  await Effect.runPromise(
    createCodeMode(new Map(inventory.tools)).execute({ code: 'return await tools.echo({ value: "next" })' }, context),
  )
  expect(conversions).toBe(2)
})

const progressCodeMode = (started: Deferred.Deferred<void>, wait: Effect.Effect<void>) =>
  createCodeMode(
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
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    const progress: Array<Tool.Metadata> = []
    const fiber = yield* progressCodeMode(started, Effect.sleep("250 millis"))
      .execute(
        { code: "for (const i of [1, 2, 3]) await tools.step({}); await tools.wait({}); return await tools.step({})" },
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
)

it.effect("interrupted execute sends its latest progress rows before it settles", () =>
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
)
