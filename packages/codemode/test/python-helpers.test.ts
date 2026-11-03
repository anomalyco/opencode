import { describe, expect, test } from "bun:test"
import { Effect, Result, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"

const history = Tool.make({
  description: "Ticket history",
  input: Schema.Struct({}),
  output: Schema.String,
  execute: () => Effect.succeed("created\r\npriority changed by Dana\nclosed"),
})
const execute = (code: string, limits?: CodeMode.ExecutionLimits) =>
  Effect.runPromise(CodeMode.execute({ language: "python", tools: { tracker: { history } }, code, limits }))

describe("Python data helpers", () => {
  test("inspect, filter and aggregate tool output without another model step", async () => {
    expect(
      await execute(`h = await tools.tracker.history()
names = [name for name in dir(tools.tracker) if 'histor' in name]
lines = h.splitlines() if isinstance(h, str) else h
return (type(h).__name__,names, ','.join(line.rsplit(' ',1)[-1].lower() for line in lines if 'priority' in line), len(repr(h)))`),
    ).toMatchObject({
      ok: true,
      value: ["str", ["history"], "dana", expect.any(Number)],
      toolCalls: [{ name: "tracker.history" }],
    })
  })
  test("awaiting an already completed search never repeats discovery or a hook", async () => {
    expect(
      await execute(`s = search(query='history')\na = await s\nreturn (await s) is a`, { maxToolCalls: 1 }),
    ).toEqual({ ok: true, value: true, toolCalls: [{ name: "search" }] })
    expect(await execute("await {}")).toMatchObject({ ok: false, error: { message: expect.stringContaining("await") } })
    expect(await execute('await search(query="history")', { maxToolCalls: 0 })).toMatchObject({
      ok: false,
      error: { kind: "ToolCallLimitExceeded" },
      toolCalls: [],
    })
  })
  test("single pass even across lazy tool calls, no work before consuming", async () => {
    expect(
      await execute("calls = map(lambda x: tools.tracker.history(), range(4))\nreturn len(await next(calls))"),
    ).toMatchObject({ ok: true, toolCalls: [{ name: "tracker.history" }] })
    expect(await execute("return iter([1])")).toMatchObject({ ok: false, error: { kind: "InvalidDataValue" } })
  })
  test.each([
    "type(1).__class__",
    "type(1).__subclasses__()",
    "getattr(str, '__mro__')",
    "getattr([], 'constructor')",
    'json.loads("{}").constructor',
    're.compile("x").__dict__',
    "import sys",
    'open("x")',
  ])("no host reflection/files/packages: %s", async (code) => {
    expect(await execute(code)).toMatchObject({ ok: false })
  })
  test("rejects non-data JSON and excessive JSON/regex/iteration work", async () => {
    for (const code of [
      "json.dumps(tools.tracker.history())",
      'json.loads("[" * 40 + "]" * 40)',
      "json.dumps([1],indent=99999999)",
      `re.search(r'(a)\\1','aa')`,
      `re.search('x'*513,'x')`,
    ])
      expect(await execute(code)).toMatchObject({ ok: false, toolCalls: [] })
    expect(await execute(`sum(x for x in range(1000000))`, { timeoutMs: 10 })).toMatchObject({
      ok: false,
      error: { kind: "TimeoutExceeded" },
    })
  })
  test("scanner covers both conditional branches, dict/set/generator fields and inline suites", () => {
    expect(
      CodeMode.scanTools(
        `a = tools.a() if True else tools.b()\nif False: c = {k: tools.c() for k in []}\ns = (tools.d() for x in [])\nxs = {tools.e() for x in []}`,
        "python",
      ),
    ).toEqual(Result.succeed(["a", "b", "c", "d", "e"]))
    for (const code of [
      "if True: x = dir(tools.tracker)",
      "from re import search as tools",
      "x = {tools[name]() for x in []}",
      "(tools[name]() for x in [])",
    ])
      expect(Result.isFailure(CodeMode.scanTools(code, "python"))).toBe(true)
  })
})
