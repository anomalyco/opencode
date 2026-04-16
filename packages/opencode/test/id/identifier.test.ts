import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"

describe("Identifier", () => {
  describe("ascendingAfter", () => {
    test("generates ID strictly greater than afterID", () => {
      const parentId = Identifier.ascending("message")
      const childId = Identifier.ascendingAfter("message", parentId)
      expect(childId > parentId).toBe(true)
      expect(childId.startsWith("msg_")).toBe(true)
    })

    test("handles same-millisecond parent ID", () => {
      const now = Date.now()
      const parentId = Identifier.create("msg", "ascending", now)
      const childId = Identifier.ascendingAfter("message", parentId)
      expect(childId > parentId).toBe(true)
    })

    test("handles clock skew: frontend 300ms ahead", () => {
      const frontendTs = Date.now() + 300
      const parentId = Identifier.create("msg", "ascending", frontendTs)
      const childId = Identifier.ascendingAfter("message", parentId)
      expect(childId > parentId).toBe(true)
    })

    test("handles extreme clock skew: frontend 5s ahead", () => {
      const futureTs = Date.now() + 5000
      const parentId = Identifier.create("msg", "ascending", futureTs)
      const childId = Identifier.ascendingAfter("message", parentId)
      expect(childId > parentId).toBe(true)
    })

    test("produces unique IDs on repeated calls", () => {
      const parentId = Identifier.ascending("message")
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(Identifier.ascendingAfter("message", parentId))
      }
      expect(ids.size).toBe(100)
      for (const id of ids) {
        expect(id > parentId).toBe(true)
      }
    })

    test("does not interfere with ascending() monotonicity", () => {
      const before = Identifier.ascending("message")
      Identifier.ascendingAfter("message", before)
      const after = Identifier.ascending("message")
      expect(after > before).toBe(true)
    })
  })
})
