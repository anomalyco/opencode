import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

// One failure is one program error object, and rethrowing it keeps the diagnostic it started with.
const run = (code: string) => Effect.runPromise(CodeMode.execute({ code, tools: {} }))
const value = async (code: string) => {
  const result = await run(code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}
const error = async (code: string) => {
  const result = await run(code)
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error
}

describe("source syntax", () => {
  test("rejects TypeScript-only syntax", async () => {
    expect((await error(`const value: number = 1; return value`)).kind).toBe("ParseError")
  })
})

describe("error identity", () => {
  test("Error.isError is true for every Error value and nothing else", async () => {
    expect(
      await value(`
        const caught = (() => { try { null.foo } catch (error) { return error } })()
        return [Error.isError(new Error("x")), Error.isError(new RangeError("x")), Error.isError(caught),
          Error.isError({ name: "Error", message: "x" }), Error.isError("Error"), Error.isError(null)]
      `),
    ).toEqual([true, true, true, false, false, false])
  })

  test("awaiting the same rejected promise twice yields the same error object", async () => {
    expect(
      await value(`
        const fail = async () => { null.foo }
        const p = fail()
        const a = await p.catch((e) => e)
        try { await p } catch (b) { return a === b }
      `),
    ).toBe(true)
  })

  test("allSettled reasons for the same failure are identical", async () => {
    expect(
      await value(`
        const fail = async () => { null.foo }
        const p = fail()
        const [a, b] = await Promise.allSettled([p, p])
        return [a.reason === b.reason, a.reason.name, a.reason.message]
      `),
    ).toEqual([true, "TypeError", "Cannot read properties of null (reading 'foo')."])
  })

  test("Promise.any collects the same object a direct catch would", async () => {
    expect(
      await value(`
        const fail = async () => { null.foo }
        const p = fail()
        const direct = await p.catch((e) => e)
        try { await Promise.any([p]) } catch (aggregate) { return aggregate.errors[0] === direct }
      `),
    ).toBe(true)
  })
})

describe("rethrown interpreter failures", () => {
  test("keep their diagnostic kind and source location", async () => {
    const failure = await error(`try { Symbol + 1 } catch (e) { throw e }`)
    expect(failure.kind).toBe("InvalidDataValue")
    expect(failure.message).toStartWith("TypeError: Binary operators require data values. (line ")
    expect(failure.location).toBeDefined()
  })

  test("keep their location through a rejection handler", async () => {
    const direct = await error(`
      const fail = async () => { null.foo }
      await fail()
    `)
    const rethrown = await error(`
      const fail = async () => { null.foo }
      await fail().catch((e) => { throw e })
    `)
    expect(direct.location).toBeDefined()
    expect(rethrown).toEqual(direct)
  })
})

describe("uncaught program throws", () => {
  test("an Error reports as name: message", async () => {
    const failure = await error(`throw new TypeError("bad input")`)
    expect(failure).toEqual({ kind: "ExecutionFailure", message: "TypeError: bad input" })
  })

  test("a custom name is honored", async () => {
    const failure = await error(`const e = new Error("x"); e.name = "ValidationError"; throw e`)
    expect(failure.message).toBe("ValidationError: x")
  })

  test("non-Error values keep the Uncaught prefix", async () => {
    expect((await error(`throw "boom"`)).message).toBe("Uncaught: boom")
    expect((await error(`throw { code: 7 }`)).message).toBe('Uncaught: {"code":7}')
  })
})

describe("source locations", () => {
  test("uses the submitted line and 1-based column", async () => {
    const failure = await error("const value = 1\nreturn value()")
    expect(failure.location).toEqual({ line: 2, column: 8 })
    expect(failure.message).toBe("TypeError: value is not a function. (line 2, col 8)")
  })

  test("names a missing method on a call instead of the previous line", async () => {
    const failure = await error(`// Try search with different namespaces
for (const ns of ["github", "tools.github", "tools", ""]) {
  const s = await search({query: "star", namespace: ns, limit: 100}).catch(e=>({items:[],error:String(e)}));
  return s
}`)
    expect(failure.location).toEqual({ line: 3, column: 19 })
    expect(failure.message).toBe("TypeError: search(...).catch is not a function. (line 3, col 19)")
  })
})

describe("host errors escaping built-ins", () => {
  test("become the same-named program error", async () => {
    expect(
      await value(`
        try { (1).toFixed(200) } catch (e) { return [e.name, e instanceof RangeError, e.message] }
      `),
    ).toEqual(["RangeError", true, "toFixed() argument must be between 0 and 100"])
  })

  test("report the location of the call that raised them", async () => {
    const failure = await error(`return [1].map((n) => n.toFixed(200))`)
    expect(failure.kind).toBe("ExecutionFailure")
    expect(failure.message).toBe("RangeError: toFixed() argument must be between 0 and 100 (line 1, col 23)")
  })

  test("a built-in that rejects its arguments before doing any work is located at the call", async () => {
    expect((await error(`new Promise(Symbol)`)).message).toEndWith("(line 1, col 1)")
  })

  test("a rejection born inside a promise the built-in created is located at the creating call", async () => {
    expect((await error(`return await Promise.all(1)`)).message).toEndWith("(line 1, col 14)")
    expect((await error(`return await Promise.race([])`)).message).toEndWith("(line 1, col 14)")
    expect((await error(`return await Promise.all({ [Symbol.iterator]: () => ({ next: 1 }) })`)).message).toEndWith(
      "(line 1, col 14)",
    )
    expect((await error(`let p; p = Promise.resolve().then(() => p); return await p`)).message).toEndWith(
      "(line 1, col 12)",
    )
  })

  test("an un-awaited rejection born inside promise machinery keeps its location in the warning", async () => {
    const result = await run(`Promise.all(1); return 1`)
    expect(result.ok && result.warnings?.[0]?.message).toEndWith(
      "TypeError: Promise.all expects a synchronous iterable, received a number. (line 1, col 1)",
    )
  })

  test("a failure inside a built-in called by another built-in is located at the outer call", async () => {
    const failure = await error(`return Array.from({ [Symbol.iterator]: () => ({ next: 1 }) })`)
    expect(failure.message).toBe("TypeError: Iterator next must be a function. (line 1, col 8)")
  })
})

describe("call depth", () => {
  test("runaway recursion fails fast with a catchable RangeError", async () => {
    const started = Date.now()
    expect(
      await value(`
        const f = (n) => f(n + 1)
        try { f(0) } catch (e) { return [e.name, e instanceof RangeError, e.message] }
      `),
    ).toEqual(["RangeError", true, "Maximum call stack size exceeded"])
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test("recursion routed through nested built-ins keeps counting depth", async () => {
    const started = Date.now()
    expect(
      await value(`
        const a = [1]
        a.join = () => a + ""
        const o = { toString() { return [o].map(String)[0] } }
        const e = new Error()
        e.message = { toString() { return String(e) } }
        const names = []
        for (const run of [() => String(a), () => String(o), () => String(e)]) {
          try { run() } catch (error) { names.push(error.name) }
        }
        return names
      `),
    ).toEqual(["RangeError", "RangeError", "RangeError"])
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test("uncaught overflow reports the call that overflowed", async () => {
    const failure = await error(`const f = (n) => f(n + 1); return f(0)`)
    expect(failure.kind).toBe("ExecutionFailure")
    expect(failure.message).toBe("RangeError: Maximum call stack size exceeded (line 1, col 18)")
  })

  test("the limit is 10000 nested calls", async () => {
    expect(await value(`let depth = 0; const f = () => { depth++; f() }; try { f() } catch { return depth }`)).toBe(
      10000,
    )
    expect(await value(`const f = (n) => (n === 0 ? 0 : 1 + f(n - 1)); return f(9000)`)).toBe(9000)
  })

  test("recursion through a built-in callback counts", async () => {
    const failure = await error(`const f = (n) => [n].map((x) => f(x + 1)); return f(0)`)
    expect(failure.message).toStartWith("RangeError: Maximum call stack size exceeded")
  })

  test("an await resets the depth, so long async chains are fine", async () => {
    expect(
      await value(`
        const page = async (n) => { await null; return n === 0 ? "done" : page(n - 1) }
        return await page(3000)
      `),
    ).toBe("done")
  })

  test("an async function that recurses before its first await overflows like JS", async () => {
    const failure = await error(`const f = async (n) => f(n + 1); return await f(0)`)
    expect(failure.message).toStartWith("RangeError: Maximum call stack size exceeded")
  })
})
