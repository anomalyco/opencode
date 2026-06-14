import { describe, expect, test } from "bun:test"
import { formatInvalidPrNumber, parsePrNumber } from "@/cli/cmd/pr"

describe("cli.pr parsePrNumber", () => {
  test("accepts bare and hash-prefixed positive integers", () => {
    expect(parsePrNumber("992")).toBe(992)
    expect(parsePrNumber("#992")).toBe(992)
    expect(parsePrNumber("  #992  ")).toBe(992)
  })

  test("rejects malformed PR numbers", () => {
    expect(parsePrNumber("#")).toBeUndefined()
    expect(parsePrNumber("")).toBeUndefined()
    expect(parsePrNumber("abc")).toBeUndefined()
    expect(parsePrNumber("+3")).toBeUndefined()
    expect(parsePrNumber("# 992")).toBeUndefined()
    expect(parsePrNumber("0")).toBeUndefined()
    expect(parsePrNumber("-3")).toBeUndefined()
    expect(parsePrNumber("12.5")).toBeUndefined()
    expect(parsePrNumber("99x")).toBeUndefined()
    expect(parsePrNumber("##992")).toBeUndefined()
  })

  test("rejects integers above the safe numeric range", () => {
    expect(parsePrNumber(`${Number.MAX_SAFE_INTEGER + 1}`)).toBeUndefined()
  })

  test("quotes invalid input in validation errors", () => {
    expect(formatInvalidPrNumber("  # 992  ")).toBe(
      'Invalid PR number "  # 992  ". Pass a positive integer, optionally prefixed with "#".',
    )
  })
})
