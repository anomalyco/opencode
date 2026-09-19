import { describe, expect, test } from "bun:test"
import { DoomLoop } from "../../src/session/doom-loop"

type Call = { tool: string; input: Record<string, unknown> }

function pattern(period: number): Call[] {
  return Array.from({ length: period }, (_, index) => ({ tool: "lookup", input: { query: index } }))
}

function repeat(calls: readonly Call[], count: number) {
  return Array.from({ length: count }, () => calls).flat()
}

function results(calls: readonly Call[]) {
  const detector = DoomLoop.create()
  return calls.map((call) => detector.check(call.tool, call.input))
}

function oracle(calls: readonly Call[]) {
  const signatures = calls.map((call) => JSON.stringify([call.tool, call.input]))
  for (let period = 1; period <= DoomLoop.MAX_PERIOD; period++) {
    if (signatures.length < 3 * period) continue
    const blocks = [3, 2, 1].map((offset) =>
      signatures.slice(signatures.length - offset * period, signatures.length - (offset - 1) * period),
    )
    if (
      JSON.stringify(blocks[0]) === JSON.stringify(blocks[1]) &&
      JSON.stringify(blocks[1]) === JSON.stringify(blocks[2])
    ) {
      return true
    }
  }
  return false
}

describe("doom-loop detector", () => {
  test.each(Array.from({ length: DoomLoop.MAX_PERIOD }, (_, index) => index + 1))(
    "detects period %i only when the third block completes",
    (period) => {
      const detected = results(repeat(pattern(period), 3))
      expect(detected.slice(0, -1).every((value) => !value)).toBe(true)
      expect(detected.at(-1)).toBe(true)
    },
  )

  test("does not detect only two repetitions", () => {
    expect(results(repeat(pattern(DoomLoop.MAX_PERIOD), 2)).every((value) => !value)).toBe(true)
  })

  test("does not detect a fundamental period above the bound", () => {
    expect(results(repeat(pattern(DoomLoop.MAX_PERIOD + 1), 4)).every((value) => !value)).toBe(true)
  })

  test("does not detect when the third block changes an input", () => {
    const calls = repeat(pattern(3), 3)
    calls[8] = { tool: "lookup", input: { query: "changed" } }
    expect(results(calls).every((value) => !value)).toBe(true)
  })

  test("does not detect when the third block changes a tool name", () => {
    const calls = repeat(pattern(3), 3)
    calls[8] = { ...calls[8], tool: "search" }
    expect(results(calls).every((value) => !value)).toBe(true)
  })

  test("keeps detecting a continuing cycle", () => {
    const detected = results(repeat(pattern(3), 5))
    expect(detected.slice(0, 8).every((value) => !value)).toBe(true)
    expect(detected.slice(8).every(Boolean)).toBe(true)
  })

  test("detects the smaller fundamental period", () => {
    expect(results(repeat(repeat(pattern(2), 2), 3)).findIndex(Boolean)).toBe(5)
  })

  test("preserves JSON.stringify key-order semantics", () => {
    expect(
      results([
        { tool: "lookup", input: { a: 1, b: 2 } },
        { tool: "lookup", input: { b: 2, a: 1 } },
        { tool: "lookup", input: { a: 1, b: 2 } },
      ]),
    ).toEqual([false, false, false])
  })

  test("does not retain mutable input objects", () => {
    const detector = DoomLoop.create()
    const input = { query: "a" }
    expect(detector.check("lookup", input)).toBe(false)
    input.query = "b"
    expect(detector.check("lookup", input)).toBe(false)
    expect(detector.check("lookup", input)).toBe(false)
    expect(detector.check("lookup", input)).toBe(true)
  })

  test("keeps separate detector instances isolated", () => {
    const first = DoomLoop.create()
    const second = DoomLoop.create()
    expect(first.check("lookup", {})).toBe(false)
    expect(first.check("lookup", {})).toBe(false)
    expect(second.check("lookup", {})).toBe(false)
    expect(first.check("lookup", {})).toBe(true)
  })

  test("detects a maximum-period suffix after many ring wraps", () => {
    const noise = Array.from({ length: 10_000 }, (_, index) => ({ tool: "noise", input: { index } }))
    const detected = results([...noise, ...repeat(pattern(DoomLoop.MAX_PERIOD), 3)])
    expect(detected.slice(0, -1).every((value) => !value)).toBe(true)
    expect(detected.at(-1)).toBe(true)
  })

  test("matches an independent suffix-block oracle for every short binary sequence", () => {
    const alphabet = pattern(2)
    for (let length = 1; length <= 10; length++) {
      for (let mask = 0; mask < 1 << length; mask++) {
        const detector = DoomLoop.create()
        const calls: Call[] = []
        for (let index = 0; index < length; index++) {
          const call = alphabet[(mask >> index) & 1]
          calls.push(call)
          expect(detector.check(call.tool, call.input)).toBe(oracle(calls))
        }
      }
    }
  })

  test("matches the oracle across ring wraps, near misses, and changing periods", () => {
    const calls = Array.from({ length: DoomLoop.MAX_PERIOD + 1 }, (_, index) => [
      ...repeat(pattern(index + 1), 4),
      { tool: "noise", input: { index } },
      ...repeat(pattern(index + 1), 2),
      { tool: "changed", input: { index } },
    ]).flat()
    const detector = DoomLoop.create()
    calls.forEach((call, index) => {
      expect(detector.check(call.tool, call.input)).toBe(oracle(calls.slice(0, index + 1)))
    })
  })
})
