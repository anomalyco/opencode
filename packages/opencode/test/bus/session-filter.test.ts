import { describe, expect, test } from "bun:test"
import { extractSessionID } from "../../src/bus/session-filter"

describe("extractSessionID", () => {
  test("returns sessionID from direct properties.sessionID", () => {
    expect(extractSessionID({ type: "session.status", properties: { sessionID: "ses_abc" } })).toBe("ses_abc")
  })

  test("returns id from session.created shape", () => {
    expect(extractSessionID({ type: "session.created", properties: { info: { id: "ses_xyz" } } })).toBe("ses_xyz")
  })

  test("returns sessionID from message.updated shape", () => {
    expect(extractSessionID({ type: "message.updated", properties: { info: { sessionID: "ses_msg" } } })).toBe(
      "ses_msg",
    )
  })

  test("returns sessionID from message.part.updated shape", () => {
    expect(extractSessionID({ type: "message.part.updated", properties: { part: { sessionID: "ses_part" } } })).toBe(
      "ses_part",
    )
  })

  test("returns undefined for server events", () => {
    expect(extractSessionID({ type: "server.heartbeat", properties: {} })).toBeUndefined()
  })

  test("returns undefined when properties is missing", () => {
    expect(extractSessionID({ type: "x", properties: undefined })).toBeUndefined()
  })

  test("does not match info.id for non-session types", () => {
    expect(extractSessionID({ type: "config.created", properties: { info: { id: "x" } } })).toBeUndefined()
  })
})
