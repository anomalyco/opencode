import { describe, expect, test } from "bun:test"
import { parseInitialRoute } from "../../src/context/route"

describe("parseInitialRoute", () => {
  test("parses the sessions route", () => {
    expect(parseInitialRoute({ type: "sessions" })).toEqual({ type: "sessions" })
  })

  test("parses the home route", () => {
    expect(parseInitialRoute({ type: "home" })).toEqual({ type: "home" })
  })

  test("parses a session route with a session id", () => {
    expect(parseInitialRoute({ type: "session", sessionID: "abc" })).toEqual({ type: "session", sessionID: "abc" })
  })

  test("rejects unknown route types", () => {
    expect(parseInitialRoute({ type: "nope" })).toBeUndefined()
  })

  test("rejects non-object values", () => {
    expect(parseInitialRoute("sessions")).toBeUndefined()
    expect(parseInitialRoute(undefined)).toBeUndefined()
    expect(parseInitialRoute(null)).toBeUndefined()
  })
})
