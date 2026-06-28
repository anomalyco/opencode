import { describe, expect, test } from "bun:test"
import { findSessionSearchMatches, nextSessionSearchIndex, sessionSearchPreview } from "../../src/util/session-search"

describe("session search", () => {
  test("finds text matches across user and assistant messages", () => {
    const matches = findSessionSearchMatches(
      [
        { id: "msg_user", role: "user" },
        { id: "msg_assistant", role: "assistant" },
      ],
      {
        msg_user: [{ type: "text", text: "Where is the formatter?" }],
        msg_assistant: [{ type: "text", text: "The formatter lives in packages/tui." }],
      },
      "FORMATTER",
    )

    expect(matches.map((match) => match.messageID)).toEqual(["msg_user", "msg_assistant"])
  })

  test("ignores synthetic, ignored, empty, and non-text parts", () => {
    const matches = findSessionSearchMatches(
      [{ id: "msg_1", role: "assistant" }],
      {
        msg_1: [
          { type: "text", text: "needle", synthetic: true },
          { type: "text", text: "needle", ignored: true },
          { type: "text", text: "  " },
          { type: "reasoning", text: "needle" },
        ],
      },
      "needle",
    )

    expect(matches).toEqual([])
  })

  test("wraps next and previous indexes", () => {
    expect(nextSessionSearchIndex(3, 2, "next")).toBe(0)
    expect(nextSessionSearchIndex(3, 0, "previous")).toBe(2)
    expect(nextSessionSearchIndex(0, 0, "next")).toBe(-1)
  })

  test("builds a compact preview around the match", () => {
    const preview = sessionSearchPreview("alpha beta gamma delta epsilon zeta eta theta", "epsilon", 24)

    expect(preview).toContain("epsilon")
    expect(preview.length).toBeLessThanOrEqual(30)
  })
})
