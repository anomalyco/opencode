import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"

// `search(...)` blocks: when its input has to be awaited first, the run parks until it crossed, and the program goes
// on as if search had answered synchronously. Inside a running sync generator that park takes the generator and the
// frames that drive it, up to the nearest async function or the program.

const echo = Tool.make({
  description: "Echoes an id",
  input: Schema.Struct({ id: Schema.Number }),
  output: Schema.Number,
  execute: ({ id }) => Effect.succeed(id),
})

/** Runs `body` with `S()` searching through an awaited input, and again with a plain one, which never parks. */
const both = async (body: string) => {
  const runtime = CodeMode.make({ tools: { echo } })
  const run = (query: string) =>
    Effect.runPromise(runtime.execute(`const S = () => search({ query: ${query} }).items.length\n${body}`))
  const [parked, plain] = await Promise.all([run(`Promise.resolve("echo")`), run(`"echo"`)])
  expect(parked).toEqual(plain)
  return parked
}

describe("search inside a running sync generator", () => {
  test("a direct next() gets the generator's step, and the generator goes on", async () => {
    const outcome = await both(`
      function* g() { const a = S(); yield a; yield a + 1 }
      const it = g()
      return [it.next(), it.next(), it.next()]`)
    expect(outcome).toMatchObject({
      ok: true,
      value: [
        { value: 1, done: false },
        { value: 2, done: false },
        { done: true },
      ],
    })
  })

  test("for...of", async () => {
    const outcome = await both(`
      function* g() { yield S(); yield S() + 1; return 9 }
      const out = []
      for (const x of g()) out.push(x)
      return out`)
    expect(outcome).toMatchObject({ ok: true, value: [1, 2] })
  })

  test("spread", async () => {
    const outcome = await both(`function* g() { yield S(); yield 5; yield S() } return [...g()]`)
    expect(outcome).toMatchObject({ ok: true, value: [1, 5, 1] })
  })

  test("nested generators and a sync function between them", async () => {
    const outcome = await both(`
      function* inner() { yield S(); yield S() * 10 }
      const first = () => inner().next().value
      function* outer() { yield* inner(); yield first() + 100; for (const x of inner()) yield x + 1000 }
      return [...outer()]`)
    expect(outcome).toMatchObject({ ok: true, value: [1, 10, 101, 1001, 1010] })
  })

  test("inside an async function", async () => {
    const outcome = await both(`
      function* g() { yield S(); yield S() + 1 }
      async function f() { const it = g(); const a = it.next().value; await null; return [a, it.next().value, [...g()]] }
      return await f()`)
    expect(outcome).toMatchObject({ ok: true, value: [1, 2, [1, 2]] })
  })

  test("at top level, queued jobs wait for the search, as they do around a search outside a generator", async () => {
    const runtime = CodeMode.make({ tools: { echo } })
    const outcome = await Effect.runPromise(
      runtime.execute(`
        const log = []
        Promise.resolve().then(() => log.push("job"))
        function* g() { log.push("before"); yield search({ query: Promise.resolve("echo") }).items.length; log.push("after") }
        const it = g()
        log.push(it.next().value)
        it.next()
        log.push("sync")
        return log`),
    )
    expect(outcome).toMatchObject({ ok: true, value: ["before", 1, "after", "sync"] })
  })

  test("a throw from the search's input reaches the generator, then its caller", async () => {
    const runtime = CodeMode.make({ tools: { echo } })
    const outcome = await Effect.runPromise(
      runtime.execute(`
        function* g() { try { yield search({ query: Promise.reject(new Error("no")) }) } finally { yield "cleanup" } }
        const it = g()
        const out = []
        try { out.push(it.next().value); out.push(it.next().value) } catch (e) { out.push(e.message) }
        out.push(it.next().done)
        return out`),
    )
    expect(outcome).toMatchObject({ ok: true, value: ["cleanup", "no", true] })
  })

  test("a run suspended while a generator is parked resumes where it was", async () => {
    let resumed = false
    let started!: () => void
    const waiting = new Promise<void>((done) => (started = done))
    const wait = Tool.make({
      description: "Answers once the run resumed",
      input: Schema.Struct({}),
      output: Schema.Number,
      execute: Tool.idempotent(() => (resumed ? Effect.succeed(1) : Effect.callback<number>(() => started()))),
    })
    const runtime = CodeMode.make({ tools: { echo, wait } })
    const program = runtime.program(`
      function* g() { yield search({ query: tools.wait({}).then(() => "echo") }).items.length; yield 7 }
      const caller = (it) => [it.next().value, it.next().value, it.next().done]
      return caller(g())`)
    const fiber = Effect.runFork(program.run())
    await waiting
    const suspended = await Effect.runPromise(program.suspend())
    await Effect.runPromise(Fiber.join(fiber))
    if (suspended.ok !== "suspended") throw new Error("expected a suspended run")
    resumed = true
    const outcome = await Effect.runPromise(runtime.resume(CodeMode.toBytes(suspended.state)).run())
    expect(outcome).toMatchObject({ ok: true, value: [1, 7, true] })
  })
})
