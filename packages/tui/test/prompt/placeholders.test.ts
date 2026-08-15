import { describe, expect, test } from "bun:test"
import { DEFAULT_PLACEHOLDERS } from "../../src/component/prompt/placeholders"

describe("prompt placeholders", () => {
  test("defaults to the hiring composer examples", () => {
    expect(DEFAULT_PLACEHOLDERS.normal).toEqual([
      "Score this resume against the req",
      "Draft outreach for the shortlist",
      "Open a req with /init",
    ])
    expect(DEFAULT_PLACEHOLDERS.shell).toEqual(["moks status", "ls candidates", "pwd"])
  })
})
