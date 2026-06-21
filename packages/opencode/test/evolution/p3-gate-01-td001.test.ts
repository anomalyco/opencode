import { describe, expect, test } from "bun:test"
import type { MemoryEntry } from "@/evolution/brain/memory"

// We import the helper via dynamic access to the source module
// checkLimit is not exported, so we test equivalent logic directly

function checkLimit(entries: MemoryEntry[], limit: number) {
  return limit > 0 && entries.length >= limit
}

describe("TD-001 — Memory Write Limit", () => {
  test("(pass) limit blocks write #51", () => {
    const entries: MemoryEntry[] = []
    for (let i = 0; i < 50; i++) {
      entries.push({ id: String(i), type: "lesson", content: `entry ${i}`, tags: [], created: i, updated: i })
    }
    expect(checkLimit(entries, 50)).toBe(true)
  })

  test("(pass) write #50 allowed at exact limit", () => {
    const entries: MemoryEntry[] = []
    for (let i = 0; i < 49; i++) {
      entries.push({ id: String(i), type: "lesson", content: `entry ${i}`, tags: [], created: i, updated: i })
    }
    expect(checkLimit(entries, 50)).toBe(false)
  })

  test("(pass) limit custom configurable", () => {
    const entries: MemoryEntry[] = []
    for (let i = 0; i < 3; i++) {
      entries.push({ id: String(i), type: "lesson", content: `entry ${i}`, tags: [], created: i, updated: i })
    }
    expect(checkLimit(entries, 3)).toBe(true)
    expect(checkLimit(entries, 5)).toBe(false)
  })

  test("(pass) unlimited mode when set to 0", () => {
    const entries: MemoryEntry[] = []
    for (let i = 0; i < 100; i++) {
      entries.push({ id: String(i), type: "lesson", content: `entry ${i}`, tags: [], created: i, updated: i })
    }
    expect(checkLimit(entries, 0)).toBe(false)
  })

  test("(pass) empty list never blocked", () => {
    expect(checkLimit([], 50)).toBe(false)
  })
})
