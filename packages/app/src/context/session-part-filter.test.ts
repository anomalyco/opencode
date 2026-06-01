import { describe, expect, test } from "bun:test"
import { includeSessionPart } from "./session-part-filter"

describe("includeSessionPart", () => {
  test("keeps step-finish parts for session metadata", () => {
    expect(includeSessionPart({ type: "step-finish" })).toBe(true)
  })

  test("still hides structural parts that are not useful in the UI", () => {
    expect(includeSessionPart({ type: "step-start" })).toBe(false)
    expect(includeSessionPart({ type: "patch" })).toBe(false)
  })
})
