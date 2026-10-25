import { describe, expect, test } from "bun:test"
import { context } from "../../../src/cli/cmd/run/emit"

describe("context", () => {
  test("joins findings under a session header", () => {
    expect(context("ses_1", ["first finding", "second finding"])).toBe(
      "[bolt run context session=ses_1]\n\nfirst finding\n\nsecond finding",
    )
  })

  test("emits only the header when the run produced no text", () => {
    expect(context("ses_1", [])).toBe("[bolt run context session=ses_1]")
  })

  test("trims stray whitespace from findings", () => {
    expect(context("ses_1", ["  finding  "])).toBe("[bolt run context session=ses_1]\n\nfinding")
  })
})
