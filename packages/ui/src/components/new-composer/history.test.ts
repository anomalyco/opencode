import { describe, expect, test } from "bun:test"
import {
  canNavigateAtCursor,
  cloneParts,
  navigateEntry,
  normalizeEntry,
  partText,
  prependEntry,
  type HistoryEntry,
} from "./history"

const text = (value: string): HistoryEntry => ({
  text: value,
  parts: [{ type: "text", content: value }],
})

describe("new-composer history", () => {
  test("prependEntry skips empty entries and deduplicates consecutive entries", () => {
    const blank: HistoryEntry[] = []
    const first = prependEntry(blank, text(""))
    expect(first).toBe(blank)

    const one = prependEntry([], text("hello"))
    expect(one).toHaveLength(1)

    const dup = prependEntry(one, text("hello"))
    expect(dup).toBe(one)
  })

  test("navigateEntry restores saved draft when moving down from newest", () => {
    const entries = [text("third"), text("second"), text("first")]

    const up = navigateEntry({
      direction: "up",
      entries,
      historyIndex: -1,
      current: text("draft"),
      saved: null,
    })

    expect(up.handled).toBe(true)
    if (!up.handled) throw new Error("expected handled")
    expect(up.historyIndex).toBe(0)
    expect(up.cursor).toBe("start")
    expect(up.entry.text).toBe("third")

    const down = navigateEntry({
      direction: "down",
      entries,
      historyIndex: up.historyIndex,
      current: text("ignored"),
      saved: up.saved,
    })

    expect(down.handled).toBe(true)
    if (!down.handled) throw new Error("expected handled")
    expect(down.historyIndex).toBe(-1)
    expect(down.entry.text).toBe("draft")
    expect(down.entry.parts).toEqual([{ type: "text", content: "draft" }])
  })

  test("navigateEntry keeps structured parts when navigating history", () => {
    const entry: HistoryEntry = {
      text: "@src/auth.ts",
      parts: [{ type: "file", path: "src/auth.ts", content: "@src/auth.ts" }],
    }

    const up = navigateEntry({
      direction: "up",
      entries: [entry],
      historyIndex: -1,
      current: text("draft"),
      saved: null,
    })

    expect(up.handled).toBe(true)
    if (!up.handled) throw new Error("expected handled")
    expect(up.entry.parts).toEqual(entry.parts)
  })

  test("normalizeEntry supports legacy string entries", () => {
    const entry = normalizeEntry("legacy")
    expect(entry.text).toBe("legacy")
    expect(entry.parts).toEqual([{ type: "text", content: "legacy" }])
  })

  test("helpers clone parts and count combined content", () => {
    const src = [
      { type: "text", content: "one" },
      { type: "file", path: "src/a.ts", content: "@src/a.ts" },
      { type: "agent", name: "coder", content: "@coder" },
    ] as const

    const copy = cloneParts([...src])
    expect(copy).not.toBe(src)
    expect(partText(copy)).toBe("one@src/a.ts@coder")

    if (copy[1]?.type !== "file") throw new Error("expected file")
    copy[1].path = "src/b.ts"
    if (src[1].type !== "file") throw new Error("expected file")
    expect(src[1].path).toBe("src/a.ts")
  })

  test("canNavigateAtCursor only allows history navigation at boundaries", () => {
    const value = "a\nb\nc"

    expect(canNavigateAtCursor("up", value, 0)).toBe(true)
    expect(canNavigateAtCursor("down", value, 0)).toBe(false)

    expect(canNavigateAtCursor("up", value, 2)).toBe(false)
    expect(canNavigateAtCursor("down", value, 2)).toBe(false)

    expect(canNavigateAtCursor("up", value, 5)).toBe(false)
    expect(canNavigateAtCursor("down", value, 5)).toBe(true)

    expect(canNavigateAtCursor("up", "abc", 0)).toBe(true)
    expect(canNavigateAtCursor("down", "abc", 3)).toBe(true)
    expect(canNavigateAtCursor("up", "abc", 1)).toBe(false)
    expect(canNavigateAtCursor("down", "abc", 1)).toBe(false)

    expect(canNavigateAtCursor("up", "abc", 0, true)).toBe(true)
    expect(canNavigateAtCursor("up", "abc", 3, true)).toBe(true)
    expect(canNavigateAtCursor("down", "abc", 0, true)).toBe(true)
    expect(canNavigateAtCursor("down", "abc", 3, true)).toBe(true)
    expect(canNavigateAtCursor("up", "abc", 1, true)).toBe(false)
    expect(canNavigateAtCursor("down", "abc", 1, true)).toBe(false)
  })
})
