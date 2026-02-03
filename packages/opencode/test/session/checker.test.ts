import { test, expect } from "bun:test"
import { SessionChecker } from "../../src/session/checker"

test("getCheckState returns undefined for unknown session", () => {
  const state = SessionChecker.getCheckState("unknown-session")
  expect(state).toBeUndefined()
})

test("resetState clears state for session", () => {
  const sessionID = "test-session"
  SessionChecker.resetState(sessionID)
  const state = SessionChecker.getCheckState(sessionID)
  expect(state).toBeUndefined()
})
