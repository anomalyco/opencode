import { test, expect, describe } from "bun:test"
import { pick, parseIssueNumber, TEAM } from "../lib/github-triage.lib"

describe("parseIssueNumber", () => {
  test("parses a valid positive integer", () => {
    expect(parseIssueNumber("123")).toBe(123)
  })
  test("trims surrounding whitespace", () => {
    expect(parseIssueNumber("  45 ")).toBe(45)
  })
  test("parses a leading number", () => {
    expect(parseIssueNumber("12abc")).toBe(12)
  })
  test("throws on undefined, empty, zero, negative, and non-numeric", () => {
    expect(() => parseIssueNumber(undefined)).toThrow()
    expect(() => parseIssueNumber("")).toThrow()
    expect(() => parseIssueNumber("0")).toThrow()
    expect(() => parseIssueNumber("-5")).toThrow()
    expect(() => parseIssueNumber("abc")).toThrow()
  })
})

describe("pick", () => {
  test("throws on an empty list instead of returning undefined", () => {
    expect(() => pick([])).toThrow()
  })
  test("returns the only element of a single-item list", () => {
    expect(pick(["only"])).toBe("only")
  })
  test("returns a member of the provided list", () => {
    const member = pick(TEAM.tui)
    expect(TEAM.tui.includes(member)).toBe(true)
  })
})
