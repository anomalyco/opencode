import { describe, expect, test } from "bun:test"
import { promptHistoryBadgeLabel, resolvePromptFooterState } from "../../src/prompt/footer"

const historyBadge = {
  input: "remember this",
  scope: "current" as const,
  origin: "stash" as const,
}

describe("prompt footer", () => {
  test("uses a neutral label for legacy history", () => {
    expect(promptHistoryBadgeLabel("history")).toBe("history")
    expect(promptHistoryBadgeLabel("current")).toBe("this session")
    expect(promptHistoryBadgeLabel("other")).toBe("other session")
  })

  test("keeps the left confirmation visible while a session is busy", () => {
    expect(resolvePromptFooterState({ status: "busy", stashArm: "left", historyBadge })).toEqual({
      type: "busy",
      notice: { type: "stash", gesture: "left" },
    })
  })

  test("keeps the history badge visible while a session is retrying", () => {
    expect(resolvePromptFooterState({ status: "retry", stashArm: null, historyBadge })).toEqual({
      type: "busy",
      notice: { type: "history", badge: historyBadge },
    })
  })

  test("gives the confirmation gesture priority over history while idle", () => {
    expect(resolvePromptFooterState({ status: "idle", stashArm: "esc", historyBadge })).toEqual({
      type: "stash",
      gesture: "esc",
    })
  })
})
