import { describe, test, expect } from "bun:test"
import { Option } from "effect"
import { encodeCapsule, decodeCapsule, decodeCapsuleOption } from "../../src/s2s/capsule"

describe("S2SCapsule", () => {
  const base = {
    version: 1 as const,
    id: "0190abcd-7abc-7abc-8abc-0190abcdef01",
    sender_slug: "alice",
    sender_session_id: "ses_a",
    timestamp: 1,
    body: "hi",
  }
  test("round-trips", () => {
    expect(decodeCapsule(encodeCapsule(base))).toMatchObject({ sender_slug: "alice", body: "hi" })
  })
  test("carries optional sender_name (session title) round-trip", () => {
    const named = { ...base, sender_name: "Alice's Session" }
    expect(decodeCapsule(encodeCapsule(named))).toMatchObject({ sender_name: "Alice's Session" })
    // absent sender_name decodes fine (backward compat with older capsules)
    expect(decodeCapsule(encodeCapsule(base)).sender_name).toBeUndefined()
  })
  test("forward-compatible: ignores unknown fields", () => {
    const raw = JSON.stringify({ ...base, futureField: 99 })
    expect(() => decodeCapsule(raw)).not.toThrow()
    expect(decodeCapsule(raw)).toMatchObject({ sender_slug: "alice" })
  })
  test("malformed input -> None, does not throw (poller safety)", () => {
    expect(Option.isNone(decodeCapsuleOption("not json"))).toBe(true)
    expect(Option.isNone(decodeCapsuleOption(JSON.stringify({ version: 1 })))).toBe(true) // missing required fields
  })
})
