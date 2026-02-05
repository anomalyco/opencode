import { describe, test, expect } from "bun:test"
import { Identifier } from "../../src/id/id"

describe("Identifier", () => {
  describe("create()", () => {
    test("generates IDs with correct prefix for each type", () => {
      const prefixes: Record<string, string> = {
        session: "ses_",
        message: "msg_",
        permission: "per_",
        question: "que_",
        user: "usr_",
        part: "prt_",
        pty: "pty_",
        tool: "tool_",
      }

      for (const [key, expectedPrefix] of Object.entries(prefixes)) {
        const id = Identifier.create(key as any, false)
        expect(id).toStartWith(expectedPrefix)
      }
    })

    test("generates unique IDs across many invocations", () => {
      const ids = new Set<string>()
      const count = 1000

      for (let i = 0; i < count; i++) {
        ids.add(Identifier.create("session", false))
      }

      expect(ids.size).toBe(count)
    })

    test("generates IDs with correct total length", () => {
      // Format: prefix + "_" + 12 hex chars (6 bytes) + 14 base62 chars (LENGTH=26, 26-12=14)
      const id = Identifier.create("session", false)
      // "ses" (3) + "_" (1) + 12 hex + 14 random = 30
      expect(id.length).toBe(3 + 1 + 12 + 14)

      const msgId = Identifier.create("message", false)
      // "msg" (3) + "_" (1) + 12 hex + 14 random = 30
      expect(msgId.length).toBe(3 + 1 + 12 + 14)

      const toolId = Identifier.create("tool", false)
      // "tool" (4) + "_" (1) + 12 hex + 14 random = 31
      expect(toolId.length).toBe(4 + 1 + 12 + 14)
    })

    test("IDs contain only valid characters", () => {
      const base62 = /^[0-9A-Za-z]+$/
      const hex = /^[0-9a-f]+$/

      for (let i = 0; i < 100; i++) {
        const id = Identifier.create("session", false)
        const parts = id.split("_")
        expect(parts.length).toBe(2)

        const [prefix, rest] = parts
        expect(prefix).toBe("ses")

        // First 12 chars are hex (timestamp), rest are base62
        const hexPart = rest.slice(0, 12)
        const randomPart = rest.slice(12)
        expect(hexPart).toMatch(hex)
        expect(randomPart).toMatch(base62)
      }
    })

    test("ascending IDs are sortable in ascending order", async () => {
      const ids: string[] = []
      for (let i = 0; i < 5; i++) {
        ids.push(Identifier.create("session", false, Date.now() + i * 1000))
        // Small delay to ensure different timestamps
      }

      const sorted = [...ids].sort()
      expect(ids).toEqual(sorted)
    })

    test("descending=true generates reverse-sortable IDs", () => {
      const ids: string[] = []
      for (let i = 0; i < 5; i++) {
        ids.push(Identifier.create("session", true, Date.now() + i * 1000))
      }

      // For descending IDs, later timestamps should sort earlier
      const sorted = [...ids].sort()
      expect(ids).toEqual(sorted.reverse())
    })

    test("create with custom timestamp embeds it in a sortable way", () => {
      const t1 = 1700000000000
      const t2 = 1700000001000
      const id1 = Identifier.create("session", false, t1)
      const id2 = Identifier.create("session", false, t2)

      // IDs created with ascending timestamps should sort in ascending order
      expect(id1 < id2).toBe(true)

      // Extracted timestamps should maintain relative ordering
      const extracted1 = Identifier.timestamp(id1)
      const extracted2 = Identifier.timestamp(id2)
      expect(extracted1).toBeLessThan(extracted2)
    })
  })

  describe("ascending()", () => {
    test("generates an ascending ID with correct prefix", () => {
      const id = Identifier.ascending("message")
      expect(id).toStartWith("msg_")
    })

    test("returns given ID if it already has the correct prefix", () => {
      const existing = "msg_abcdef123456abcdefghijklmn"
      const result = Identifier.ascending("message", existing)
      expect(result).toBe(existing)
    })

    test("throws if given ID has wrong prefix", () => {
      expect(() => {
        Identifier.ascending("message", "ses_wrong_prefix_id")
      }).toThrow("does not start with msg")
    })
  })

  describe("descending()", () => {
    test("generates a descending ID with correct prefix", () => {
      const id = Identifier.descending("session")
      expect(id).toStartWith("ses_")
    })

    test("returns given ID if it already has the correct prefix", () => {
      const existing = "ses_abcdef123456abcdefghijklmn"
      const result = Identifier.descending("session", existing)
      expect(result).toBe(existing)
    })

    test("throws if given ID has wrong prefix", () => {
      expect(() => {
        Identifier.descending("session", "msg_wrong_prefix_id")
      }).toThrow("does not start with ses")
    })
  })

  describe("timestamp()", () => {
    test("extracts timestamps that preserve relative ordering", () => {
      const t1 = Date.now()
      const t2 = t1 + 5000
      const id1 = Identifier.create("session", false, t1)
      const id2 = Identifier.create("session", false, t2)

      const extracted1 = Identifier.timestamp(id1)
      const extracted2 = Identifier.timestamp(id2)

      // Relative ordering must be preserved
      expect(extracted1).toBeLessThan(extracted2)
    })

    test("extracts consistent timestamps from IDs with same source timestamp", () => {
      const fixedTime = 1700000000000
      const id1 = Identifier.create("message", false, fixedTime)
      const id2 = Identifier.create("message", false, fixedTime)

      const t1 = Identifier.timestamp(id1)
      const t2 = Identifier.timestamp(id2)

      // Same source timestamp produces same extracted timestamp
      // (counter difference is sub-millisecond, integer division removes it)
      expect(t1).toBe(t2)
    })

    test("returns a number", () => {
      const id = Identifier.ascending("session")
      const ts = Identifier.timestamp(id)
      expect(typeof ts).toBe("number")
      expect(Number.isFinite(ts)).toBe(true)
    })
  })

  describe("schema()", () => {
    test("validates IDs with correct prefix", () => {
      const sessionSchema = Identifier.schema("session")
      const id = Identifier.ascending("session")
      const result = sessionSchema.safeParse(id)
      expect(result.success).toBe(true)
    })

    test("rejects IDs with wrong prefix", () => {
      const sessionSchema = Identifier.schema("session")
      const result = sessionSchema.safeParse("msg_not-a-session-id")
      expect(result.success).toBe(false)
    })

    test("rejects non-string values", () => {
      const sessionSchema = Identifier.schema("session")
      const result = sessionSchema.safeParse(12345)
      expect(result.success).toBe(false)
    })
  })

  describe("monotonic counter", () => {
    test("generates unique IDs even with the same timestamp", () => {
      const fixedTime = 1700000000000
      const id1 = Identifier.create("session", false, fixedTime)
      const id2 = Identifier.create("session", false, fixedTime)

      // IDs should differ even with same timestamp due to monotonic counter + random suffix
      expect(id1).not.toBe(id2)
    })
  })
})
