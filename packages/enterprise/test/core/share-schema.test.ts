import { describe, expect, test } from "bun:test"
import { Share } from "../../src/core/share"

describe("core.share schema validation", () => {
  describe("ShareID", () => {
    test("accepts the generated share id shape", () => {
      expect(Share.ShareID.safeParse("abcDEF012_-").success).toBe(true)
      expect(Share.ShareID.safeParse("test_01234567").success).toBe(true)
    })

    test("rejects traversal and separator characters", () => {
      for (const value of ["..", "../x", "a/b", "a\\b", "a%2Fb", "", "a".repeat(65)]) {
        expect(Share.ShareID.safeParse(value).success).toBe(false)
      }
    })
  })

  describe("Data", () => {
    test("accepts well-shaped items", () => {
      expect(Share.Data.safeParse({ type: "part", data: { id: "p1", messageID: "m1", type: "text" } }).success).toBe(
        true,
      )
      expect(Share.Data.safeParse({ type: "message", data: { id: "m1", sessionID: "s1" } }).success).toBe(true)
      expect(Share.Data.safeParse({ type: "session", data: { id: "s1" } }).success).toBe(true)
    })

    test("rejects arbitrary payloads that z.custom previously accepted", () => {
      expect(Share.Data.safeParse({ type: "part", data: "not-a-part" }).success).toBe(false)
      expect(Share.Data.safeParse({ type: "part", data: { id: 42, messageID: "m1", type: "text" } }).success).toBe(
        false,
      )
      expect(Share.Data.safeParse({ type: "model", data: { nope: true } }).success).toBe(false)
    })

    test("caps array payload size", () => {
      const oversized = Array.from({ length: Share.MAX_SYNC_ITEMS + 1 }, () => ({}))
      expect(Share.Data.safeParse({ type: "session_diff", data: oversized }).success).toBe(false)
    })

    test("rejects an element over the serialized byte budget", () => {
      const huge = { id: "p1", messageID: "m1", type: "text", text: "x".repeat(Share.MAX_ELEMENT_BYTES) }
      expect(Share.Data.safeParse({ type: "part", data: huge }).success).toBe(false)
    })
  })
})
