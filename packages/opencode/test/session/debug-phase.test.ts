import { describe, expect, test } from "bun:test"
import { DebugPhase } from "../../src/session/debug-phase"

describe("DebugPhase.create", () => {
  test("returns PLANNING phase, step 0, null totalSteps, false autoConfirm", () => {
    const state = DebugPhase.create("test-session-1")
    expect(state.sessionID).toBe("test-session-1")
    expect(state.currentPhase).toBe("PLANNING")
    expect(state.currentStep).toBe(0)
    expect(state.totalSteps).toBeNull()
    expect(state.autoConfirm).toBe(false)
    expect(state.stepDescriptions).toEqual([])
  })
})

describe("DebugPhase.transition", () => {
  test("valid transitions: PLANNING->CODING, CODING->BREAKPOINTING", () => {
    const state = DebugPhase.create("test-transition-1")
    const afterCoding = DebugPhase.transition(state, "CODING")
    expect(afterCoding.currentPhase).toBe("CODING")

    const afterBreakpointing = DebugPhase.transition(afterCoding, "BREAKPOINTING")
    expect(afterBreakpointing.currentPhase).toBe("BREAKPOINTING")
  })

  test("full cycle back to PLANNING", () => {
    let state = DebugPhase.create("test-cycle-1")
    state = DebugPhase.transition(state, "CODING")
    state = DebugPhase.transition(state, "BREAKPOINTING")
    state = DebugPhase.transition(state, "DEBUGGING")
    state = DebugPhase.transition(state, "EXPLAINING")
    state = DebugPhase.transition(state, "CONFIRMING")
    state = DebugPhase.transition(state, "PLANNING")
    expect(state.currentPhase).toBe("PLANNING")
  })

  test("step increments on CONFIRMING->PLANNING", () => {
    let state = DebugPhase.create("test-step-inc")
    expect(state.currentStep).toBe(0)

    state = DebugPhase.transition(state, "CODING")
    state = DebugPhase.transition(state, "BREAKPOINTING")
    state = DebugPhase.transition(state, "DEBUGGING")
    state = DebugPhase.transition(state, "EXPLAINING")
    state = DebugPhase.transition(state, "CONFIRMING")
    expect(state.currentStep).toBe(0)

    state = DebugPhase.transition(state, "PLANNING")
    expect(state.currentStep).toBe(1)
  })

  test("invalid transitions throw with descriptive message", () => {
    const state = DebugPhase.create("test-invalid")
    expect(() => DebugPhase.transition(state, "DEBUGGING")).toThrow(
      /cannot transition from PLANNING to DEBUGGING/i,
    )
    expect(() => DebugPhase.transition(state, "EXPLAINING")).toThrow(
      /cannot transition from PLANNING to EXPLAINING/i,
    )
  })
})

describe("DebugPhase.toolsForPhase", () => {
  test("returns correct tools for each phase", () => {
    expect(DebugPhase.toolsForPhase("PLANNING")).toEqual([
      "read",
      "glob",
      "grep",
      "task",
      "transitionPhase",
    ])
    expect(DebugPhase.toolsForPhase("CODING")).toEqual([
      "read",
      "glob",
      "grep",
      "edit",
      "write",
      "bash",
      "apply_patch",
      "transitionPhase",
    ])
    expect(DebugPhase.toolsForPhase("BREAKPOINTING")).toEqual([
      "debugger_set_breakpoints",
      "debugger_remove_breakpoints",
      "debugger_list_breakpoints",
      "read",
      "transitionPhase",
    ])
    expect(DebugPhase.toolsForPhase("DEBUGGING")).toEqual([
      "debugger_start_debug_session",
      "debugger_continue_execution",
      "debugger_step_over",
      "debugger_step_into",
      "debugger_step_out",
      "debugger_get_variables",
      "debugger_get_call_stack",
      "debugger_evaluate_expression",
      "debugger_list_breakpoints",
      "transitionPhase",
    ])
    expect(DebugPhase.toolsForPhase("EXPLAINING")).toEqual(["transitionPhase"])
    expect(DebugPhase.toolsForPhase("CONFIRMING")).toEqual([
      "debugger_stop_debug_session",
      "transitionPhase",
    ])
  })
})

describe("DebugPhase.isDebugAgent", () => {
  test("returns true for 'debug', false for others", () => {
    expect(DebugPhase.isDebugAgent("debug")).toBe(true)
    expect(DebugPhase.isDebugAgent("coder")).toBe(false)
    expect(DebugPhase.isDebugAgent("Debug")).toBe(false)
    expect(DebugPhase.isDebugAgent("")).toBe(false)
  })
})

describe("DebugPhase.isToolAllowed", () => {
  test("returns correct boolean", () => {
    expect(DebugPhase.isToolAllowed("PLANNING", "read")).toBe(true)
    expect(DebugPhase.isToolAllowed("PLANNING", "edit")).toBe(false)
    expect(DebugPhase.isToolAllowed("CODING", "edit")).toBe(true)
    expect(DebugPhase.isToolAllowed("CODING", "debugger_start_debug_session")).toBe(false)
    expect(DebugPhase.isToolAllowed("DEBUGGING", "debugger_step_over")).toBe(true)
    expect(DebugPhase.isToolAllowed("EXPLAINING", "transitionPhase")).toBe(true)
    expect(DebugPhase.isToolAllowed("EXPLAINING", "read")).toBe(false)
  })
})

describe("DebugPhase storage functions", () => {
  test("get returns undefined for unknown session", () => {
    expect(DebugPhase.get("nonexistent-session")).toBeUndefined()
  })

  test("getOrCreate returns existing or creates new", () => {
    const id = "test-get-or-create"
    DebugPhase.clear(id)
    const state1 = DebugPhase.getOrCreate(id)
    expect(state1.currentPhase).toBe("PLANNING")

    const transitioned = DebugPhase.transition(state1, "CODING")
    const state2 = DebugPhase.getOrCreate(id)
    expect(state2.currentPhase).toBe("CODING")
  })

  test("clear removes state", () => {
    const id = "test-clear"
    DebugPhase.create(id)
    expect(DebugPhase.get(id)).toBeDefined()
    DebugPhase.clear(id)
    expect(DebugPhase.get(id)).toBeUndefined()
  })

  test("setAutoConfirm toggles auto-confirm", () => {
    const id = "test-auto-confirm"
    DebugPhase.create(id)
    expect(DebugPhase.get(id)!.autoConfirm).toBe(false)

    DebugPhase.setAutoConfirm(id, true)
    expect(DebugPhase.get(id)!.autoConfirm).toBe(true)

    DebugPhase.setAutoConfirm(id, false)
    expect(DebugPhase.get(id)!.autoConfirm).toBe(false)
  })
})
