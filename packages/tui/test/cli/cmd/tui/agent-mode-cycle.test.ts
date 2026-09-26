import { describe, expect, test } from "bun:test"
import { CommandMap, Definitions } from "../../../../src/config/keybind"
import { cycleMode, modeLabel, type ModeCycleState } from "../../../../src/mode-cycle"

const available = ["build", "plan", "reviewer"]

describe("agent mode cycle", () => {
  test.each([
    [{ agent: "build", permission: "normal" }, { agent: "plan", permission: "normal" }],
    [{ agent: "plan", permission: "normal" }, { agent: "build", permission: "review" }],
    [{ agent: "build", permission: "review" }, { agent: "reviewer", permission: "normal" }],
    [{ agent: "reviewer", permission: "normal" }, { agent: "build", permission: "normal" }],
  ] satisfies Array<[ModeCycleState, ModeCycleState]>)("cycles forward $0 -> $1", (current, expected) => {
    expect(cycleMode({ direction: 1, current, available, autoApprove: true })).toEqual(expected)
  })

  test.each([
    [{ agent: "build", permission: "normal" }, { agent: "reviewer", permission: "normal" }],
    [{ agent: "reviewer", permission: "normal" }, { agent: "build", permission: "review" }],
    [{ agent: "build", permission: "review" }, { agent: "plan", permission: "normal" }],
    [{ agent: "plan", permission: "normal" }, { agent: "build", permission: "normal" }],
  ] satisfies Array<[ModeCycleState, ModeCycleState]>)("cycles backward $0 -> $1", (current, expected) => {
    expect(cycleMode({ direction: -1, current, available, autoApprove: true })).toEqual(expected)
  })

  test("preserves legacy auto while cycling real agents", () => {
    expect(
      cycleMode({ direction: 1, current: { agent: "build", permission: "auto" }, available }),
    ).toEqual({ agent: "plan", permission: "auto" })
    expect(
      cycleMode({ direction: -1, current: { agent: "build", permission: "auto" }, available }),
    ).toEqual({ agent: "reviewer", permission: "auto" })
  })

  test("omits Auto-approve without Build", () => {
    expect(
      cycleMode({
        direction: 1,
        current: { agent: "plan", permission: "normal" },
        available: ["plan", "reviewer"],
        autoApprove: true,
      }),
    ).toEqual({ agent: "reviewer", permission: "normal" })
  })

  test("omits Auto-approve unless the beta flag is enabled", () => {
    for (const autoApprove of [undefined, false]) {
      const ring: ModeCycleState[] = []
      let state: ModeCycleState = { agent: "build", permission: "normal" }
      for (let step = 0; step < available.length; step++) {
        state = cycleMode({ direction: 1, current: state, available, autoApprove })
        ring.push(state)
      }
      expect(ring).toEqual([
        { agent: "plan", permission: "normal" },
        { agent: "reviewer", permission: "normal" },
        { agent: "build", permission: "normal" },
      ])
      expect(ring.some((item) => item.permission === "review")).toBe(false)
    }
  })

  test("leaves review mode when the beta flag is off", () => {
    expect(
      cycleMode({ direction: 1, current: { agent: "build", permission: "review" }, available, autoApprove: false }),
    ).toEqual({ agent: "build", permission: "normal" })
  })

  test("keeps compatible shortcuts and labels", () => {
    expect(Definitions.agent_cycle.default).toBe("tab")
    expect(Definitions.agent_cycle_reverse.default).toBe("shift+tab")
    expect(CommandMap.agent_cycle).toBe("agent.cycle")
    expect(CommandMap.agent_cycle_reverse).toBe("agent.cycle.reverse")
    expect(modeLabel({ agent: "build", permission: "normal" })).toBe("Build")
    expect(modeLabel({ agent: "build", permission: "review" })).toBe("Auto-approve")
    expect(modeLabel({ agent: "reviewer", permission: "normal" })).toBe("reviewer")
  })
})
