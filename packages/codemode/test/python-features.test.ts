import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Result, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"

const echo = Tool.make({
  description: "Echo ID",
  input: Schema.Struct({ id: Schema.Int }),
  output: Schema.Int,
  execute: ({ id }) => Effect.succeed(id),
})
const runtime = CodeMode.make({ language: "python", tools: { echo } })
const run = (code: string) => Effect.runPromise(runtime.execute(code))

describe("Python sequence and call semantics", () => {
  test("sorts by a lambda and unpacks nested results through an optional gather import", async () => {
    expect(
      await run(`
from asyncio import gather as together
rows = [[1, 4], [3, 8, 9]]
first, *rest = sorted(rows, key=lambda row: row[0], reverse=True)
(id, *values), [small, *_] = first, rest[0]
return values, await together(tools.echo(id=id), tools.echo(id=small))`),
    ).toEqual({
      ok: true,
      value: [
        [8, 9],
        [3, 1],
      ],
      toolCalls: [{ name: "echo" }, { name: "echo" }],
    })
  })
  test("unknown imports abort before a tool runs and identify the available module", async () => {
    expect(await run("await tools.echo(id=1)\nimport requests")).toMatchObject({
      ok: false,
      error: { kind: "UnsupportedSyntax", message: expect.stringContaining("asyncio") },
      toolCalls: [],
    })
  })
  test("slice operands run left to right, once; omitted bounds differ from explicit -1", async () => {
    expect(
      await run(`
def see(x):
    print(x)
    return x
xs = [0, 1, 2, 3]
part = see(xs)[see(3):see(None):see(-2)]
part[0] = 7
return part, xs, xs[3:-1:-2], '😀x💡y'[None:None:-2]`),
    ).toEqual({
      ok: true,
      value: [[7, 1], [0, 1, 2, 3], [], "yx"],
      logs: ["[0, 1, 2, 3]", "3", "None", "-2"],
      toolCalls: [],
    })
  })

  test("tuples preserve their type through slices, concatenation and dictionary items", async () => {
    expect(
      await run(`
t = () + (1,) + (2, 3)
assertions = [t[::-1] == (3, 2, 1), t != [1, 2, 3], {}.items() == []]
for (name, value) in {'x': 1}.items():
    assertions.append((name, value) == ('x', 1))
failure = []
try:
    t[0] = 0
except Exception:
    failure.append('immutable')
try:
    t[:].append(4)
except Exception:
    failure.append('no append')
return assertions, failure, [(v, k) for k, v in {'x': 1}.items()], str((7,))`),
    ).toMatchObject({
      ok: true,
      value: [[true, true, true, true], ["immutable", "no append"], [[1, "x"]], "(7,)"],
    })
  })

  test("large strided slices preserve code points across output chunks", async () => {
    expect(await run(`return ('x😀' * 4099)[::-2] == '😀' * 4099`)).toMatchObject({ ok: true, value: true })
  })

  test("unpacking validates the whole RHS before rebinding; unpacked names are function locals", async () => {
    expect(
      await run(`
a, b = 'a😀'
try:
    a, b = {'x': 1}
except Exception:
    print(a, b)
def local():
    print(a)
    a, b = 1, 2
try:
    local()
except Exception:
    return a, b`),
    ).toMatchObject({ ok: true, logs: ["a 😀"], value: ["a", "😀"] })
  })

  test("f-string expressions share the normal parser, source positions, tools and scope", async () => {
    expect(await run(`return F"{{echo}}: {await tools.echo(id={'n': 12}['n'])} / {'😀z'[::-1]}"`)).toEqual({
      ok: true,
      value: "{echo}: 12 / z😀",
      toolCalls: [{ name: "echo" }],
    })
    expect(await run(`print('before')\nreturn f'x={missing}'`)).toMatchObject({
      ok: false,
      logs: ["before"],
      error: { location: { line: 2, column: 13 } },
    })
    expect(await run(String.raw`return f"\x7bawait tools.echo()\x7d"`)).toEqual({
      ok: true,
      value: "{await tools.echo()}",
      toolCalls: [],
    })
  })

  test("keyword values run in source order before an aliased async function starts", async () => {
    expect(
      await run(`
def see(x):
    print(x)
    return x
async def build(a, b, c):
    return await tools.echo(id=a + b + c)
f = build
job = f(*[see(1)], c=see(3), b=see(2))
print('ready')
return await job`),
    ).toEqual({ ok: true, value: 6, logs: ["1", "3", "2", "ready"], toolCalls: [{ name: "echo" }] })
  })

  test("sort snapshots input before calling keys and compares Unicode code points", async () => {
    expect(
      await run(`
words = ['aa', 'x', 'bb']
def by_size(word):
    words.append('new')
    print(word)
    return len(word)
s = sorted
return s(words, reverse=True, key=by_size), words, s('😀\uE000a', key=None), s({'b': 0, 'a': 1})`),
    ).toMatchObject({
      ok: true,
      value: [
        ["aa", "bb", "x"],
        ["aa", "x", "bb", "new", "new", "new"],
        ["a", "\uE000", "😀"],
        ["a", "b"],
      ],
      logs: ["aa", "x", "bb"],
    })
  })

  test.each([
    ["[1][::0]", "step"],
    ["'x'[1.5:]", "integer"],
    ["{}[:]", "sequences"],
    ["a, b = range(3)", "Too many"],
    ["for a, b in [[1]]:\n    pass", "Not enough"],
    ["sorted([1, '1'])", "number"],
    ["sorted([], k=True)", "keyword"],
    ["sorted([], reverse='yes')", "number"],
    ["sorted([], len)", "expects"],
    ["async def k(x):\n    return x\nsorted([1], key=k)", "awaitable"],
    ["def f(a, b):\n    pass\nf(b=2)", "Missing"],
    ["def f(a):\n    pass\nf(1, a=2)", "Multiple"],
    ["def f(a):\n    pass\nf(b=2)", "Unexpected"],
    ["len(value=[])", "keyword"],
    ["await tools.echo({'id': 1}, id=2)", "not both"],
  ])("reports runtime error: %s", async (code, message) => {
    expect(await run(code)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining(message) },
      toolCalls: [],
    })
  })

  test.each([
    "f'{1!r}'",
    "f'{1:03}'",
    "f'{n=}'",
    "f'{}'",
    "f'{x'",
    "f'x}'",
    "f'{f\"nested\"}'",
    "a, *tail, *extra = [1, 2]",
    "a, (b, *c, *d) = [1, [2, 3]]",
    "for *only in []:\n    pass",
    "*only = []",
    "sorted([], key=lambda x, x: x)",
    "call = lambda: await tools.echo(id=1)",
    "from asyncio import sleep",
    "import requests",
    "x[:] = []",
    "tools.echo(id=1, id=2)",
    "tools.echo(id=1, 2)",
    "tools.echo(**{})",
    "def f(x=1):\n    pass",
  ])("rejects unsupported syntax before a preceding host call: %s", async (bad) => {
    expect(await run(`await tools.echo(id=1)\n${bad}`)).toMatchObject({
      ok: false,
      error: { kind: expect.stringMatching(/^(ParseError|UnsupportedSyntax)$/) },
      toolCalls: [],
    })
  })
})

