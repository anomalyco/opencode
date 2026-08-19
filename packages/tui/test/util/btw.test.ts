import { describe, expect, test } from "bun:test"
import { parseBtwCommand } from "../../src/util/btw"

describe("/btw command", () => {
  test("parses an inline side question", () => {
    expect(parseBtwCommand("/btw what changed in the parser?")).toBe("what changed in the parser?")
  })

  test("preserves multiline questions and trims their edges", () => {
    expect(parseBtwCommand("/btw   first line\nsecond line  ")).toBe("first line\nsecond line")
  })

  test("opens the recent overlay when no question is supplied", () => {
    expect(parseBtwCommand("/btw")).toBe("")
  })

  test("does not intercept similarly named commands", () => {
    expect(parseBtwCommand("/btwice hello")).toBeUndefined()
  })
})
