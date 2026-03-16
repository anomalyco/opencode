import { describe, expect, test } from "bun:test"
import { extractSessionID } from "../../src/bus/session-filter"

describe("extractSessionID edge cases", () => {
  test("ignores numeric sessionID on properties", () => {
    expect(extractSessionID({ type: "session.status", properties: { sessionID: 123 as any } })).toBeUndefined()
  })

  test("ignores null sessionID on properties", () => {
    expect(extractSessionID({ type: "session.status", properties: { sessionID: null as any } })).toBeUndefined()
  })

  test("returns sessionID from properties even for non-session types", () => {
    // Direct sessionID on properties is always trusted (first check)
    expect(extractSessionID({ type: "custom.event", properties: { sessionID: "ses_custom" } })).toBe("ses_custom")
  })

  test("does not match info.id for message.* types", () => {
    // info.id only matches for session.* types
    expect(extractSessionID({ type: "message.created", properties: { info: { id: "ses_x" } } })).toBeUndefined()
  })

  test("handles info.id for session.deleted", () => {
    expect(extractSessionID({ type: "session.deleted", properties: { info: { id: "ses_del" } } })).toBe("ses_del")
  })

  test("handles info.id for session.updated", () => {
    expect(extractSessionID({ type: "session.updated", properties: { info: { id: "ses_upd" } } })).toBe("ses_upd")
  })

  test("ignores info with numeric id for session types", () => {
    expect(extractSessionID({ type: "session.created", properties: { info: { id: 42 } } })).toBeUndefined()
  })

  test("ignores non-object info", () => {
    expect(extractSessionID({ type: "session.created", properties: { info: "not_an_object" } })).toBeUndefined()
  })

  test("ignores null info", () => {
    expect(extractSessionID({ type: "session.created", properties: { info: null } })).toBeUndefined()
  })

  test("prefers direct sessionID over info.id", () => {
    // Direct sessionID is checked first
    expect(
      extractSessionID({
        type: "session.created",
        properties: { sessionID: "ses_direct", info: { id: "ses_info" } },
      }),
    ).toBe("ses_direct")
  })

  test("handles part with non-string sessionID", () => {
    expect(
      extractSessionID({ type: "message.part.updated", properties: { part: { sessionID: 99 } } }),
    ).toBeUndefined()
  })

  test("ignores non-object part", () => {
    expect(extractSessionID({ type: "message.part.updated", properties: { part: "string" } })).toBeUndefined()
  })

  test("handles empty properties object", () => {
    expect(extractSessionID({ type: "anything", properties: {} })).toBeUndefined()
  })

  test("handles properties with unrelated keys", () => {
    expect(extractSessionID({ type: "lsp.status", properties: { server: "ts", status: "running" } })).toBeUndefined()
  })

  test("message.updated with info.sessionID works", () => {
    expect(
      extractSessionID({
        type: "message.updated",
        properties: { info: { sessionID: "ses_msg_upd", role: "assistant" } },
      }),
    ).toBe("ses_msg_upd")
  })

  test("info.sessionID is matched for any type (not just message.*)", () => {
    // The info.sessionID path is NOT gated on type prefix
    expect(
      extractSessionID({
        type: "custom.event",
        properties: { info: { sessionID: "ses_generic" } },
      }),
    ).toBe("ses_generic")
  })
})
