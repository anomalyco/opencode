import { describe, expect, test } from "bun:test"
import { SessionStatus } from "../../src/session/status"

describe("parseIdleVerdict", () => {
  test("reads the one-word answer", () => {
    expect(SessionStatus.parseIdleVerdict("WAITING")).toBe("waiting")
    expect(SessionStatus.parseIdleVerdict("DONE")).toBe("done")
    expect(SessionStatus.parseIdleVerdict("waiting")).toBe("waiting")
    expect(SessionStatus.parseIdleVerdict(" done \n")).toBe("done")
  })

  test("strips reasoning blocks before reading", () => {
    expect(SessionStatus.parseIdleVerdict("<think>the user was asked nothing</think>WAITING")).toBe("waiting")
    expect(SessionStatus.parseIdleVerdict("<think>multi\nline\nreasoning</think>\nDONE")).toBe("done")
  })

  test("degrades unexpected output to undefined", () => {
    expect(SessionStatus.parseIdleVerdict("")).toBeUndefined()
    expect(SessionStatus.parseIdleVerdict("I cannot classify this")).toBeUndefined()
    expect(SessionStatus.parseIdleVerdict("<think>thinking forever")).toBeUndefined()
  })
})
