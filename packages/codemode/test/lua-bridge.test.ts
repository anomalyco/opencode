import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Schema } from "effect"
import { CodeMode, Extension, Tool } from "../src/index.js"
import { executeLua } from "../src/lua.js"
import { copyLuaData } from "../src/lua-data.js"
import { ToolRuntime } from "../src/tool-runtime.js"

const limits = { timeoutMs: undefined, maxToolCalls: undefined, maxOutputBytes: undefined }

test("strict host import never invokes accessors, toJSON, or proxy traps", () => {
  const unexpected = () => {
    throw new Error("host code was invoked")
  }
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  for (const value of [
    {
      get field() {
        return unexpected()
      },
    },
    { toJSON: unexpected },
    Object.create({ inherited: true }),
    new Proxy({}, { getPrototypeOf: unexpected, ownKeys: unexpected }),
    revoked.proxy,
    [undefined],
    new Array(3),
    Object.assign([1], { extra: 2 }),
    Symbol(),
    Infinity,
    Object.defineProperty({}, "hidden", { value: 1 }),
  ])
    expect(() => copyLuaData(value)).toThrow(/JSON/)

  const value = JSON.parse('{"__proto__":{"marker":true},"constructor":null}')
  const copied = copyLuaData(value)
  expect(Object.getPrototypeOf(copied)).toBeNull()
  expect(JSON.stringify(copied)).toBe(JSON.stringify(value))
})

test("strict host import charges depth, expanded nodes and serialized UTF-8 bytes", () => {
  let nested: unknown = 0
  let shared: unknown = 0
  for (let i = 0; i < 32; i++) {
    nested = { nested }
    shared = [shared, shared]
  }
  expect(() => copyLuaData({ nested })).toThrow("nesting limit")
  expect(() => copyLuaData(shared)).toThrow("node limit")
  expect(() => copyLuaData("\u0000".repeat(180_000))).toThrow("byte limit")
  expect(() => copyLuaData("💫".repeat(270_000))).toThrow("byte limit")
  expect(() => copyLuaData({ "\ud800": true, "\ud801": false })).toThrow("valid Unicode")
  const cycle: unknown[] = []
  cycle.push(cycle)
  expect(() => copyLuaData(cycle)).toThrow("Cyclic")
})

test("search, calls, and snapshots resume in order; Effect reuse allocates fresh state", async () => {
  const observed: string[] = []
  const runtime = CodeMode.make({
    language: "lua",
    limits: { maxToolCalls: 2 },
    tools: {
      api: {
        echo: Tool.make({
          description: "Echo a number",
          input: Schema.Struct({ n: Schema.Number }),
          output: Schema.Number,
          execute: ({ n }) => Effect.andThen(Effect.yieldNow, Effect.succeed(n + 1)),
        }),
      },
    },
    hooks: {
      "tool.before": (call) =>
        Effect.sync(() => {
          observed.push(call.name)
        }),
    },
  })
  const run = runtime.execute(
    'local hit = search({query="echo"}).items[1]; print(hit.path); return tools.api.echo({n = n})',
    { n: 8 },
  )
  const result = {
    ok: true,
    value: 9,
    logs: ["tools.api.echo"],
    toolCalls: [{ name: "search" }, { name: "api.echo" }],
  } satisfies CodeMode.Result
  expect(await Effect.runPromise(run)).toEqual(result)
  expect(await Effect.runPromise(run)).toEqual(result)
  expect(observed).toEqual(["search", "api.echo", "search", "api.echo"])
  expect(await Effect.runPromise(runtime.execute("search(); search(); return search()"))).toMatchObject({
    ok: false,
    error: { kind: "ToolCallLimitExceeded" },
    toolCalls: [{ name: "search" }, { name: "search" }],
  })
})

test("bindings, global results and raw tool output all pass strict import", async () => {
  let read = false
  const invalid = {
    get field() {
      read = true
      return 2
    },
  }
  const prepared = ToolRuntime.prepare(
    {
      fn: Tool.make({
        description: "Accessor",
        input: Schema.Struct({}),
        output: Schema.Struct({ field: Schema.Number }),
        execute: () => Effect.succeed(invalid),
      }),
    },
    "lua",
  )
  const ext = new Map([["fetchValue", () => Effect.succeed(invalid)]])
  for (const [run, kind] of [
    [executeLua("return field", prepared, limits, {}, invalid), "InvalidDataValue"],
    [executeLua("return fetchValue()", prepared, limits, {}, undefined, ext), "InvalidDataValue"],
    [executeLua("return tools.fn()", prepared, limits, {}), "InvalidToolOutput"],
  ] as const)
    expect(await Effect.runPromise(run)).toMatchObject({ ok: false, error: { kind } })
  expect(read).toBe(false)
})

test("a thrown host value is not inspected through accessors or string conversion", async () => {
  const unexpected = () => {
    throw new Error("Unexpected coercion")
  }
  const prepared = ToolRuntime.prepare(
    {
      fail: Tool.make({
        description: "Fail",
        input: {},
        execute: () =>
          Effect.fail({
            get message() {
              return unexpected()
            },
            toString: unexpected,
          }),
      }),
    },
    "lua",
  )
  expect(await Effect.runPromise(executeLua("return tools.fail()", prepared, limits, {}))).toMatchObject({
    ok: false,
    error: { kind: "ToolFailure", message: "Host call failed." },
  })
})

