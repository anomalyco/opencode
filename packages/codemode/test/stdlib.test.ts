import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode, Tool } from "../src/index.js"

// Standard-library value types: Date, RegExp, Map, Set. Programs use them as ordinary JS;
// intra-CodeMode checkpoints (Object.* helpers, spread, coercion inputs) preserve the live
// values. JSON.stringify keeps Date -> ISO string (invalid -> null), URL -> href, and
// RegExp/Map/Set/URLSearchParams -> {}. The host boundary matches that except URLSearchParams,
// which cross as their query string, and Set, which crosses as an array.
const run = (code: string) => Effect.runPromise(CodeMode.execute({ code, tools: {} }))
const value = async (code: string) => {
  const result = await run(code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

describe("CodeMode values at intra-CodeMode checkpoints", () => {
  test("the host boundary still serializes JSON forms: results, JSON.stringify, and tool arguments", async () => {
    expect(await value(`return { d: new Date(0), m: new Map([["a", 1]]) }`)).toEqual({
      d: "1970-01-01T00:00:00.000Z",
      m: {},
    })
    expect(await value(`return JSON.stringify({ d: new Date(0) })`)).toBe('{"d":"1970-01-01T00:00:00.000Z"}')

    const observed: Array<unknown> = []
    const capture = Tool.make({
      description: "Capture the exact input the host receives",
      input: { type: "object" },
      execute: (input) =>
        Effect.sync(() => {
          observed.push(input)
          return "ok"
        }),
    })
    const result = await Effect.runPromise(
      CodeMode.execute({
        tools: { host: { capture } },
        code: `return await tools.host.capture({ when: new Date(0), tags: new Map([["a", 1]]) })`,
      }),
    )
    expect(result.ok).toBe(true)
    expect(observed).toStrictEqual([{ when: "1970-01-01T00:00:00.000Z", tags: {} }])
  })
})
