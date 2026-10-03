import { describe, expect, test } from "bun:test"
import { formatToolElapsed } from "./tool-elapsed"

const format = (total: number) => (total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`)

describe("formatToolElapsed", () => {
  test("freezes on the completed span", () => {
    expect(formatToolElapsed(1000, 4200, 9999, format)).toBe("3s")
  })

  test("ticks live while running", () => {
    expect(formatToolElapsed(1000, undefined, 2500, format)).toBe("2s")
    expect(formatToolElapsed(1000, undefined, 61000, format)).toBe("1m 0s")
  })

  test("empty when the start is unknown (e.g. pending parts carry no timestamps)", () => {
    expect(formatToolElapsed(undefined, undefined, 5000, format)).toBe("")
  })

  test("empty on clock skew or zero-length completed spans", () => {
    expect(formatToolElapsed(5000, 4000, 6000, format)).toBe("")
    expect(formatToolElapsed(5000, 5000, 6000, format)).toBe("")
    expect(formatToolElapsed(5000, undefined, 4000, format)).toBe("")
  })

  test("empty for non-finite inputs", () => {
    expect(formatToolElapsed(NaN, undefined, 5000, format)).toBe("")
    expect(formatToolElapsed(1000, undefined, NaN, format)).toBe("")
  })

  test("rounds to whole seconds like the message duration", () => {
    expect(formatToolElapsed(1000, 1499, 2000, format)).toBe("0s")
    expect(formatToolElapsed(1000, 1500, 2000, format)).toBe("1s")
  })
})
