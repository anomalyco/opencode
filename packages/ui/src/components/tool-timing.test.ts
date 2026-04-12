import { describe, expect, test } from "bun:test"
import { formatToolDuration, formatToolHeaderTiming, isToolInterrupted } from "./tool-timing"
import type { ToolPart } from "@opencode-ai/sdk/v2"

describe("formatToolDuration", () => {
  test("formats seconds", () => {
    expect(formatToolDuration(45_000, "en-US")).toBe("45s")
  })

  test("formats minutes and seconds", () => {
    expect(formatToolDuration(62_000, "en-US")).toBe("1m 2s")
  })

  test("formats hours minutes and seconds", () => {
    expect(formatToolDuration(5_663_000, "en-US")).toBe("1h 34m 23s")
  })

  test("formats zero as 0s", () => {
    expect(formatToolDuration(0, "en-US")).toBe("0s")
  })

  test("formats sub-second as 1s", () => {
    expect(formatToolDuration(1, "en-US")).toBe("1s")
    expect(formatToolDuration(499, "en-US")).toBe("1s")
  })
})

describe("formatToolHeaderTiming", () => {
  test("returns empty string when start is missing", () => {
    expect(formatToolHeaderTiming({ end: 1_000, locale: "en-US" })).toBe("")
  })

  test("formats completed tool timing", () => {
    const start = Date.UTC(2026, 3, 12, 14, 3, 27)
    const end = start + 45_000
    expect(
      formatToolHeaderTiming({
        start,
        end,
        locale: "en-US",
        timeZone: "UTC",
      }),
    ).toBe("02:03 PM · 45s")
  })

  test("formats running tool timing from now", () => {
    const start = Date.UTC(2026, 3, 12, 14, 3, 27)
    const now = start + 62_000
    expect(
      formatToolHeaderTiming({
        start,
        now,
        locale: "en-US",
        timeZone: "UTC",
      }),
    ).toBe("02:03 PM · 1m 2s")
  })

  test("formats zero-duration completed tool as 0s", () => {
    const start = Date.UTC(2026, 3, 12, 14, 3, 27)
    expect(
      formatToolHeaderTiming({
        start,
        end: start,
        locale: "en-US",
        timeZone: "UTC",
      }),
    ).toBe("02:03 PM · 0s")
  })
})

describe("isToolInterrupted", () => {
  const base = { id: "t1", sessionID: "s1", messageID: "m1", tool: "read", callID: "c1", type: "tool" as const }

  test("returns false for pending tool", () => {
    const part = { ...base, state: { status: "pending" as const } } as ToolPart
    expect(isToolInterrupted(part)).toBe(false)
  })

  test("returns false for completed tool", () => {
    const part = {
      ...base,
      state: { status: "completed" as const, input: {}, output: "", time: { start: 1, end: 2 } },
    } as ToolPart
    expect(isToolInterrupted(part)).toBe(false)
  })

  test("returns false for error tool without interrupted metadata", () => {
    const part = {
      ...base,
      state: { status: "error" as const, input: {}, error: "fail", time: { start: 1, end: 2 } },
    } as ToolPart
    expect(isToolInterrupted(part)).toBe(false)
  })

  test("returns true for error tool with interrupted metadata", () => {
    const part = {
      ...base,
      state: {
        status: "error" as const,
        input: {},
        error: "interrupted",
        metadata: { interrupted: true },
        time: { start: 1, end: 1 },
      },
    } as ToolPart
    expect(isToolInterrupted(part)).toBe(true)
  })
})
