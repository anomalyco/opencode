import { describe, expect, test } from "bun:test"
import {
  createPromptHistory,
  isExitCommand,
  isNewCommand,
  movePromptHistory,
  printableBinding,
  promptCycle,
  promptHit,
  promptInfo,
  promptKeys,
  pushPromptHistory,
} from "@/cli/cmd/run/prompt.shared"
import type { RunPrompt } from "@/cli/cmd/run/types"

function bindings(...keys: string[]) {
  return keys.map((key) => ({ key }))
}

const keybinds = {
  leader: "ctrl+x",
  leaderTimeout: 2000,
  commandList: bindings("ctrl+p"),
  variantCycle: bindings("ctrl+t", "<leader>t"),
  interrupt: bindings("escape"),
  historyPrevious: bindings("up"),
  historyNext: bindings("down"),
  inputClear: bindings("ctrl+c"),
  inputSubmit: bindings("return"),
  inputNewline: bindings("shift+return,ctrl+return,alt+return,ctrl+j"),
}

function prompt(text: string, parts: RunPrompt["parts"] = []): RunPrompt {
  return { text, parts }
}

describe("run prompt shared", () => {
  test("filters blank prompts and dedupes consecutive history", () => {
    const out = createPromptHistory([prompt("   "), prompt("one"), prompt("one"), prompt("two"), prompt("one")])

    expect(out.items.map((item) => item.text)).toEqual(["one", "two", "one"])
    expect(out.index).toBeNull()
    expect(out.draft).toBe("")
  })

  test("push ignores blanks and dedupes only the latest item", () => {
    const base = createPromptHistory([prompt("one")])

    expect(pushPromptHistory(base, prompt("   ")).items.map((item) => item.text)).toEqual(["one"])
    expect(pushPromptHistory(base, prompt("one")).items.map((item) => item.text)).toEqual(["one"])
    expect(pushPromptHistory(base, prompt("two")).items.map((item) => item.text)).toEqual(["one", "two"])
  })

  test("moves through history only at input boundaries and restores draft", () => {
    const base = createPromptHistory([prompt("one"), prompt("two")])

    expect(movePromptHistory(base, -1, "draft", 1)).toEqual({
      state: base,
      apply: false,
    })

    const up = movePromptHistory(base, -1, "draft", 0)
    expect(up.apply).toBe(true)
    expect(up.text).toBe("two")
    expect(up.cursor).toBe(0)
    expect(up.state.index).toBe(1)
    expect(up.state.draft).toBe("draft")

    const older = movePromptHistory(up.state, -1, "two", 0)
    expect(older.apply).toBe(true)
    expect(older.text).toBe("one")
    expect(older.cursor).toBe(0)
    expect(older.state.index).toBe(0)

    const newer = movePromptHistory(older.state, 1, "one", 3)
    expect(newer.apply).toBe(true)
    expect(newer.text).toBe("two")
    expect(newer.cursor).toBe(3)
    expect(newer.state.index).toBe(1)

    const draft = movePromptHistory(newer.state, 1, "two", 3)
    expect(draft.apply).toBe(true)
    expect(draft.text).toBe("draft")
    expect(draft.cursor).toBe(5)
    expect(draft.state.index).toBeNull()
  })

  test("handles direct and leader-based variant cycling", () => {
    const keys = promptKeys(keybinds)

    expect(promptHit(keys.clear, promptInfo({ name: "c", ctrl: true }))).toBe(true)

    expect(promptCycle(false, promptInfo({ name: "x", ctrl: true }), keys.leaders, keys.cycles)).toEqual({
      arm: true,
      clear: false,
      cycle: false,
      consume: true,
    })

    expect(promptCycle(true, promptInfo({ name: "t" }), keys.leaders, keys.cycles)).toEqual({
      arm: false,
      clear: true,
      cycle: true,
      consume: true,
    })

    expect(promptCycle(false, promptInfo({ name: "t", ctrl: true }), keys.leaders, keys.cycles)).toEqual({
      arm: false,
      clear: false,
      cycle: true,
      consume: true,
    })
  })

  test("prints bindings with leader substitution and esc normalization", () => {
    expect(printableBinding(keybinds.variantCycle.slice(1), "ctrl+x")).toBe("ctrl+x t")
    expect(printableBinding(keybinds.interrupt, "ctrl+x")).toBe("esc")
    expect(printableBinding([], "ctrl+x")).toBe("")
  })

  test("recognizes exit commands", () => {
    expect(isExitCommand("/exit")).toBe(true)
    expect(isExitCommand(" /Quit ")).toBe(true)
    expect(isExitCommand("/quit now")).toBe(false)
  })

  test("recognizes the new-session command", () => {
    expect(isNewCommand("/new")).toBe(true)
    expect(isNewCommand(" /NEW ")).toBe(true)
    expect(isNewCommand("/new now")).toBe(false)
  })
})
