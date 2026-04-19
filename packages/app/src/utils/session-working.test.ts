import { describe, expect, test } from "bun:test"
import { isSessionWorking } from "./session-working"

describe("isSessionWorking", () => {
  test("treats busy and retry as working", () => {
    expect(isSessionWorking({ type: "busy" })).toBe(true)
    expect(isSessionWorking({ type: "retry" })).toBe(true)
  })

  test("treats idle and missing status as not working", () => {
    expect(isSessionWorking({ type: "idle" })).toBe(false)
    expect(isSessionWorking(undefined)).toBe(false)
  })
})
