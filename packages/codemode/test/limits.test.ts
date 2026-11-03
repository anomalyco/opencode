import { describe, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { CodeMode } from "../src/index.js"
import { MAX_ARRAY_LENGTH, MAX_PENDING_PROMISES, MAX_STRING_LENGTH } from "../src/interpreter/limits.js"

const runtime = CodeMode.make({ tools: {} })

const value = async (code: string) => {
  const result = await Effect.runPromise(runtime.execute(code))
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

const failure = async (code: string) => {
  const result = await Effect.runPromise(runtime.execute(code))
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error.message
}

const S = MAX_STRING_LENGTH
const A = MAX_ARRAY_LENGTH

describe("one built-in cannot build an unbounded value", () => {
  test("strings: repeat, pad, concat, join, +, template, JSON.stringify", async () => {
    expect(await value(`return "x".repeat(${S}).length`)).toBe(S)
    for (const code of [
      `"x".repeat(${S + 1})`,
      `"x".padStart(${S + 1})`,
      `"x".padEnd(${S + 1}, "y")`,
      `"x".repeat(${S}).concat("y")`,
      `["x".repeat(${S}), "y"].join("")`,
      `"x".repeat(${S}) + "y"`,
      `\`\${"x".repeat(${S})}y\``,
      `JSON.stringify("x".repeat(${S}))`,
    ]) {
      expect(await failure(`try { ${code} } catch (e) { throw Error(e.name + ": " + e.message) }`)).toContain(
        "RangeError: Invalid string length",
      )
    }
  })

  // split and matchAll share the same result check but must build ten million items first to reach it,
  // which is too slow for CI.
  test("arrays: constructor, length, Array.from, concat, flat", async () => {
    expect(await value(`return Array(${A}).length`)).toBe(A)
    for (const code of [
      `Array(${A + 1})`,
      `const a = []; a.length = ${A + 1}`,
      `Array.from({ length: ${A + 1} })`,
      `Array(${A}).concat([1])`,
      `[Array(${A}).fill(0), [1]].flat()`,
    ]) {
      expect(await failure(`try { ${code} } catch (e) { throw Error(e.name + ": " + e.message) }`)).toContain(
        "RangeError: Invalid array length",
      )
    }
  })

  test("promises: too many pending at once, while settled ones do not count", async () => {
    const n = MAX_PENDING_PROMISES
    expect(await value(`for (let i = 0; i < ${n * 2}; i++) Promise.resolve(i); return 1`)).toBe(1)
    expect(
      await failure(
        `try { for (let i = 0; i <= ${n}; i++) new Promise(() => {}) } catch (e) { throw Error(e.name + ": " + e.message) }`,
      ),
    ).toContain("RangeError: Too many pending promises")
    expect(await failure(`await Promise.all(Array(${n + 1}).fill(0).map(() => new Promise(() => {})))`)).toContain(
      "Too many pending promises",
    )
  }, 10_000)
})

describe("the host stays in control", () => {
  test("other host work keeps running while one long job runs", async () => {
    let ticks = 0
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const counter = yield* Effect.forkChild(
          Effect.forever(
            Effect.andThen(
              Effect.yieldNow,
              Effect.sync(() => {
                ticks += 1
              }),
            ),
          ),
        )
        const result = yield* runtime.execute(`let t = 0; for (let i = 0; i < 1_000_000; i++) t += i % 3; return t`)
        yield* Fiber.interrupt(counter)
        return result
      }),
    )
    expect(result).toMatchObject({ ok: true, value: 999_999 })
    // The loop takes well over 10 ms anywhere, and the runner yields to the host every millisecond; a job that kept
    // the thread for its whole run would let the counter tick at most a couple of times around it.
    expect(ticks).toBeGreaterThan(10)
  })

  // Each case would run for seconds or forever; the timeout must still stop it promptly.
  test.each([
    ["a loop of only built-in calls", `return Iterator.from({ next: Object }).drop(Infinity).next()`],
    [
      "serializing shared references",
      `let a = [0]; for (let i = 0; i < 24; i++) a = [a, a]; return JSON.stringify(a).length`,
    ],
    ["copying out shared references", `let a = [0]; for (let i = 0; i < 24; i++) a = [a, a]; return a`],
    [
      "reporting many unhandled rejections",
      `const a = Array(10_000).fill(0); for (let i = 0; i < 20_000; i++) Promise.reject(a); return 1`,
    ],
  ])("%s still times out", async (_, code) => {
    const result = await Effect.runPromise(CodeMode.make({ limits: { timeoutMs: 100 } }).execute(code))
    expect(result).toMatchObject({ ok: false, error: { kind: "TimeoutExceeded" } })
  })

  test("nesting deeper than the host stack fails cleanly, and the next run is unaffected", async () => {
    expect(await failure(`const f = () => f; f${"()".repeat(100_000)}; return 1`)).toBe(
      "Execution exceeded the maximum nesting depth.",
    )
    expect(await value(`const f = () => f; f${"()".repeat(500)}; return 1`)).toBe(1)
  })
})
