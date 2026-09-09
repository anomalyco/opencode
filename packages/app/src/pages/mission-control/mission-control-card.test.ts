import { describe, expect, test } from "bun:test"
import { deriveMissionControlStatus, formatAgentAge, formatUsage } from "./mission-control-model"

describe("mission control operational queue", () => {
  test("prioritizes work that needs the user", () => {
    expect(
      deriveMissionControlStatus({
        requests: { permission: {} },
        status: "busy",
        unseen: 0,
        failed: false,
        changes: 0,
      }),
    ).toBe("attention")
    expect(deriveMissionControlStatus({ status: "retry", unseen: 0, failed: false, changes: 0 })).toBe("attention")
    expect(deriveMissionControlStatus({ status: "idle", unseen: 0, failed: true, changes: 0 })).toBe("attention")
  })

  test("separates active, reviewable, and idle work", () => {
    expect(deriveMissionControlStatus({ status: "busy", unseen: 0, failed: false, changes: 0 })).toBe("working")
    expect(deriveMissionControlStatus({ status: "idle", unseen: 1, failed: false, changes: 0 })).toBe("ready")
    expect(deriveMissionControlStatus({ status: "idle", unseen: 0, failed: false, changes: 3 })).toBe("ready")
    expect(deriveMissionControlStatus({ status: "idle", unseen: 0, failed: false, changes: 0 })).toBe("idle")
  })

  test("formats compact operational metadata", () => {
    expect(formatAgentAge(30_000)).toBe("now")
    expect(formatAgentAge(14 * 60_000)).toBe("14m")
    expect(formatAgentAge(3 * 60 * 60_000)).toBe("3h")
    expect(formatUsage(0.012, 12_340)).toBe("$0.01 · 12.3k tok")
  })
})
