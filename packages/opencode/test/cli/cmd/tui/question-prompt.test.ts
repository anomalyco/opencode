import { describe, expect, test } from "bun:test"
import { questionPromptTabState } from "@/cli/cmd/tui/routes/session/question"

describe("tui question prompt", () => {
  test("clears stale answer editing when moving to another tab", () => {
    expect(questionPromptTabState({ current: 0, next: 2, editing: true })).toEqual({
      tab: 2,
      selected: 0,
      editing: false,
    })
  })

  test("keeps answer editing when reselecting the current tab", () => {
    expect(questionPromptTabState({ current: 0, next: 0, editing: true })).toEqual({
      tab: 0,
      selected: 0,
      editing: true,
    })
  })
})
