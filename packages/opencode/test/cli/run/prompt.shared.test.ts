import { describe, expect, test } from "bun:test"
import {
  createPromptHistory,
  displayCharAt,
  displaySlice,
  isExitCommand,
  isNewCommand,
  mentionTriggerIndex,
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

  test("uses display-width cursors for history restoration", () => {
    const base = createPromptHistory([prompt("one"), prompt("中文")])

    const latest = movePromptHistory(base, -1, "草稿", 0)
    expect(latest.apply).toBe(true)
    expect(latest.text).toBe("中文")
    expect(latest.cursor).toBe(0)

    const older = movePromptHistory(latest.state, -1, "中文", 0)
    expect(older.apply).toBe(true)
    expect(older.text).toBe("one")
    expect(older.cursor).toBe(0)

    const newer = movePromptHistory(older.state, 1, "one", Bun.stringWidth("one"))
    expect(newer.apply).toBe(true)
    expect(newer.text).toBe("中文")
    expect(newer.cursor).toBe(Bun.stringWidth("中文"))

    const draft = movePromptHistory(newer.state, 1, "中文", Bun.stringWidth("中文"))
    expect(draft.apply).toBe(true)
    expect(draft.text).toBe("草稿")
    expect(draft.cursor).toBe(Bun.stringWidth("草稿"))
  })

  test("uses display-width offsets for mention helpers", () => {
    expect(mentionTriggerIndex("@")).toBe(0)
    expect(mentionTriggerIndex("test @")).toBe(5)
    expect(mentionTriggerIndex("中文 @")).toBe(5)
    expect(mentionTriggerIndex("こんにちは @")).toBe(11)
    expect(mentionTriggerIndex("한국어 @")).toBe(7)
    expect(mentionTriggerIndex("🙂 @")).toBe(3)
    expect(mentionTriggerIndex("中文 @src file", Bun.stringWidth("中文 @src"))).toBe(5)
    expect(displayCharAt("中文 @src", Bun.stringWidth("中文 @"))).toBe("s")
    expect(displaySlice("中文 @src", 5, Bun.stringWidth("中文 @src"))).toBe("@src")
    expect(displaySlice("中文 @src", 6, Bun.stringWidth("中文 @src"))).toBe("src")
    expect(mentionTriggerIndex("👨‍👩‍👧‍👦 @src", Bun.stringWidth("👨‍👩‍👧‍👦 @src"))).toBe(3)
    expect(displayCharAt("👨‍👩‍👧‍👦 @src", Bun.stringWidth("👨‍👩‍👧‍👦 @"))).toBe("s")
    expect(displaySlice("👨‍👩‍👧‍👦 @src", 3, Bun.stringWidth("👨‍👩‍👧‍👦 @src"))).toBe("@src")
    expect(mentionTriggerIndex("中文@")).toBeUndefined()
    expect(mentionTriggerIndex("こんにちは@")).toBeUndefined()
    expect(mentionTriggerIndex("한국어@")).toBeUndefined()
    expect(mentionTriggerIndex("🙂@")).toBeUndefined()
    expect(mentionTriggerIndex("hello@")).toBeUndefined()
    expect(mentionTriggerIndex("foo@bar.com")).toBeUndefined()
    expect(mentionTriggerIndex("中文 @src file")).toBeUndefined()
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
