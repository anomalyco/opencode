import { describe, test, expect, beforeEach } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { Keybind } from "../../../../src/util"
import { shouldUseShellCompletion } from "../../../../plugin/tui-integration/hooks"
import { ExecutionMode, getModeController } from "../../../../plugin/shell-mode"

// ── Shift+Tab cycles agents; Tab triggers shell autocomplete — LAC-163 regression ──
//
// Regression for LAC-163: Shift+Tab must cycle agents; plain Tab must trigger
// shell autocomplete. These keybinds must never collide.
//
// Invariants:
//   • agent_cycle            = "shift+tab"  (schema default)
//   • agent_cycle_reverse    = "none"       (disabled)
//   • Kitty shift+tab event  → matches agent_cycle binding → agent cycles forward
//   • Kitty plain tab event  → does NOT match agent_cycle → reaches shell completion
//   • prompt onKeyDown guard `!e.shift` prevents shift+tab from entering the
//     shell completion branch before the agent_cycle command handler fires

const KEYBINDS_SRC = readFileSync(
  join(import.meta.dir, "../../../../src/config/keybinds.ts"),
  "utf-8",
)

const PROMPT_SRC = readFileSync(
  join(import.meta.dir, "../../../../src/cli/cmd/tui/component/prompt/index.tsx"),
  "utf-8",
)

// ── Schema defaults ─────────────────────────────────────────────────────────

describe("keybind schema defaults", () => {
  test('agent_cycle default binding is "shift+tab"', () => {
    // If this changes, Shift+Tab will stop cycling agents — breaking the invariant.
    expect(KEYBINDS_SRC).toContain('agent_cycle: keybind("shift+tab"')
  })

  test('agent_cycle_reverse default binding is "none"', () => {
    // agent_cycle_reverse is intentionally disabled; a non-"none" value would
    // assign an unexpected key to reverse-cycle agents.
    expect(KEYBINDS_SRC).toContain('agent_cycle_reverse: keybind("none"')
  })
})

// ── Keybind.parse: shift+tab ────────────────────────────────────────────────

describe("Keybind.parse — shift+tab", () => {
  test('"shift+tab" parses to a single binding with shift=true, name="tab"', () => {
    const result = Keybind.parse("shift+tab")
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      shift: true,
      name: "tab",
      ctrl: false,
      meta: false,
      leader: false,
    })
  })

  test('"none" parses to an empty array (agent_cycle_reverse is disabled)', () => {
    // Keybind.parse("none") returns [] — no binding, no match, never fires.
    expect(Keybind.parse("none")).toEqual([])
  })

  test('"tab" (no modifiers) parses to shift=false, name="tab"', () => {
    const result = Keybind.parse("tab")
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      shift: false,
      name: "tab",
      ctrl: false,
      meta: false,
      leader: false,
    })
  })
})

// ── Keybind.match: shift+tab vs tab disambiguation ──────────────────────────

describe("Keybind.match — shift+tab matches agent_cycle, plain tab does not", () => {
  const agentCycleBinding = Keybind.parse("shift+tab")[0]!

  // Kitty protocol sends name="tab" with shift=true for Shift+Tab.
  const kittyShiftTab: Keybind.Info = {
    name: "tab",
    shift: true,
    ctrl: false,
    meta: false,
    leader: false,
  }

  // Kitty protocol sends name="tab" with shift=false for plain Tab.
  const kittyTab: Keybind.Info = {
    name: "tab",
    shift: false,
    ctrl: false,
    meta: false,
    leader: false,
  }

  test("Kitty shift+tab event matches the agent_cycle binding", () => {
    expect(Keybind.match(agentCycleBinding, kittyShiftTab)).toBe(true)
  })

  test("Kitty plain tab event does NOT match the agent_cycle binding", () => {
    // Plain Tab must never cycle agents — it belongs to shell autocomplete.
    expect(Keybind.match(agentCycleBinding, kittyTab)).toBe(false)
  })

  test("shift+tab does NOT match a plain tab binding (reverse check)", () => {
    // Ensures the shift flag is respected in both directions.
    const plainTabBinding = Keybind.parse("tab")[0]!
    expect(Keybind.match(plainTabBinding, kittyShiftTab)).toBe(false)
  })

  test("shift+tab matches shift+tab binding (self-consistency)", () => {
    expect(Keybind.match(agentCycleBinding, kittyShiftTab)).toBe(true)
  })
})

// ── Prompt onKeyDown: shell completion guard excludes shift+tab ─────────────

describe("prompt onKeyDown tab guard — LAC-163 regression", () => {
  test('guard includes !e.shift so shift+tab is excluded from shell completion', () => {
    // The shell completion branch in prompt/index.tsx:
    //   if (e.name === "tab" && !e.shift && !e.ctrl && !e.meta && ...)
    //
    // The `!e.shift` predicate is what stops shift+tab from entering this
    // branch. Without it, shift+tab would be consumed by shell completion and
    // never reach the agent_cycle global keyboard handler in app.tsx.
    expect(PROMPT_SRC).toContain('e.name === "tab" && !e.shift')
  })

  test('guard also excludes ctrl and meta so only bare Tab reaches shell completion', () => {
    expect(PROMPT_SRC).toContain('!e.ctrl && !e.meta')
  })
})

// ── shouldUseShellCompletion: Tab routing gate ──────────────────────────────

describe("shouldUseShellCompletion — Tab triggers completion, Shift+Tab does not", () => {
  beforeEach(() => {
    getModeController().setMode(ExecutionMode.Auto)
  })

  test("shell promptMode → completion regardless of executionMode (Agent)", () => {
    // ! prefix shell mode always uses Tab for completion.
    expect(shouldUseShellCompletion("shell", ExecutionMode.Agent)).toBe(true)
  })

  test("shell promptMode → completion regardless of executionMode (Auto)", () => {
    expect(shouldUseShellCompletion("shell", ExecutionMode.Auto)).toBe(true)
  })

  test("shell promptMode → completion regardless of executionMode (Shell)", () => {
    expect(shouldUseShellCompletion("shell", ExecutionMode.Shell)).toBe(true)
  })

  test("normal promptMode + Agent executionMode → NO shell completion", () => {
    // In Agent execution mode, Tab should not trigger shell completion;
    // the guard returns false so the event propagates for other handlers.
    expect(shouldUseShellCompletion("normal", ExecutionMode.Agent)).toBe(false)
  })

  test("normal promptMode + Shell executionMode → shell completion", () => {
    expect(shouldUseShellCompletion("normal", ExecutionMode.Shell)).toBe(true)
  })

  test("normal promptMode + Auto executionMode → shell completion", () => {
    expect(shouldUseShellCompletion("normal", ExecutionMode.Auto)).toBe(true)
  })
})