test("a tool.after observer cannot mutate the result imported by Lua", async () => {
  const runtime = CodeMode.make({
    language: "lua",
    tools: {
      read: Tool.make({
        description: "Read",
        input: {},
        output: Schema.Unknown,
        execute: () => Effect.succeed({ n: 1 }),
      }),
    },
    hooks: {
      "tool.after": (_, result) =>
        Effect.sync(() => {
          if (result.status === "success" && typeof result.value === "object" && result.value !== null)
            Object.defineProperty(result.value, "n", {
              get() {
                throw new Error("host getter reached")
              },
            })
        }),
    },
  })
  expect(await Effect.runPromise(runtime.execute("return tools.read().n"))).toMatchObject({ ok: true, value: 1 })
})

test("invalid protected lookups consume the Lua call budget without appearing as admitted tools", async () => {
  const runtime = CodeMode.make({ language: "lua", limits: { maxToolCalls: 2 } })
  expect(await Effect.runPromise(runtime.execute("for i=1,3 do pcall(tools.missing) end"))).toMatchObject({
    ok: false,
    error: { kind: "ToolCallLimitExceeded" },
    toolCalls: [],
  })
})

test("tool output DAGs are bounded before schema decoding or JSON stringify", async () => {
  let shared: unknown = 1
  for (let i = 0; i < 20; i++) shared = { left: shared, right: shared }
  const runtime = CodeMode.make({
    language: "lua",
    tools: {
      large: Tool.make({
        description: "DAG",
        input: {},
        output: Schema.Unknown,
        execute: () => Effect.succeed(shared),
      }),
    },
  })
  expect(await Effect.runPromise(runtime.execute("return pcall(tools.large)"))).toMatchObject({
    ok: false,
    error: { kind: "InvalidToolOutput", message: expect.stringContaining("node limit") },
    toolCalls: [{ name: "large" }],
  })
})

test("pcall resumes ordinary tool and extension failures with only a bounded message", async () => {
  const runtime = CodeMode.make({
    language: "lua",
    tools: { deny: Tool.make({ description: "Deny", input: {}, execute: () => Effect.fail(new Error("denied")) }) },
    extensions: [Extension.lua({ name: "test", globals: { fail: () => Effect.fail("nope") } })],
  })
  expect(
    await Effect.runPromise(
      runtime.execute("local a,b = pcall(tools.deny); local c,d = pcall(fail); return {a,b,c,d}"),
    ),
  ).toEqual({
    ok: true,
    value: [false, "denied", false, "nope"],
    toolCalls: [{ name: "deny" }],
  })
})

test("tools and named extension globals share the default 128-call budget; pcall cannot bypass it", async () => {
  let calls = 0
  const hit = () => Effect.sync(() => ++calls)
  const runtime = CodeMode.make({
    language: "lua",
    tools: { hit: Tool.make({ description: "Count", input: {}, output: Schema.Number, execute: hit }) },
    extensions: [Extension.lua({ name: "test", globals: { hit } })],
  })
  for (const last of ["tools.hit", "hit"]) {
    calls = 0
    const result = await Effect.runPromise(
      runtime.execute(`for i=1,64 do tools.hit(); hit() end; return pcall(${last})`),
    )
    expect(result).toMatchObject({ ok: false, error: { kind: "ToolCallLimitExceeded" } })
    expect(result.toolCalls).toHaveLength(64)
    expect(calls).toBe(128)
  }
})

test("output budgets truncate both returned data and accumulated print lines", async () => {
  const runtime = CodeMode.make({ language: "lua", limits: { maxOutputBytes: 6 } })
  expect(
    await Effect.runPromise(runtime.execute('print("a"); print("bcdef"); print("g"); return "1234567890"')),
  ).toMatchObject({
    ok: true,
    value: expect.stringContaining("6-byte output limit"),
    truncated: true,
    logs: [expect.stringContaining("logs truncated")],
  })
})

test("the wall-clock timeout interrupts a CPU-only Lua loop at a slice", async () => {
  expect(
    await Effect.runPromise(CodeMode.make({ language: "lua", limits: { timeoutMs: 1 } }).execute("while true do end")),
  ).toMatchObject({
    ok: false,
    error: { kind: "TimeoutExceeded" },
  })
})

test("interrupting a suspended Lua call runs cleanup before returning and does not resume the program", async () => {
  const events: string[] = []
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const prepared = ToolRuntime.prepare(
        {
          block: Tool.make({
            description: "Wait",
            input: {},
            execute: () =>
              Effect.andThen(Deferred.succeed(started, undefined), Effect.never).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    events.push("clean")
                  }),
                ),
              ),
          }),
        },
        "lua",
      )
      const run = executeLua("pcall(tools.block); tools.block()", prepared, limits, {
        "tool.before": () =>
          Effect.sync(() => {
            events.push("before")
          }),
        "tool.after": (_, result) =>
          Effect.sync(() => {
            events.push(result.status)
          }),
      })
      const fiber = yield* Effect.forkChild(run)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
    }),
  )
  expect(events).toEqual(["before", "clean", "interrupted"])
})
