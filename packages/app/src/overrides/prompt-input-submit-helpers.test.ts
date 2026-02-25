import { describe, expect, test } from "bun:test"
import { resolveSession, extractErrorMessage, findReusableSession } from "./prompt-input-submit-helpers"

describe("resolveSession", () => {
  test("returns existing session when present", () => {
    const session = { id: "sess-123" }
    expect(resolveSession(session, false, "sess-123")).toBe(session)
  })

  test("returns existing session even for new-session flag", () => {
    const session = { id: "sess-456" }
    expect(resolveSession(session, true, undefined)).toBe(session)
  })

  test("returns undefined for new session with no existing session (creation path)", () => {
    expect(resolveSession(undefined, true, undefined)).toBeUndefined()
  })

  test("returns { id: paramsId } fallback when session is undefined, not new session, and paramsId exists", () => {
    const result = resolveSession(undefined, false, "sess-789")
    expect(result).toEqual({ id: "sess-789" })
  })

  test("returns undefined when no session, not new, and no paramsId", () => {
    expect(resolveSession(undefined, false, undefined)).toBeUndefined()
  })
})

describe("findReusableSession", () => {
  test("returns undefined when no sessions exist", () => {
    expect(findReusableSession([])).toBeUndefined()
  })

  test("returns the latest session when sessions exist", () => {
    const sessions = [{ id: "sess-1" }, { id: "sess-2" }, { id: "sess-3" }]
    expect(findReusableSession(sessions)).toEqual({ id: "sess-3" })
  })

  test("returns the only session when one exists", () => {
    expect(findReusableSession([{ id: "only-one" }])).toEqual({ id: "only-one" })
  })

  test("returns a new object (not a reference to the original)", () => {
    const sessions = [{ id: "sess-1" }]
    const result = findReusableSession(sessions)
    expect(result).toEqual({ id: "sess-1" })
    expect(result).not.toBe(sessions[0])
  })
})

describe("extractErrorMessage", () => {
  test("extracts data.message from API-style errors", () => {
    const err = { data: { message: "Rate limit exceeded" } }
    expect(extractErrorMessage(err, "fallback")).toBe("Rate limit exceeded")
  })

  test("extracts .message from standard Error instances", () => {
    const err = new Error("Network timeout")
    expect(extractErrorMessage(err, "fallback")).toBe("Network timeout")
  })

  test("returns fallback for unknown error shapes", () => {
    expect(extractErrorMessage("string error", "Request failed")).toBe("Request failed")
    expect(extractErrorMessage(42, "Request failed")).toBe("Request failed")
    expect(extractErrorMessage(null, "Request failed")).toBe("Request failed")
    expect(extractErrorMessage(undefined, "Request failed")).toBe("Request failed")
  })

  test("prefers data.message over Error.message", () => {
    const err = Object.assign(new Error("generic"), { data: { message: "specific" } })
    expect(extractErrorMessage(err, "fallback")).toBe("specific")
  })

  test("falls back to Error.message when data exists but has no message", () => {
    const err = Object.assign(new Error("from error"), { data: {} })
    expect(extractErrorMessage(err, "fallback")).toBe("from error")
  })
})
