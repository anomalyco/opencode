import { describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Fiber, Schema } from "effect"
import { TestClock } from "effect/testing"
import { CodeMode, Tool, toolError } from "../src/index.js"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())))

describe("optional per-call timeouts", () => {
  test.each(["plain", "idempotent"])("expires one %s invocation without losing successful siblings", (mode) =>
    run(
      Effect.gen(function* () {
        const interrupted: Array<string> = []
        const observed: Array<{ name: string; result: CodeMode.CallResult }> = []
        const pending = () =>
          Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => void interrupted.push("pending"))))
        const runtime = CodeMode.make({
          toolTimeouts: true,
          tools: {
            echo: Tool.make({
              description: "Echo a value",
              input: Schema.Struct({ value: Schema.String }),
              output: Schema.String,
              execute: (input) => Effect.succeed(input.value),
            }),
            pending: Tool.make({
              description: "Wait forever",
              input: Schema.Struct({}),
              output: Schema.String,
              execute: mode === "idempotent" ? Tool.idempotent(pending) : pending,
            }),
          },
          hooks: {
            "tool.after": (call, result) => Effect.sync(() => void observed.push({ name: call.name, result })),
          },
        })
        const fiber = yield* runtime
          .execute(
            `
            const results = await Promise.allSettled([
              tools.echo({ value: "first" }),
              tools.pending({}, { timeoutMs: 100 }),
              tools.echo({ value: "second" }),
            ])
            return results.map(result => result.status === "fulfilled"
              ? result
              : { status: result.status, message: result.reason.message, isError: result.reason instanceof Error })
          `,
          )
          .pipe(Effect.forkChild({ startImmediately: true }))

        yield* TestClock.adjust(99)
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust(1)
        expect(yield* Fiber.join(fiber)).toMatchObject({
          ok: true,
          value: [
            { status: "fulfilled", value: "first" },
            { status: "rejected", message: "Tool 'pending' timed out after 100ms.", isError: true },
            { status: "fulfilled", value: "second" },
          ],
          toolCalls: [{ name: "echo" }, { name: "pending" }, { name: "echo" }],
        })
        expect(interrupted).toEqual(["pending"])
        expect(observed.filter((call) => call.name === "echo").map((call) => call.result.status)).toEqual([
          "success",
          "success",
        ])
        expect(observed.filter((call) => call.name === "pending")).toMatchObject([
          {
            result: {
              status: "failure",
              error: { _tag: "ToolError", message: "Tool 'pending' timed out after 100ms." },
            },
          },
        ])
      }),
    ),
  )

  test.each(["tools.wait({})", "tools.wait({}, {})"])("leaves %s pending until its tool completes", (call) =>
    run(
      Effect.gen(function* () {
        const release = yield* Deferred.make<string>()
        const fiber = yield* CodeMode.make({
          toolTimeouts: true,
          tools: {
            wait: Tool.make({
              description: "Wait for release",
              input: Schema.Struct({}),
              output: Schema.String,
              execute: () => Deferred.await(release),
            }),
          },
        })
          .execute(`return await ${call}`)
          .pipe(Effect.forkChild({ startImmediately: true }))

        yield* TestClock.adjust("1 day")
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(release, "released")
        expect(yield* Fiber.join(fiber)).toMatchObject({ ok: true, value: "released" })
      }),
    ),
  )

  test("keeps timeout controls separate from tool input and catalog signatures", async () => {
    const inputs: Array<unknown> = []
    const hooks: Array<unknown> = []
    const tools = {
      echo: Tool.make({
        description: "Echo input with its own timeout field",
        input: Schema.Struct({ timeoutMs: Schema.Number, value: Schema.String }),
        output: Schema.Struct({ timeoutMs: Schema.Number, value: Schema.String }),
        execute: (input) => Effect.sync(() => (inputs.push(input), input)),
      }),
    }
    const runtime = CodeMode.make({
      toolTimeouts: true,
      tools,
      hooks: { "tool.before": (call) => Effect.sync(() => void hooks.push(call.input)) },
    })
    expect(
      await Effect.runPromise(
        runtime.execute('return await tools.echo({ timeoutMs: 73, value: "keep" }, { timeoutMs: 100 })'),
      ),
    ).toMatchObject({ ok: true, value: { timeoutMs: 73, value: "keep" } })
    expect(inputs).toEqual([{ timeoutMs: 73, value: "keep" }])
    expect(hooks).toEqual(inputs)
    expect(runtime.catalog).toEqual(CodeMode.make({ tools }).catalog)
  })

  test("accepts empty input and freeform strings with call options", async () => {
    const inputs: Array<unknown> = []
    const result = await Effect.runPromise(
      CodeMode.make({
        toolTimeouts: true,
        tools: {
          empty: Tool.make({
            description: "Accept no input fields",
            input: Schema.Struct({}),
            output: Schema.String,
            execute: (input) => Effect.sync(() => (inputs.push(input), "empty")),
          }),
          patch: Tool.make({
            description: "Accept patch text directly",
            freeform: true,
            input: Schema.Struct({ patchText: Schema.String }),
            output: Schema.String,
            execute: (input) => Effect.sync(() => (inputs.push(input), input.patchText)),
          }),
        },
      }).execute('return [await tools.empty({}, { timeoutMs: 100 }), await tools.patch("patch", { timeoutMs: 100 })]'),
    )
    expect(result).toMatchObject({ ok: true, value: ["empty", "patch"] })
    expect(inputs).toEqual([{}, { patchText: "patch" }])
  })

  test.each([undefined, false])("rejects options when capability is %s", async (toolTimeouts) => {
    const calls: Array<string> = []
    const result = await Effect.runPromise(
      CodeMode.make({
        toolTimeouts,
        tools: {
          echo: Tool.make({
            description: "Record execution",
            input: Schema.Struct({}),
            execute: () => Effect.sync(() => void calls.push("execute")),
          }),
        },
        hooks: { "tool.before": () => Effect.sync(() => void calls.push("before")) },
      }).execute("return await tools.echo({}, { timeoutMs: 100 })"),
    )
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "InvalidToolInput", message: "Tool 'echo' expects at most one input object." },
      toolCalls: [],
    })
    expect(calls).toEqual([])
  })

  test.each([
    "undefined",
    "null",
    "true",
    "1",
    '"options"',
    "[]",
    "{ unknown: 1 }",
    "{ timeoutMs: 100, unknown: 1 }",
    "{ timeoutMs: 0 }",
    "{ timeoutMs: -1 }",
    "{ timeoutMs: 1.5 }",
    "{ timeoutMs: Infinity }",
    "{ timeoutMs: NaN }",
    "{ timeoutMs: 9007199254740992 }",
    "{ timeoutMs: null }",
    '{ timeoutMs: "100" }',
    "{ timeoutMs: true }",
  ])("rejects invalid options %s before hooks or tool execution", async (options) => {
    const calls: Array<string> = []
    const result = await Effect.runPromise(
      CodeMode.make({
        toolTimeouts: true,
        tools: {
          echo: Tool.make({
            description: "Record execution",
            input: Schema.Struct({}),
            execute: () => Effect.sync(() => void calls.push("execute")),
          }),
        },
        hooks: {
          "tool.before": () => Effect.sync(() => void calls.push("before")),
          "tool.after": () => Effect.sync(() => void calls.push("after")),
        },
      }).execute(`return await tools.echo({}, ${options})`),
    )
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "InvalidToolInput", message: expect.stringContaining("Invalid call options for tool 'echo'") },
      toolCalls: [],
    })
    expect(calls).toEqual([])
  })

  test("rejects a third argument before execution", async () => {
    const calls: Array<string> = []
    const result = await Effect.runPromise(
      CodeMode.make({
        toolTimeouts: true,
        tools: {
          echo: Tool.make({
            description: "Record execution",
            input: Schema.Struct({}),
            execute: () => Effect.sync(() => void calls.push("execute")),
          }),
        },
      }).execute("return await tools.echo({}, { timeoutMs: 100 }, {})"),
    )
    expect(result).toMatchObject({ ok: false, error: { kind: "InvalidToolInput" }, toolCalls: [] })
    expect(calls).toEqual([])
  })

  test("starts the executable deadline after the before hook", () =>
    run(
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>()
        const fiber = yield* CodeMode.make({
          toolTimeouts: true,
          tools: {
            wait: Tool.make({
              description: "Never settle",
              input: Schema.Struct({}),
              execute: () => Effect.never,
            }),
          },
          hooks: { "tool.before": () => Deferred.await(release) },
        })
          .execute("return await tools.wait({}, { timeoutMs: 100 })")
          .pipe(Effect.forkChild({ startImmediately: true }))

        yield* TestClock.adjust(1_000)
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(release, undefined)
        yield* TestClock.adjust(99)
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust(1)
        expect(yield* Fiber.join(fiber)).toMatchObject({
          ok: false,
          error: { kind: "ToolFailure", message: "Tool 'wait' timed out after 100ms." },
        })
      }),
    ))

  test("requests Promise cancellation and lets the program catch expiry", () =>
    run(
      Effect.gen(function* () {
        const signals: Array<AbortSignal> = []
        const after: Array<CodeMode.CallResult> = []
        const fiber = yield* CodeMode.make({
          toolTimeouts: true,
          tools: {
            wait: Tool.make({
              description: "Wait for abort",
              input: Schema.Struct({}),
              output: Schema.String,
              execute: () =>
                Effect.promise(
                  (signal) =>
                    new Promise<string>((resolve) => {
                      signals.push(signal)
                      signal.addEventListener("abort", () => resolve("aborted"), { once: true })
                    }),
                ),
            }),
          },
          hooks: { "tool.after": (_call, result) => Effect.sync(() => void after.push(result)) },
        })
          .execute(
            `
            try { await tools.wait({}, { timeoutMs: 100 }) }
            catch (error) { return { message: error.message, isError: error instanceof Error } }
            return "not caught"
          `,
          )
          .pipe(Effect.forkChild({ startImmediately: true }))

        yield* TestClock.adjust(100)
        expect(yield* Fiber.join(fiber)).toMatchObject({
          ok: true,
          value: { message: "Tool 'wait' timed out after 100ms.", isError: true },
        })
        expect(signals).toHaveLength(1)
        expect(signals[0].aborted).toBe(true)
        expect(after).toMatchObject([{ status: "failure", error: { _tag: "ToolError" } }])
      }),
    ))

  test("preserves caller interruption with an opted-in deadline", () =>
    run(
      Effect.gen(function* () {
        const after: Array<CodeMode.CallResult> = []
        const fiber = yield* CodeMode.make({
          toolTimeouts: true,
          tools: {
            wait: Tool.make({
              description: "Never settle",
              input: Schema.Struct({}),
              execute: () => Effect.never,
            }),
          },
          hooks: { "tool.after": (_call, result) => Effect.sync(() => void after.push(result)) },
        })
          .execute('try { await tools.wait({}, { timeoutMs: 100 }) } catch { return "caught" }')
          .pipe(Effect.forkChild({ startImmediately: true }))

        yield* TestClock.adjust(1)
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* Fiber.interrupt(fiber)
        const exit = yield* Fiber.await(fiber)
        expect(exit._tag).toBe("Failure")
        if (exit._tag === "Failure") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        expect(after).toEqual([{ status: "interrupted" }])
      }),
    ))

  test("preserves an earlier producer deadline", () =>
    run(
      Effect.gen(function* () {
        const fiber = yield* CodeMode.make({
          toolTimeouts: true,
          tools: {
            wait: Tool.make({
              description: "Fail at its own deadline",
              input: Schema.Struct({}),
              execute: () =>
                Effect.never.pipe(
                  Effect.timeoutOrElse({ duration: 10, orElse: () => Effect.fail(toolError("Producer deadline")) }),
                ),
            }),
          },
        })
          .execute("return await tools.wait({}, { timeoutMs: 100 })")
          .pipe(Effect.forkChild({ startImmediately: true }))

        yield* TestClock.adjust(10)
        expect(yield* Fiber.join(fiber)).toMatchObject({
          ok: false,
          error: { kind: "ToolFailure", message: "Producer deadline" },
        })
      }),
    ))

  test("preserves an earlier interpreter deadline", () =>
    run(
      Effect.gen(function* () {
        const after: Array<CodeMode.CallResult> = []
        const fiber = yield* CodeMode.make({
          toolTimeouts: true,
          limits: { timeoutMs: 10 },
          tools: {
            wait: Tool.make({
              description: "Never settle",
              input: Schema.Struct({}),
              execute: () => Effect.never,
            }),
          },
          hooks: { "tool.after": (_call, result) => Effect.sync(() => void after.push(result)) },
        })
          .execute("return await tools.wait({}, { timeoutMs: 100 })")
          .pipe(Effect.forkChild({ startImmediately: true }))

        yield* TestClock.adjust(10)
        expect(yield* Fiber.join(fiber)).toMatchObject({
          ok: false,
          error: { kind: "TimeoutExceeded", message: "Execution timed out after 10ms." },
        })
        expect(after).toEqual([{ status: "interrupted" }])
      }),
    ))

  test.each(["{}", "{ timeoutMs: 100 }"])("rejects call options %s for durable tools", async (options) => {
    const calls: Array<string> = []
    const result = await Effect.runPromise(
      CodeMode.make({
        toolTimeouts: true,
        tools: {
          durable: Tool.make({
            description: "Keep work across suspension",
            input: Schema.Struct({}),
            output: Schema.String,
            execute: Tool.durable({
              start: () => Effect.sync(() => (calls.push("start"), "data")),
              wait: () => Effect.sync(() => (calls.push("wait"), "done")),
              cancel: () => Effect.sync(() => void calls.push("cancel")),
            }),
          }),
        },
        hooks: {
          "tool.before": () => Effect.sync(() => void calls.push("before")),
          "tool.after": () => Effect.sync(() => void calls.push("after")),
        },
      }).execute(`return await tools.durable({}, ${options})`),
    )
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "InvalidToolInput", message: "Tool 'durable' does not accept call options." },
      toolCalls: [],
    })
    expect(calls).toEqual([])
  })
})
