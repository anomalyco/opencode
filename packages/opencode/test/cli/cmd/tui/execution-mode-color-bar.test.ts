import { describe, expect, test, beforeEach } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { getModeDisplay, getModeController, ExecutionMode } from "@shell-mode"

// ── Execution mode color bar — LAC-163 regression ────────────────────────────
//
// Regression for LAC-163: the prompt component uses a row-layout double border
// to show agent color (outer) + execution mode color (inner). Nested border
// boxes cause a 1–2 row height mismatch; row layout is the load-bearing fix.
//
// Structure under test (prompt/index.tsx):
//
//   <box border={["left"]} borderColor={borderHighlight()} customBorderChars={{...bottomLeft:"╹"}}>
//     <box flexDirection="row">
//       <box width={1} alignSelf="stretch" border={["left"]} borderColor={modePrefixColor()} />
//       <box ...>{/* textarea + footer */}</box>
//     </box>
//   </box>

const PROMPT_SRC = readFileSync(
  join(import.meta.dir, "../../../../src/cli/cmd/tui/component/prompt/index.tsx"),
  "utf-8",
)

describe("execution mode color bar — LAC-163 regression", () => {
  // ── Outer border structure ────────────────────────────────────────────────

  test('outer box declares border={["left"]} on the prompt wrapper', () => {
    // The outer bar must be a left-only border; any other pattern changes the
    // visual shape or adds unwanted right-side chrome.
    expect(PROMPT_SRC).toContain('border={["left"]}')
  })

  test('outer box customBorderChars includes bottomLeft: "╹" connector', () => {
    // The ╹ character visually connects the left border to the row below.
    // Losing it makes the border look disconnected at the bottom join.
    expect(PROMPT_SRC).toContain('bottomLeft: "╹"')
  })

  // ── Inner bar row layout (the fix for height mismatch) ───────────────────

  test("inner bar uses width={1} in a row-layout container — not a nested border box", () => {
    // ROW LAYOUT INVARIANT: the mode color bar must be width={1} in a
    // flexDirection="row" wrapper. Nested border={["left"]} boxes cause the
    // inner bar to be 1–2 rows shorter than the outer (Yoga sizes them
    // independently). width={1}+alignSelf="stretch" in a row container forces
    // identical height for both bars.
    expect(PROMPT_SRC).toContain("width={1}")
  })

  test('inner bar uses alignSelf="stretch" so it spans the full row height', () => {
    // alignSelf="stretch" is what guarantees the inner bar reaches top and
    // bottom of the outer bar without a visible gap.
    expect(PROMPT_SRC).toContain('alignSelf="stretch"')
  })

  test('row container uses flexDirection="row" to co-size bar and content', () => {
    // flexDirection="row" places the inner bar and textarea side by side.
    // Both children are sized by the same row flex pass, so stretch works.
    expect(PROMPT_SRC).toContain('flexDirection="row"')
  })

  test("inner bar borderColor reads modePrefixColor() reactive memo", () => {
    // The inner bar must reference the reactive modePrefixColor() — not a
    // static color literal — so that mode switches immediately update the bar.
    expect(PROMPT_SRC).toContain("borderColor={modePrefixColor()}")
  })

  // ── modePrefixColor mapping: getModeDisplay().color → theme key ───────────
  //
  // modePrefixColor() in the component does: theme[getModeDisplay().color]
  // These tests verify the color field per mode resolves to the expected key.

  test("Shell mode maps to 'success' theme color", () => {
    const display = getModeDisplay(ExecutionMode.Shell)
    expect(display.color).toBe("success")
  })

  test("Agent mode maps to 'accent' theme color", () => {
    const display = getModeDisplay(ExecutionMode.Agent)
    expect(display.color).toBe("accent")
  })

  test("Auto mode maps to 'diffAdded' theme color", () => {
    const display = getModeDisplay(ExecutionMode.Auto)
    expect(display.color).toBe("diffAdded")
  })

  test("all three modes produce distinct color keys", () => {
    const colors = [ExecutionMode.Shell, ExecutionMode.Agent, ExecutionMode.Auto].map(
      (m) => getModeDisplay(m).color,
    )
    expect(new Set(colors).size).toBe(3)
  })

  // ── Mode controller reactivity ────────────────────────────────────────────
  //
  // Switching modes must update getModeDisplay().color so the reactive memo
  // in the component reads the new value on the next render pass.

  describe("getModeController reflects setMode changes", () => {
    const controller = getModeController()

    beforeEach(() => {
      controller.setMode(ExecutionMode.Auto)
    })

    test("switching to Shell mode yields 'success' color", () => {
      controller.setMode(ExecutionMode.Shell)
      expect(controller.getModeDisplay().color).toBe("success")
    })

    test("switching to Agent mode yields 'accent' color", () => {
      controller.setMode(ExecutionMode.Agent)
      expect(controller.getModeDisplay().color).toBe("accent")
    })

    test("switching to Auto mode yields 'diffAdded' color", () => {
      controller.setMode(ExecutionMode.Auto)
      expect(controller.getModeDisplay().color).toBe("diffAdded")
    })

    test("cycling through all modes returns to Auto color", () => {
      controller.setMode(ExecutionMode.Auto)
      controller.toggleMode() // Auto → Shell
      controller.toggleMode() // Shell → Agent
      controller.toggleMode() // Agent → Auto
      expect(controller.getModeDisplay().color).toBe("diffAdded")
    })
  })
})