describe("Python keyword calls use the shared host boundary", () => {
  test("sync search, lazy tool keywords, schema validation, and one shared call budget", async () => {
    const runtime = CodeMode.make({ language: "python", tools: { echo }, limits: { maxToolCalls: 2 } })
    const result = await Effect.runPromise(
      runtime.execute(`
lookup = search
job = tools.echo(id=2)
print(lookup(query='echo')['items'][0]['path'])
print(await job)
return await tools.echo(id=3)`),
    )
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "ToolCallLimitExceeded" },
      logs: ["tools.echo", "2"],
      toolCalls: [{ name: "search" }, { name: "echo" }],
    })
    for (const code of ["await tools.echo(id='2')", "search(limit='bad')"])
      expect(await run(code)).toMatchObject({ ok: false, error: { kind: "InvalidToolInput" }, toolCalls: [] })
    expect(await run("await tools.echo(id=tools.echo(id=4))")).toMatchObject({
      ok: false,
      error: { kind: "InvalidDataValue" },
      toolCalls: [],
    })
  })

  test("hooks can deny keywords without invoking the tool; keyword and dict inputs reach hooks identically", async () => {
    const seen: unknown[] = []
    const executed: number[] = []
    const runtime = CodeMode.make({
      language: "python",
      tools: {
        echo: Tool.make({
          description: "Record execution",
          input: Schema.Struct({ id: Schema.Int }),
          execute: ({ id }) => Effect.sync(() => executed.push(id)),
        }),
      },
      hooks: {
        "tool.before": (call) => {
          seen.push(call.input)
          return seen.length === 3 ? Effect.fail(new Error("denied")) : Effect.void
        },
        "tool.after": (_, result) =>
          Effect.sync(() => {
            seen.push(result.status)
          }),
      },
    })
    expect(
      await Effect.runPromise(
        runtime.execute(`
tools.echo(id=99)
await tools.echo({'id': 2})
await tools.echo(id=2)`),
      ),
    ).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("denied") },
      toolCalls: [{ name: "echo" }, { name: "echo" }],
    })
    expect(seen).toEqual([{ id: 2 }, "success", { id: 2 }])
    expect(executed).toEqual([2])
  })

  test("host interruption inside a sorted key cannot be caught or run the next key", async () => {
    const calls: string[] = []
    const runtime = CodeMode.make({
      language: "python",
      tools: { echo },
      hooks: {
        "tool.before": (call) => {
          calls.push(call.name)
          return Effect.interrupt
        },
      },
    })
    const exit = await Effect.runPromiseExit(
      runtime.execute(`
def k(x):
    return search(query=x)['remaining']
try:
    sorted(['a', 'b'], key=k)
except Exception:
    await tools.echo(id=1)`),
    )
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    expect(calls).toEqual(["search"])
  })

  test("interpolation caps the combined string; long slices and sorts yield to timeout", async () => {
    expect(await run(`x = 'x' * 16777216\nreturn f'{x}!'`)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("string length") },
    })
    for (const code of ["return ('x' * 12000000)[::-2]", "return sorted('x' * 1000000)"]) {
      expect(
        await Effect.runPromise(CodeMode.execute({ language: "python", code, limits: { timeoutMs: 10 } })),
      ).toMatchObject({ ok: false, error: { kind: "TimeoutExceeded" }, toolCalls: [] })
    }
  })
})

