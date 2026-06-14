import { describe, expect, test } from "bun:test"
import { parsePrNumber } from "@/cli/cmd/pr"

describe("cli.pr parsePrNumber", () => {
  test("accepts a bare number", () => {
    expect(parsePrNumber("992")).toBe(992)
    expect(parsePrNumber(992)).toBe(992)
  })

  test("accepts a leading # (issue #32251)", () => {
    expect(parsePrNumber("#992")).toBe(992)
  })

  test("trims surrounding whitespace", () => {
    expect(parsePrNumber("  #992  ")).toBe(992)
  })

  test("rejects non-numeric, empty, zero, negative, decimal, and double-hash input", () => {
    expect(parsePrNumber("#")).toBeUndefined()
    expect(parsePrNumber("")).toBeUndefined()
    expect(parsePrNumber("abc")).toBeUndefined()
    expect(parsePrNumber("0")).toBeUndefined()
    expect(parsePrNumber("-3")).toBeUndefined()
    expect(parsePrNumber("12.5")).toBeUndefined()
    expect(parsePrNumber("99x")).toBeUndefined()
    expect(parsePrNumber("##992")).toBeUndefined()
  })
})
