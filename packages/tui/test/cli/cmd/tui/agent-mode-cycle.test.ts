import { describe, expect, test } from "bun:test"
import { Definitions, CommandMap } from "../../../../src/config/keybind"
import {
  cycleMode,
  disableAutoMode,
  enableAutoMode,
  modeLabel,
  paletteModeTitle,
  realAgentMode,
  startupMode,
  startupPermissionMode,
  type ModeCycleState,
} from "../../../../src/mode-cycle"

const standard = ["build", "plan"]

describe("canonical mode ring", () => {
  test.each([
    [
      { agent: "build", permission: "normal" },
      { agent: "plan", permission: "normal" },
    ],
    [
      { agent: "plan", permission: "normal" },
      { agent: "build", permission: "auto" },
    ],
    [
      { agent: "build", permission: "auto" },
      { agent: "build", permission: "normal" },
    ],
  ] satisfies Array<[ModeCycleState, ModeCycleState]>)("forward $0 -> $1", (current, expected) => {
    expect(cycleMode({ direction: 1, current, available: standard })).toEqual(expected)
  })

  test.each([
    [
      { agent: "build", permission: "normal" },
      { agent: "build", permission: "auto" },
    ],
    [
      { agent: "build", permission: "auto" },
      { agent: "plan", permission: "normal" },
    ],
    [
      { agent: "plan", permission: "normal" },
      { agent: "build", permission: "normal" },
    ],
  ] satisfies Array<[ModeCycleState, ModeCycleState]>)("reverse $0 -> $1", (current, expected) => {
    expect(cycleMode({ direction: -1, current, available: standard })).toEqual(expected)
  })

  test("keeps Tab and Shift+Tab on the compatible command identifiers", () => {
    expect(Definitions.agent_cycle.default).toBe("tab")
    expect(Definitions.agent_cycle_reverse.default).toBe("shift+tab")
    expect(Definitions.agent_cycle.description).toBe("Next mode: Build, Plan, Auto-approve")
    expect(Definitions.agent_cycle_reverse.description).toBe("Previous mode: Build, Auto-approve, Plan")
    expect(CommandMap.agent_cycle).toBe("agent.cycle")
    expect(CommandMap.agent_cycle_reverse).toBe("agent.cycle.reverse")
  })
})

describe("configured and unavailable agents", () => {
  test.each([
    [1, { agent: "build", permission: "normal" }],
    [-1, { agent: "build", permission: "auto" }],
  ] satisfies Array<[1 | -1, ModeCycleState]>)("excludes a custom agent for direction $0", (direction, expected) => {
    expect(
      cycleMode({
        direction,
        current: { agent: "review", permission: "normal" },
        available: ["review", "build", "plan"],
      }),
    ).toEqual(expected)
  })

  test.each([
    ["missing Build forward", 1, ["review", "plan"], { agent: "plan", permission: "normal" }],
    ["missing Build reverse", -1, ["review", "plan"], { agent: "plan", permission: "normal" }],
    ["missing Plan forward", 1, ["review", "build"], { agent: "build", permission: "normal" }],
    ["missing Plan reverse", -1, ["review", "build"], { agent: "build", permission: "auto" }],
    ["neither canonical forward", 1, ["review"], { agent: "review", permission: "normal" }],
    ["neither canonical reverse", -1, ["review"], { agent: "review", permission: "normal" }],
  ] satisfies Array<[string, 1 | -1, string[], ModeCycleState]>)("%s", (_name, direction, available, expected) => {
    expect(cycleMode({ direction, current: { agent: "review", permission: "normal" }, available })).toEqual(expected)
  })

  test("real picker and plan transitions always leave the virtual state", () => {
    for (const agent of ["build", "plan", "review"])
      expect(realAgentMode(agent)).toEqual({ agent, permission: "normal" })
  })
})

describe("startup, palette, and labels", () => {
  test.each([
    ["plain auto", { auto: true }, { agent: "build", permission: "auto" }],
    ["auto Build", { auto: true, agent: "build" }, { agent: "build", permission: "auto" }],
    ["auto Plan", { auto: true, agent: "plan" }, { agent: "plan", permission: "normal" }],
    ["auto custom", { auto: true, agent: "review" }, { agent: "review", permission: "normal" }],
    ["plain Build", { agent: "build" }, { agent: "build", permission: "normal" }],
  ] satisfies Array<[string, { auto?: boolean; agent?: string }, ModeCycleState]>)("%s", (_name, args, expected) => {
    expect(startupMode({ ...args, current: "review", available: ["review", ...standard] })).toEqual(expected)
    expect(startupPermissionMode(args)).toBe(expected.permission)
  })

  test("does not construct startup auto mode without Build", () => {
    expect(startupMode({ auto: true, current: "review", available: ["review", "plan"] })).toEqual({
      agent: "review",
      permission: "normal",
    })
    expect(startupMode({ auto: true, agent: "build", current: "review", available: ["review", "plan"] })).toEqual({
      agent: "review",
      permission: "normal",
    })
  })

  test.each([
    ["build", standard],
    ["plan", standard],
    ["review", ["review", ...standard]],
  ])("palette enables Build-backed auto from %s", (current, available) => {
    expect(enableAutoMode(current, available)).toEqual({ agent: "build", permission: "auto" })
  })

  test("palette disables Auto-approve to Build normal", () => {
    expect(disableAutoMode("build", standard)).toEqual({ agent: "build", permission: "normal" })
    expect(paletteModeTitle("normal")).toBe("Enable auto-approve mode")
    expect(paletteModeTitle("auto")).toBe("Disable auto-approve mode")
  })

  test.each([
    [{ agent: "build", permission: "normal" }, "Build"],
    [{ agent: "plan", permission: "normal" }, "Plan"],
    [{ agent: "build", permission: "auto" }, "Auto-approve"],
  ] satisfies Array<[ModeCycleState, string]>)("labels $1 exactly", (state, expected) => {
    expect(modeLabel(state)).toBe(expected)
  })
})
