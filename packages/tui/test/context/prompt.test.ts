import { describe, expect, test } from "bun:test"
import type { TuiPromptRef } from "@opencode-ai/plugin/tui"
import { canStashPromptForSessions } from "../../src/context/prompt"

const legacyPromptRef = {
  focused: true,
  current: { input: "keep this draft", parts: [] },
  set() {},
  reset() {},
  blur() {},
  focus() {},
  submit() {},
} satisfies TuiPromptRef

describe("prompt ref capabilities", () => {
  test("keeps legacy replacement prompts compatible without draft-stash capabilities", () => {
    expect(canStashPromptForSessions(legacyPromptRef)).toBe(false)
  })

  test("enables session navigation only when both draft-stash capabilities are available", () => {
    expect(
      canStashPromptForSessions({
        ...legacyPromptRef,
        cursorAtStart: true,
        stashAndClear: () => "armed",
      }),
    ).toBe(true)
    expect(
      canStashPromptForSessions({
        ...legacyPromptRef,
        cursorAtStart: false,
        stashAndClear: () => "armed",
      }),
    ).toBe(false)
  })
})
