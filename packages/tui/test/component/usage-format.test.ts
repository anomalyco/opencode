import { describe, expect, test } from "bun:test"
import {
  formatCreditsLabel,
  formatUsageResetAbsolute,
  formatUsageWindowLabel,
  usageBarString,
  usageDisplay,
} from "../../src/component/usage-format"

describe("usage format", () => {
  test("returns used mode percent and label", () => {
    expect(usageDisplay(64.2, "used")).toEqual({
      percent: 64.2,
      label: "used",
    })
  })

  test("returns remaining mode percent and label", () => {
    expect(usageDisplay(64.2, "remaining")).toEqual({
      percent: 35.8,
      label: "remaining",
    })
  })

  test("clamps invalid values before used/remaining conversion", () => {
    expect(usageDisplay(-10, "used").percent).toBe(0)
    expect(usageDisplay(250, "used").percent).toBe(100)
    expect(usageDisplay(Number.NaN, "used").percent).toBe(0)
    expect(usageDisplay(250, "remaining").percent).toBe(0)
  })

  test("clamps usage bar rendering", () => {
    expect(usageBarString(250, 10)).toBe("██████████")
    expect(usageBarString(-10, 10)).toBe("░░░░░░░░░░")
  })

  test("formats labels supplied by providers", () => {
    expect(formatUsageWindowLabel("5h", null)).toBe("5h")
    expect(formatUsageWindowLabel("Weekly", null)).toBe("Weekly")
    expect(formatUsageWindowLabel("Hourly", 60)).toBe("Hourly")
    expect(formatUsageWindowLabel("Hourly", 180)).toBe("3h")
  })

  test("formats copilot quota for remaining mode", () => {
    expect(
      formatCreditsLabel(
        {
          hasCredits: true,
          unlimited: false,
          balance: "73",
          label: "Premium Requests",
          total: 300,
          used: 247,
          remaining: 53,
        },
        { mode: "remaining" },
      ),
    ).toBe("Premium Requests Remaining: 53")
  })

  test("formats copilot AI credits from provider label", () => {
    expect(
      formatCreditsLabel(
        {
          hasCredits: true,
          unlimited: false,
          balance: "5000",
          label: "GitHub AI Credits",
          total: 5000,
          used: 0,
          remaining: 5000,
        },
        { mode: "remaining" },
      ),
    ).toBe("GitHub AI Credits Remaining: 5000")
  })

  test("formats independent copilot AI credit usage", () => {
    expect(
      formatCreditsLabel(
        {
          hasCredits: true,
          unlimited: true,
          balance: null,
          label: "GitHub AI Credits",
          total: null,
          used: 12.5,
          remaining: null,
        },
        { mode: "used" },
      ),
    ).toBe("GitHub AI Credits Used: 12.5")
  })

  test("formats copilot overage availability", () => {
    expect(
      formatCreditsLabel(
        {
          hasCredits: false,
          unlimited: false,
          balance: null,
          label: "GitHub AI Credits",
          overagePermitted: true,
        },
        { mode: "remaining" },
      ),
    ).toBe("GitHub AI Credits: Overage enabled")
  })

  test("formats copilot quota for used mode", () => {
    expect(
      formatCreditsLabel(
        {
          hasCredits: true,
          unlimited: false,
          balance: "73",
          label: "Premium Requests",
          total: 300,
          used: 247,
          remaining: 53,
        },
        { mode: "used" },
      ),
    ).toBe("Premium Requests Used: 247")
  })

  test("formats copilot used mode without counts as unknown", () => {
    expect(
      formatCreditsLabel(
        {
          hasCredits: true,
          unlimited: false,
          balance: "73",
          label: "Premium Requests",
        },
        { mode: "used" },
      ),
    ).toBe("Premium Requests Used: Unknown")
  })

  test("formats anthropic credits as usage credits", () => {
    expect(
      formatCreditsLabel({
        hasCredits: true,
        unlimited: false,
        balance: "100",
        label: "Usage Credits",
      }),
    ).toBe("Usage Credits: 100")
  })

  test("preserves decimal credit balances", () => {
    expect(
      formatCreditsLabel({
        hasCredits: true,
        unlimited: false,
        balance: "12.34",
        label: "Usage Credits",
      }),
    ).toBe("Usage Credits: 12.34")
  })

  test("formatUsageResetAbsolute returns 'now' for past or current reset", () => {
    const now = Date.parse("2026-04-19T10:00:00")
    expect(formatUsageResetAbsolute(0, now)).toBe("now")
    expect(formatUsageResetAbsolute(Math.floor(now / 1000) - 100, now)).toBe("now")
    expect(formatUsageResetAbsolute(Math.floor(now / 1000), now)).toBe("now")
  })

  test("formatUsageResetAbsolute prefixes 'today at' for same calendar day", () => {
    const now = new Date(2026, 3, 19, 10, 0, 0).getTime()
    const reset = Math.floor(new Date(2026, 3, 19, 15, 15, 0).getTime() / 1000)
    expect(formatUsageResetAbsolute(reset, now)).toMatch(/^today at /)
  })

  test("formatUsageResetAbsolute prefixes 'tomorrow at' for next calendar day", () => {
    const now = new Date(2026, 3, 19, 10, 0, 0).getTime()
    const reset = Math.floor(new Date(2026, 3, 20, 15, 15, 0).getTime() / 1000)
    expect(formatUsageResetAbsolute(reset, now)).toMatch(/^tomorrow at /)
  })

  test("formatUsageResetAbsolute uses short weekday when within a week", () => {
    const now = new Date(2026, 3, 19, 10, 0, 0).getTime()
    const reset = Math.floor(new Date(2026, 3, 22, 15, 15, 0).getTime() / 1000)
    const result = formatUsageResetAbsolute(reset, now)
    expect(result).toMatch(/ at /)
    expect(result).not.toMatch(/^today/)
    expect(result).not.toMatch(/^tomorrow/)
    expect(result).not.toMatch(/Apr|Jan|Feb|Mar|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/)
  })

  test("formatUsageResetAbsolute uses month and day beyond a week", () => {
    const now = new Date(2026, 3, 19, 10, 0, 0).getTime()
    const reset = Math.floor(new Date(2026, 3, 30, 15, 15, 0).getTime() / 1000)
    const result = formatUsageResetAbsolute(reset, now)
    expect(result).toMatch(/ at /)
    expect(result).not.toMatch(/^today|^tomorrow/)
  })
})
