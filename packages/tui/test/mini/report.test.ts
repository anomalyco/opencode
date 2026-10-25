import { describe, expect, test } from "bun:test"
import { add, clock, empty, json, ratio, render } from "../../../src/cli/cmd/run/report"

function step(
  over?: Partial<{ cost: number; input: number; output: number; reasoning: number; read: number; write: number }>,
) {
  const usage = { cost: 0.01, input: 100, output: 50, reasoning: 10, read: 200, write: 20, ...over }
  return {
    cost: usage.cost,
    tokens: {
      input: usage.input,
      output: usage.output,
      reasoning: usage.reasoning,
      cache: { read: usage.read, write: usage.write },
    },
  }
}

describe("add", () => {
  test("accumulates usage across steps", () => {
    const state = add(add(empty, step()), step({ cost: 0.02, output: 150 }))
    expect(state.cost).toBeCloseTo(0.03)
    expect(state.steps).toBe(2)
    expect(state.input).toBe(200)
    expect(state.output).toBe(200)
    expect(state.reasoning).toBe(20)
    expect(state.read).toBe(400)
    expect(state.write).toBe(40)
  })
})

describe("ratio", () => {
  test("is the cached share of prompt tokens", () => {
    expect(ratio({ ...empty, input: 100, read: 300 })).toBeCloseTo(0.75)
  })

  test("is undefined without prompt tokens", () => {
    expect(ratio(empty)).toBeUndefined()
  })
})

describe("clock", () => {
  test("formats milliseconds, seconds, and minutes", () => {
    expect(clock(900)).toBe("900ms")
    expect(clock(12_340)).toBe("12.3s")
    expect(clock(75_000)).toBe("1m15s")
  })
})

describe("render", () => {
  test("reports dollars, wall time, steps, tokens, and cache hits", () => {
    const state = add(empty, step())
    const out = render(state, 12_300)
    expect(out).toContain("cost report: $0.0100 · 12.3s wall · 1 step")
    expect(out).toContain("tokens: 380 total (input 100, output 50, reasoning 10)")
    expect(out).toContain("cache: 200 read, 20 written (67% of prompt tokens from cache)")
  })

  test("notes when nothing was cached", () => {
    const state = add(empty, step({ read: 0, write: 0 }))
    expect(render(state, 100)).toContain("cache: no cached tokens")
  })
})

describe("json", () => {
  test("carries the structured envelope payload", () => {
    const state = add(empty, step())
    const out = json(state, 5000)
    expect(out.cost).toBeCloseTo(0.01)
    expect(out.wall).toBe(5000)
    expect(out.steps).toBe(1)
    expect(out.tokens.total).toBe(380)
    expect(out.tokens.cache).toEqual({ read: 200, write: 20 })
    expect(out.cacheRatio).toBeCloseTo(200 / 300)
  })
})
