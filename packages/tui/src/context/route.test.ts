import { describe, expect, test } from "bun:test"
import { nextActiveSession } from "./route"

describe("nextActiveSession", () => {
  test("navigating from home to a session triggers with the session id", () => {
    expect(nextActiveSession({ type: "home" }, { type: "session", sessionID: "ses_a" })).toBe("ses_a")
  })

  test("navigating between different sessions triggers with the new id", () => {
    expect(nextActiveSession({ type: "session", sessionID: "ses_a" }, { type: "session", sessionID: "ses_b" })).toBe(
      "ses_b",
    )
  })

  test("navigating to the same session does not retrigger", () => {
    expect(nextActiveSession({ type: "session", sessionID: "ses_a" }, { type: "session", sessionID: "ses_a" })).toBeUndefined()
  })

  test("leaving a session for home does not trigger", () => {
    expect(nextActiveSession({ type: "session", sessionID: "ses_a" }, { type: "home" })).toBeUndefined()
  })

  test("starting directly on a session triggers once", () => {
    expect(nextActiveSession(undefined, { type: "session", sessionID: "ses_a" })).toBe("ses_a")
  })

  test("plugin routes never trigger", () => {
    expect(nextActiveSession(undefined, { type: "plugin", id: "p" })).toBeUndefined()
    expect(nextActiveSession({ type: "session", sessionID: "ses_a" }, { type: "plugin", id: "p" })).toBeUndefined()
  })

  test("starting directly on home does not trigger", () => {
    expect(nextActiveSession(undefined, { type: "home" })).toBeUndefined()
  })
})