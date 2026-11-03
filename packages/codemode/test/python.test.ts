import { describe, expect, test } from "bun:test"
import { Cause, Context, Deferred, Effect, Exit, Schema } from "effect"
import { CodeMode, Extension, Tool } from "../src/index.js"

const python = (code: string) => Effect.runPromise(CodeMode.execute({ language: "python", code }))
const echo = Tool.make({
  description: "Look up an item",
  input: Schema.Struct({ id: Schema.Int }),
  output: Schema.Int,
  execute: ({ id }) => Effect.succeed(id),
})

describe("Python programs", () => {
  test.each([
    ["[] or 7", 7],
    ["{} and missing()", {}],
    ["[1] == [True]", true],
    ["{'x': [1]} != {'x': []}", true],
    ["[-3 // 2, -3 % 2, 3 % -2, 2 ** -2, -2 ** 2]", [-2, 1, -1, 0.25, -4]],
    ["[1.0 // 0.1, -1.0 // 0.1]", [9, -10]],
    ["[False is not None, 'a' in {'a': None}, 1 not in []]", [true, true, true]],
    ["['a😀b'[-2], len('a😀b')]", ["😀", 3]],
    ["[i for i in range(5, -1, -1) if 0 < i < 4]", [3, 2, 1]],
    ["10\nx = 1", null],
    ["if True:\n    5", null],
    ["# only a comment", null],
  ])("%s", async (code, result) => {
    expect(await python(String(code))).toEqual({ ok: true, value: result, toolCalls: [] })
  })

  test("indentation, comments, multiline delimiters and control flow", async () => {
    expect(
      await python(
        `data = {\r\n    'seen': [], # multi-line literal\r\n}\r\nfor n in range(10):\r\n    if n < 2:\r\n        continue\r\n    elif n == 5:\r\n        break\r\n    data['seen'].append(n)\r\n\r\nwhile len(data['seen']) < 4:\r\n    data['seen'].append(0)\r\nprint('found', len(data['seen']))\r\nreturn data`,
      ),
    ).toEqual({ ok: true, value: { seen: [2, 3, 4, 0] }, logs: ["found 4"], toolCalls: [] })
  })
  test("comparison chains evaluate the middle operand once and skip the tail", async () => {
    expect(
      await python(
        `seen = []\ndef probe():\n    seen.append(1)\n    return 2\nreturn [1 < probe() <= 2, 4 < probe() < missing(), len(seen)]`,
      ),
    ).toMatchObject({ ok: true, value: [true, false, 2] })
  })
  test("function calls have isolated locals and capture enclosing variables", async () => {
    expect(
      await python(
        `def multiply(n):\n    def apply(m):\n        return n * m\n    return apply\nf = multiply(3)\n[f(x) for x in range(4)]`,
      ),
    ).toMatchObject({ ok: true, value: [0, 3, 6, 9] })
    expect(await python(`x = 3\ndef invalid():\n    return x\n    x = 4\ninvalid()`)).toMatchObject({
      ok: false,
      error: { location: { line: 3, column: 12 } },
    })
  })
  test("calling an async function evaluates arguments now but leaves its body for await", async () => {
    const result = await python(`
def argument():
    print('argument')
    return 5
async def send(n):
    print('sending')
    return n
job = send(argument())
print('ready')
return await job`)
    expect(result).toEqual({ ok: true, value: 5, logs: ["argument", "ready", "sending"], toolCalls: [] })
  })
  test("gather schedules one task per distinct coroutine on the next suspension", async () => {
    const result = await python(`
async def send():
    print('sending')
    return 4
job = send()
group = asyncio.gather(job, job)
print('ready')
return [await group, await group]`)
    expect(result).toEqual({
      ok: true,
      value: [
        [4, 4],
        [4, 4],
      ],
      logs: ["ready", "sending"],
      toolCalls: [],
    })
  })
  test("each await runs only the coroutine it was given; a coroutine cannot run twice", async () => {
    const result = await python(`
async def inner():
    print('inner')
async def outer():
    return inner()
job = await outer()
print('ready')
await job
await job`)
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("already awaited") },
      logs: ["ready", "inner"],
    })
  })
  test("gather does not implicitly await a second awaitable returned by a task", async () => {
    const result = await python(`
async def outer():
    return asyncio.gather()
groups = await asyncio.gather(outer())
return await groups[0]`)
    expect(result).toEqual({ ok: true, value: [], toolCalls: [] })
  })
  test.each([
    "import os",
    "from os import system",
    "class X:\n    pass",
    "async def f(:\n    pass",
    "if True:\n    pass\n  pass",
    "break",
    "const x = 3",
    "def f():\n    await tools.x()",
  ])("rejects the whole program before any host call: %s", async (bad) => {
    const result = await Effect.runPromise(
      CodeMode.execute({ language: "python", tools: { echo }, code: `await tools.echo({'id': 0})\n${bad}` }),
    )
    expect(result).toMatchObject({
      ok: false,
      error: { location: { line: expect.any(Number), column: expect.any(Number) } },
      toolCalls: [],
    })
  })
  test.each([
    "open('/etc/passwd')",
    "__import__('os')",
    "require('fs')",
    "globalThis",
    "fetch('https://example.com')",
    "print.__class__",
    "print.constructor",
    "{}['constructor']",
    "[].__proto__",
  ])("no ambient capabilities: %s", async (code) => {
    expect(await python(code)).toMatchObject({ ok: false, toolCalls: [] })
  })
  test("bounded construction and circular writes fail before exposing a value", async () => {
    for (const code of ["'ab' * 16777216", "range(10000001)", "x = []\nx.append(x)", "x = {}\nx['x'] = x"])
      expect(await python(code)).toMatchObject({ ok: false })
  })
})

