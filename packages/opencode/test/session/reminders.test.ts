import { describe, expect, test } from "bun:test"
import { SessionReminders } from "../../src/session/reminders"
import BUILD_MODE from "../../src/session/prompt/build-mode.txt"

// SessionReminders.apply decides which synthetic mode reminder goes on the last user message.
// Only the decision is pure enough to test without the full Effect service graph, so the legacy
// (non-experimentalPlanMode) branch — the default every user runs — is covered here directly.
describe("SessionReminders legacy reminder selection", () => {
  test("plan agent gets the plan reminder on every turn", () => {
    expect(SessionReminders.legacyReminder("plan", false)).toBe("plan")
    expect(SessionReminders.legacyReminder("plan", true)).toBe("plan")
  })

  test("build session that never entered plan gets a standing build reminder (#52444)", () => {
    // The regression: before #52444 this returned null, so a pure-build session carried no mode
    // signal at all and the model could claim a read-only mode that does not exist.
    expect(SessionReminders.legacyReminder("build", false)).toBe("build")
  })

  test("plan → build keeps the transition banner", () => {
    expect(SessionReminders.legacyReminder("build", true)).toBe("build-switch")
  })

  test("custom primary agents are left untouched", () => {
    expect(SessionReminders.legacyReminder("ask", false)).toBeNull()
    expect(SessionReminders.legacyReminder("ask", true)).toBeNull()
    expect(SessionReminders.legacyReminder("review", false)).toBeNull()
  })

  test("build reminder is a self-contained system-reminder block", () => {
    expect(BUILD_MODE.startsWith("<system-reminder>")).toBe(true)
    expect(BUILD_MODE.trimEnd().endsWith("</system-reminder>")).toBe(true)
    expect(BUILD_MODE).toContain("Build mode is active")
    // must not read as an ordering hint the model could confuse with plan mode
    expect(BUILD_MODE).not.toContain("read-only phase")
  })
})
