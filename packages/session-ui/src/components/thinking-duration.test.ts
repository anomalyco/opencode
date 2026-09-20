import { describe, expect, test } from "bun:test"
import { formatThinkingDuration, LIVE_CREATED_MAX_AGE_MS, thinkingElapsedMs } from "./thinking-duration"

describe("formatThinkingDuration", () => {
  test("formats whole seconds without a fraction", () => {
    expect(formatThinkingDuration(7000, "en")).toEqual({ kind: "seconds", count: "7" })
  })

  test("keeps one decimal for fractional seconds", () => {
    expect(formatThinkingDuration(8400, "en")).toEqual({ kind: "seconds", count: "8.4" })
  })

  test("formats minutes and seconds after one minute", () => {
    expect(formatThinkingDuration(125_000, "en")).toEqual({
      kind: "minutesSeconds",
      minutes: "2",
      seconds: "5",
    })
  })
})

describe("thinkingElapsedMs", () => {
  test("uses createdAt while streaming when it is recent", () => {
    expect(
      thinkingElapsedMs({
        streaming: true,
        createdAt: 1_000,
        now: 3_400,
        fallbackStart: 3_000,
      }),
    ).toBe(2_400)
  })

  test("falls back to mount time when a live createdAt is stale", () => {
    expect(
      thinkingElapsedMs({
        streaming: true,
        createdAt: 1_000,
        now: 1_000 + LIVE_CREATED_MAX_AGE_MS + 1,
        fallbackStart: 50_000,
      }),
    ).toBe(1_000 + LIVE_CREATED_MAX_AGE_MS + 1 - 50_000)
  })

  test("uses completed minus created when the part is finished", () => {
    expect(
      thinkingElapsedMs({
        streaming: false,
        createdAt: 100,
        completedAt: 7_100,
        now: 20_000,
        fallbackStart: 200,
      }),
    ).toBe(7_000)
  })

  test("returns undefined for history parts without timestamps", () => {
    expect(
      thinkingElapsedMs({
        streaming: false,
        now: 20_000,
        fallbackStart: 200,
      }),
    ).toBeUndefined()
  })
})
