import { describe, expect, test } from "bun:test"
import { containsClearScrollbackSequence, extractContentAfterClear } from "./escape-filter"

describe("escape filter", () => {
  test("ed3_clears_scrollback_tail", () => {
    const data = `before\u001b[3Jafter`
    expect(containsClearScrollbackSequence(data)).toBe(true)
    expect(extractContentAfterClear(data)).toBe("after")
  })

  test("ris_does_not_clear_scrollback", () => {
    const data = `before\u001bcafter`
    expect(containsClearScrollbackSequence(data)).toBe(false)
    expect(extractContentAfterClear(data)).toBe(data)
  })

  test("ed3_last_wins_with_multiple_clears", () => {
    const data = `a\u001b[3Jb\u001b[3Jc`
    expect(containsClearScrollbackSequence(data)).toBe(true)
    expect(extractContentAfterClear(data)).toBe("c")
  })

  test("ed3_preserves_ansi_unicode_and_newlines_after_clear", () => {
    const data = `old\u001b[3J\u001b[32mgreen\u001b[0m\nline-two`
    expect(extractContentAfterClear(data)).toBe("\u001b[32mgreen\u001b[0m\nline-two")
  })

  test("non_ed3_escape_sequences_do_not_trigger_clear", () => {
    expect(containsClearScrollbackSequence("\u001b[2J")).toBe(false)
    expect(containsClearScrollbackSequence("\u001b[H")).toBe(false)
    expect(containsClearScrollbackSequence("\u001b[3mtext")).toBe(false)
    expect(extractContentAfterClear("\u001b[3mtext")).toBe("\u001b[3mtext")
  })
})
