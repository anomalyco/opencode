import { describe, expect, test } from "bun:test"
import { withTimeout } from "../../src/util/timeout"

describe("util.timeout", () => {
  describe("withTimeout", () => {
    test("resolves when promise resolves before timeout", async () => {
      const result = await withTimeout(Promise.resolve(42), 100)
      expect(result).toBe(42)
    })

    test("uses provided label on timeout", async () => {
      const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200))
      await expect(withTimeout(slow, 10, "test timeout")).rejects.toThrow("test timeout")
    })

    test("uses default label when none provided", async () => {
      const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200))
      await expect(withTimeout(slow, 10)).rejects.toThrow("Operation timed out after 10ms")
    })

    test("propagates rejection from underlying promise", async () => {
      const fail = Promise.reject(new Error("underlying"))
      await expect(withTimeout(fail, 100)).rejects.toThrow("underlying")
    })

    test("rejects immediately when signal already aborted", async () => {
      const ac = new AbortController()
      ac.abort()
      await expect(
        withTimeout(Promise.resolve(1), 100, "label", { signal: ac.signal }),
      ).rejects.toBeDefined()
    })

    test("rejects with signal reason when provided", async () => {
      const ac = new AbortController()
      const reason = new Error("custom abort")
      ac.abort(reason)
      await expect(
        withTimeout(Promise.resolve(1), 100, "label", { signal: ac.signal }),
      ).rejects.toBe(reason)
    })

    test("rejects when external signal aborts before timeout", async () => {
      const ac = new AbortController()
      const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200))
      setTimeout(() => ac.abort(), 10)
      const result = await withTimeout(slow, 1000, "label", { signal: ac.signal })
        .then(() => "resolved", (e: unknown) => String(e))
      expect(result).not.toContain("label")
    })

    test("does not fire timeout error when signal aborts first", async () => {
      const ac = new AbortController()
      const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200))
      setTimeout(() => ac.abort(), 5)
      const result = await withTimeout(slow, 50, "should not fire", { signal: ac.signal })
        .then(() => "resolved", (e: unknown) => String(e))
      expect(result).not.toContain("should not fire")
    })
  })
})
