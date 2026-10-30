import { describe, expect, test } from "bun:test"
import type { AutomationInfo } from "@opencode/client/promise"
import {
  automationKind,
  automationTitle,
  compareSchedules,
  formatAutomationWhen,
  formatConditionGuard,
  formatConditionSummary,
  formatRelativeTime,
  matchesAutomationQuery,
} from "./format"

function makeSchedule(overrides: Partial<AutomationInfo> & { id: string }): AutomationInfo {
  return {
    sessionID: "ses_1",
    when: { type: "every", every: "30 seconds" },
    tz: "America/Los_Angeles",
    action: { type: "prompt", prompt: "Check build status" },
    status: "active",
    runCount: 0,
    time: { created: 1_000, updated: 1_000 },
    ...overrides,
  }
}

describe("automations format helpers", () => {
  test("classifies until, if, and plain schedules", () => {
    expect(automationKind(makeSchedule({ id: "aut_1", until: { type: "shell", run: "gh pr checks 1" } }))).toBe(
      "until",
    )
    expect(automationKind(makeSchedule({ id: "aut_2", if: { type: "code", code: "return true" } }))).toBe("if")
    expect(automationKind(makeSchedule({ id: "aut_3" }))).toBe("schedule")
  })

  test("falls back to single-line prompt when name is absent", () => {
    const unnamed = makeSchedule({
      id: "aut_1",
      action: { type: "prompt", prompt: "Summarize\novernight   Slack threads" },
    })

    expect(automationTitle(unnamed)).toBe("Summarize overnight Slack threads")
  })

  test("formats triggers, condition summaries, and relative times", () => {
    expect(formatAutomationWhen({ type: "cron", cron: "0 9 * * 1-5" })).toBe("cron 0 9 * * 1-5")
    expect(
      formatConditionSummary(
        makeSchedule({ id: "aut_1", until: { type: "shell", run: "gh pr checks 60478", changes: true } }),
      ),
    ).toBe("until $ gh pr checks 60478")
    expect(formatConditionGuard({ type: "shell", run: "git rev-parse HEAD", changes: true })).toBe(
      "wakes when stdout changes",
    )
    expect(formatRelativeTime(125_000, 100_000)).toBe("in 25s")
    expect(formatRelativeTime(100_000, 220_000)).toBe("2m ago")
  })

  test("orders active automations by soonest nextDueAt, ahead of paused and done", () => {
    const done = makeSchedule({ id: "aut_done", status: "done", time: { created: 1, updated: 9_000 } })
    const paused = makeSchedule({ id: "aut_paused", status: "paused", time: { created: 1, updated: 8_000 } })
    const activeLater = makeSchedule({ id: "aut_later", status: "active", nextDueAt: 5_000 })
    const activeSooner = makeSchedule({ id: "aut_sooner", status: "active", nextDueAt: 2_000 })

    const sorted = [done, activeLater, paused, activeSooner].toSorted(compareSchedules)
    expect(sorted.map((item) => item.id)).toEqual(["aut_sooner", "aut_later", "aut_paused", "aut_done"])
  })

  test("filters across prompt, shell check, and session/project metadata", () => {
    const item = makeSchedule({
      id: "aut_watch",
      name: "CI green watch",
      until: { type: "shell", run: "gh pr checks 60478" },
      action: { type: "prompt", prompt: "Report check timings" },
    })

    expect(matchesAutomationQuery(item, "60478")).toBe(true)
    expect(matchesAutomationQuery(item, "opencode-repo", "opencode-repo · PR thread")).toBe(true)
    expect(matchesAutomationQuery(item, "nonexistent")).toBe(false)
  })
})
