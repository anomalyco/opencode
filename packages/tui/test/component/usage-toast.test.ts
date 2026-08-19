import { describe, expect, test } from "bun:test"
import type { UsageEntry, UsageWindow } from "../../src/component/usage-data"
import {
  usageFailureBackoffMs,
  usageRefreshFailed,
  usageRefreshCooldownMs,
  usageRemember,
  usageShouldRefresh,
  usageShownMax,
  usageWarning,
  usageWarningKey,
} from "../../src/component/usage-toast"

function entry(input: {
  provider?: string
  first?: number | null
  second?: number | null
  third?: number | null
}): UsageEntry {
  const toWindow = (id: string, label: string, value: number | null | undefined): UsageWindow | null => {
    if (value === null || value === undefined) return null
    return {
      id,
      label,
      usedPercent: value,
      windowMinutes: 60,
      resetsAt: 1_700_000_000,
    }
  }

  return {
    provider: input.provider ?? "openai",
    displayName: "OpenAI",
    status: "ok",
    snapshot: {
      windows: [
        toWindow("5h", "5h", input.first),
        toWindow("weekly", "Weekly", input.second),
        toWindow("monthly", "Monthly", input.third),
      ].filter((window): window is UsageWindow => window !== null),
      credits: null,
      planType: null,
      updatedAt: Date.now(),
    },
  }
}

describe("usage toast", () => {
  test("detects threshold crossings", () => {
    const warning = usageWarning(entry({ first: 80 }), entry({ first: 79 }).snapshot)
    expect(warning?.label).toBe("5h")
    expect(warning?.threshold).toBe(80)
  })

  test("returns null when no new threshold is crossed", () => {
    expect(usageWarning(entry({ first: 89 }), entry({ first: 85 }).snapshot)).toBeNull()
  })

  test("prefers stronger threshold across windows", () => {
    const warning = usageWarning(entry({ first: 82, second: 91 }), entry({ first: 79, second: 89 }).snapshot)
    expect(warning?.label).toBe("Weekly")
    expect(warning?.threshold).toBe(90)
  })

  test("prefers larger usage percent for equal threshold", () => {
    const warning = usageWarning(entry({ first: 82, second: 88 }), entry({ first: 79, second: 79 }).snapshot)
    expect(warning?.label).toBe("Weekly")
    expect(warning?.threshold).toBe(80)
  })

  test("sanitizes non-finite and out-of-range usage values", () => {
    expect(usageWarning(entry({ first: Number.NaN }), entry({ first: 79 }).snapshot)).toBeNull()

    const high = usageWarning(entry({ first: 150 }), entry({ first: 79 }).snapshot)
    expect(high?.threshold).toBe(95)
    expect(high?.usedPercent).toBe(100)
  })

  test("checks refresh cooldown and failure backoff", () => {
    const now = 1_000_000
    expect(
      usageShouldRefresh({
        now,
        successAt: 0,
        failureAt: 0,
        refreshing: true,
      }),
    ).toBeFalse()

    expect(
      usageShouldRefresh({
        now,
        successAt: now - usageRefreshCooldownMs + 1,
        failureAt: 0,
        refreshing: false,
      }),
    ).toBeFalse()

    expect(
      usageShouldRefresh({
        now,
        successAt: 0,
        failureAt: now - usageFailureBackoffMs + 1,
        refreshing: false,
      }),
    ).toBeFalse()

    expect(
      usageShouldRefresh({
        now,
        successAt: now - usageRefreshCooldownMs - 1,
        failureAt: now - usageFailureBackoffMs - 1,
        refreshing: false,
      }),
    ).toBeTrue()
  })

  test("classifies retryable result errors as refresh failures", () => {
    expect(usageRefreshFailed([{ error: { retryable: true } }])).toBeTrue()
    expect(usageRefreshFailed([{ error: { retryable: false } }, {}])).toBeFalse()
  })

  test("dedupes and evicts oldest key when full", () => {
    const shown = new Set<string>()
    const first = usageWarningKey("openai", {
      id: "5h",
      label: "5h",
      threshold: 80,
      usedPercent: 80,
      resetsAt: 1,
      windowMinutes: 60,
    })

    expect(usageRemember(shown, first)).toBeTrue()
    expect(usageRemember(shown, first)).toBeFalse()

    for (let index = 1; index < usageShownMax; index++) {
      usageRemember(
        shown,
        usageWarningKey("openai", {
          id: "5h",
          label: "5h",
          threshold: 80,
          usedPercent: 80 + index,
          resetsAt: index + 1,
          windowMinutes: 60,
        }),
      )
    }

    expect(shown.size).toBe(usageShownMax)
    expect(shown.has(first)).toBeTrue()

    const next = usageWarningKey("openai", {
      id: "weekly",
      label: "Weekly",
      threshold: 90,
      usedPercent: 90,
      resetsAt: 9_999,
      windowMinutes: 60,
    })
    expect(usageRemember(shown, next)).toBeTrue()
    expect(shown.size).toBe(usageShownMax)
    expect(shown.has(first)).toBeFalse()
    expect(shown.has(next)).toBeTrue()
  })
})