describe("shared Code Mode host", () => {
  test("catalog and search advertise executable paths for Python keywords and dollar signs", async () => {
    const runtime = CodeMode.make({ language: "python", tools: { from: { $lookup: echo } } })
    const path = 'tools["from"]["$lookup"]'
    expect(runtime.catalog[0]?.signature).toStartWith(`${path}(`)
    expect(
      await Effect.runPromise(runtime.execute(`return search({"query": "lookup"})["items"][0]["path"]`)),
    ).toMatchObject({ ok: true, value: path })
    expect(await Effect.runPromise(runtime.execute(`return await ${path}({"id": 4})`))).toMatchObject({
      ok: true,
      value: 4,
    })
  })
  test("equivalent JS and Python workflows produce the same output and call trace", async () => {
    const tools = { orders: { "get-id": echo } }
    const result = await Effect.runPromise(
      CodeMode.execute({
        tools,
        bindings: { ids: [2, 1] },
        code: `const matches = search({query:'get-id'}); console.log(matches.items[0].path); return await Promise.all(ids.map(id => tools.orders['get-id']({id})))`,
      }),
    )
    expect(result).toMatchObject({
      ok: true,
      value: [2, 1],
      logs: ['tools.orders["get-id"]'],
      toolCalls: [{ name: "search" }, { name: "orders.get-id" }, { name: "orders.get-id" }],
    })
    expect(
      await Effect.runPromise(
        CodeMode.execute({
          language: "python",
          tools,
          bindings: { ids: [2, 1] },
          code: `import asyncio\nmatches = search({'query': 'get-id'})\nprint(matches['items'][0]['path'])\nasync def lookup(i):\n    return await tools.orders['get-id']({'id': i})\nreturn await asyncio.gather(*[lookup(i) for i in ids])`,
        }),
      ),
    ).toEqual(result)
  })
  test("gather starts both tools before either can finish and preserves input order", async () => {
    const gate = Deferred.makeUnsafe<void>()
    const wait = Tool.make({
      description: "Wait",
      input: Schema.Struct({ id: Schema.Int }),
      output: Schema.Int,
      execute: ({ id }) => Effect.as(id === 1 ? Deferred.await(gate) : Deferred.succeed(gate, undefined), id),
    })
    const result = await Effect.runPromise(
      CodeMode.execute({
        language: "python",
        tools: { wait },
        code: `await asyncio.gather(tools.wait({'id': 1}), tools.wait({'id': 2}))`,
      }),
    )
    expect(result).toMatchObject({ ok: true, value: [1, 2] })
  })
  test("tool validation, discovery and admission use the same budget", async () => {
    const runtime = CodeMode.make({ language: "python", tools: { echo }, limits: { maxToolCalls: 1 } })
    expect(await Effect.runPromise(runtime.execute(`search({})\nawait tools.echo({'id': 1})`))).toMatchObject({
      ok: false,
      error: { kind: "ToolCallLimitExceeded" },
      toolCalls: [{ name: "search" }],
    })
    expect(await Effect.runPromise(runtime.execute(`await tools.echo({'id': '1'})`))).toMatchObject({
      ok: false,
      error: { kind: "InvalidToolInput" },
      toolCalls: [],
    })
    expect(await Effect.runPromise(runtime.execute(`await tools.private()`))).toMatchObject({
      ok: false,
      error: { kind: "UnknownTool" },
      toolCalls: [],
    })
  })
  test("hooks can deny a real tool without invoking it", async () => {
    let called = false
    const denied = Tool.make({
      description: "Forbidden",
      input: Schema.Struct({}),
      execute: () =>
        Effect.sync(() => {
          called = true
        }),
    })
    const result = await Effect.runPromise(
      CodeMode.execute({
        language: "python",
        tools: { denied },
        hooks: { "tool.before": () => Effect.fail(new Error("denied")) },
        code: `try:\n    await tools.denied()\nexcept Exception as err:\n    return str(err)`,
      }),
    )
    expect(result).toMatchObject({
      ok: true,
      value: expect.stringContaining("denied"),
      toolCalls: [{ name: "denied" }],
    })
    expect(called).toBe(false)
  })
  test("bindings and extensions are copied per execution; extension hooks see caller services", async () => {
    class Label extends Context.Service<Label, string>()("test.python/Label") {}
    const observed: string[] = []
    const api = Extension.make({
      name: "api",
      globals: {
        api: {
          label: Extension.async(() =>
            Effect.gen(function* () {
              return yield* Label
            }),
          ),
        },
      },
    })
    const runtime = CodeMode.make({
      language: "python",
      extensions: [api],
      hooks: {
        "extension.before": (call) =>
          Effect.sync(() => {
            observed.push(call.name)
          }),
      },
      limits: { maxToolCalls: 0 },
    })
    const input = { state: ["initial"] }
    const run = runtime
      .execute(`api.label()\nstate.append(await api.label())\nstate`, input)
      .pipe(Effect.provideService(Label, "one"))
    for (let n = 0; n < 2; n++)
      expect(await Effect.runPromise(run)).toEqual({ ok: true, value: ["initial", "one"], toolCalls: [] })
    expect(input.state).toEqual(["initial"])
    expect(observed).toEqual(["api.label", "api.label"])
    expect(() =>
      CodeMode.make({ language: "python", extensions: [Extension.make({ name: "bad", globals: { len: () => 0 } })] }),
    ).toThrow("already defined")
  })
  test("discarded calls do not reach the host; scheduled work is still interrupted when the program finishes", async () => {
    let stopped = 0
    const pending = Tool.make({
      description: "Pending",
      input: Schema.Struct({}),
      execute: () =>
        Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              stopped++
            }),
          ),
        ),
    })
    const runtime = CodeMode.make({ language: "python", tools: { pending, echo } })
    expect(await Effect.runPromise(runtime.execute("tools.pending()\nreturn 7"))).toEqual({
      ok: true,
      value: 7,
      toolCalls: [],
    })
    expect(stopped).toBe(0)
    expect(
      await Effect.runPromise(runtime.execute("asyncio.gather(tools.pending())\nreturn await tools.echo({'id': 7})")),
    ).toEqual({ ok: true, value: 7, toolCalls: [{ name: "echo" }, { name: "pending" }] })
    expect(stopped).toBe(1)
  })
  test.each([
    "tools.echo({'id': 4})",
    "return [tools.echo({'id': 4})]",
    "await tools.echo({'id': tools.echo({'id': 4})})",
  ])("an unawaited coroutine cannot cross the host boundary: %s", async (code) => {
    const result = await Effect.runPromise(CodeMode.execute({ language: "python", tools: { echo }, code }))
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "InvalidDataValue", message: expect.stringContaining("await it first") },
      toolCalls: [],
    })
  })
  test("host interruption cannot be caught as a Python exception", async () => {
    const calls: string[] = []
    const stop = Tool.make({ description: "Stop", input: Schema.Struct({}), execute: () => Effect.interrupt })
    const exit = await Effect.runPromiseExit(
      CodeMode.execute({
        language: "python",
        tools: { stop, echo },
        hooks: {
          "tool.before": (call) =>
            Effect.sync(() => {
              calls.push(call.name)
            }),
        },
        code: `try:\n    await tools.stop()\nexcept Exception:\n    await tools.echo({'id': 1})`,
      }),
    )
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    expect(calls).toEqual(["stop"])
  })
  test("cooperative timeout and UTF-8 output cap", async () => {
    expect(
      await Effect.runPromise(
        CodeMode.execute({ language: "python", limits: { timeoutMs: 25 }, code: "while True:\n    pass" }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "TimeoutExceeded" } })
    expect(
      await Effect.runPromise(
        CodeMode.execute({ language: "python", limits: { maxOutputBytes: 4 }, code: `print('abc')\n'😀😀'` }),
      ),
    ).toMatchObject({
      ok: true,
      truncated: true,
      value: expect.stringContaining("4-byte"),
      logs: [expect.stringContaining("truncated")],
    })
  })
})