describe("Python schedule authorization", () => {
  test("finds deferred tool calls in lambda bodies, even in unused functions", () => {
    expect(
      CodeMode.scanTools(`jobs = lambda: [tools.ns.lookup(id=i) for i, *rest in xs]\nreturn True`, "python"),
    ).toEqual(Result.succeed(["ns.lookup"]))
  })
  test("walks every new operand, including dead fields, slice bounds, key functions and keywords", () => {
    const code = `
async def k(x):
    return await tools.key()
if False:
    x, y = await tools.left(), f"{await tools.field()}"
    return (await tools.seq())[await tools.start():await tools.stop():await tools.step()]
for k, v in (await tools.mapping()).items():
    out = [(a,b) for a,b in await tools.pairs()]
    await tools.output(val=sorted(out, key=k, reverse=await tools.reverse()))`
    expect(CodeMode.scanTools(code, "python")).toEqual(
      Result.succeed(["key", "left", "field", "seq", "start", "stop", "step", "mapping", "pairs", "output", "reverse"]),
    )
  })
  test.each([
    "tools, x = xs",
    "a, (*tools, b) = xs",
    "for (a, [b, *tools]) in []:\n    pass",
    "[x for (*tools, x) in []]",
    "f = lambda tools: tools.ns.get()",
    "f = lambda: tools.ns[name]()",
    "import asyncio as tools",
    "from asyncio import gather as tools",
    "for k, tools in xs:\n    pass",
    "[v for (tools,v) in xs]",
    "x, y = 1, tools",
    "f'{tools.ns}'",
    "tools[f'{name}']()",
    "tools[:]()",
    "seq[tools:1]",
    "seq[:tools]",
    "seq[::tools]",
    "sorted(xs, key=tools.ns.f)",
    "await tools.echo(id=(x,tools))",
    "tools.echo(id=tools[k]())",
  ])("fails closed: %s", (code) => {
    expect(Result.isFailure(CodeMode.scanTools(code, "python"))).toBe(true)
  })
})
