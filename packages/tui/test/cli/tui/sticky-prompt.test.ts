import { describe, expect, test } from "bun:test"
import {
  findStickyUserMessage,
  getStickyPromptTextWidth,
  getStickyPromptGeometry,
  getStickyPromptScrollDelta,
  truncateStickyPrompt,
  getStickyUserMessageText,
  hasEligibleUserText,
  getStickyPromptHeight,
} from "../../../src/routes/session/sticky-prompt"

describe("hasEligibleUserText", () => {
  test("accepts a user message with visible text", () => {
    expect(hasEligibleUserText({ role: "user" }, [{ type: "text", text: "hello" }])).toBe(true)
  })

  test("rejects synthetic text", () => {
    expect(hasEligibleUserText({ role: "user" }, [{ type: "text", text: "hello", synthetic: true }])).toBe(false)
  })

  test("rejects ignored text", () => {
    expect(hasEligibleUserText({ role: "user" }, [{ type: "text", text: "hello", ignored: true }])).toBe(false)
  })

  test("rejects non-user messages", () => {
    expect(hasEligibleUserText({ role: "assistant" }, [{ type: "text", text: "hello" }])).toBe(false)
  })
})

describe("getStickyUserMessageText", () => {
  test("joins visible user text parts into one line", () => {
    expect(
      getStickyUserMessageText([
        { type: "text", text: "first\nline" },
        { type: "text", text: "ignored", ignored: true },
        { type: "text", text: "second", synthetic: true },
        { type: "text", text: "third" },
      ]),
    ).toBe("first line third")
  })
})

describe("getStickyPromptTextWidth", () => {
  test("uses the rendered content box instead of the parent width", () => {
    expect(getStickyPromptTextWidth(40, 2, 1)).toBe(37)
    expect(getStickyPromptTextWidth(2, 2, 1)).toBe(1)
  })

  test("reserves a safety width before the right edge", () => {
    expect(getStickyPromptTextWidth(40, 2, 1, 2)).toBe(35)
    expect(getStickyPromptTextWidth(4, 2, 1, 2)).toBe(1)
  })
})

describe("getStickyPromptHeight", () => {
  test("uses the measured height when available", () => {
    expect(getStickyPromptHeight(7, false)).toBe(7)
  })

  test("falls back to the rendered line count before measurement", () => {
    expect(getStickyPromptHeight(undefined, false)).toBe(3)
    expect(getStickyPromptHeight(undefined, true)).toBe(4)
  })
})

describe("getStickyPromptGeometry", () => {
  test("maps the user message bounds into the sticky container", () => {
    expect(getStickyPromptGeometry({ screenX: 10 }, { screenX: 12, width: 50 })).toEqual({ left: 2, width: 50 })
  })

  test("extends to the scrollbar when right viewport padding is reserved", () => {
    expect(getStickyPromptGeometry({ screenX: 10 }, { screenX: 12, width: 50 }, 1)).toEqual({ left: 2, width: 51 })
  })
})

describe("getStickyPromptScrollDelta", () => {
  test("aligns the original message with the sticky prompt top edge", () => {
    expect(getStickyPromptScrollDelta(42, 10)).toBe(32)
  })
})

describe("truncateStickyPrompt", () => {
  test("truncates by terminal display width", () => {
    expect(truncateStickyPrompt("你好世界", 5)).toBe("你好…")
  })
})

describe("findStickyUserMessage", () => {
  const children = [
    { id: "user-1", y: 10, height: 20, screenX: 0, width: 50 },
    { id: "user-2", y: 40, height: 20, screenX: 0, width: 50 },
  ]
  const userIDs = new Set(["user-1", "user-2"])

  test("returns no message before the first user message reaches the top", () => {
    expect(findStickyUserMessage(children, userIDs, 5, 10)).toBeUndefined()
  })

  test("hides the anchor when the next message overlaps the sticky region", () => {
    expect(findStickyUserMessage(children, userIDs, 31, 10)).toBeUndefined()
    expect(findStickyUserMessage(children, userIDs, 61, 10)).toBe(children[1])
  })

  test("filters ineligible children and selects the last eligible child", () => {
    const childrenWithAssistant = [children[0], { id: "assistant-1", y: 30, height: 10, screenX: 0, width: 50 }, children[1]]

    expect(findStickyUserMessage(childrenWithAssistant, userIDs, 61, 10)).toBe(children[1])
  })

  test("selects a prompt only after its bottom is fully covered", () => {
    expect(findStickyUserMessage(children, userIDs, 5, 10)).toBeUndefined()
    expect(findStickyUserMessage(children, userIDs, 31, 10)).toBeUndefined()
    expect(findStickyUserMessage(children, userIDs, 40, 10)).toBeUndefined()
    expect(findStickyUserMessage(children, userIDs, 61, 10)).toBe(children[1])
  })

  test("hides the current anchor while the next message overlaps the sticky region", () => {
    const children = [
      { id: "a", y: 0, height: 5, screenX: 0, width: 50 },
      { id: "b", y: 6, height: 20, screenX: 0, width: 50 },
    ]

    expect(findStickyUserMessage(children, new Set(["a", "b"]), 0, 10)).toBeUndefined()
  })

  test("switches to the latest message fully covered by the sticky region", () => {
    const children = [
      { id: "a", y: 0, height: 5, screenX: 0, width: 50 },
      { id: "b", y: 6, height: 4, screenX: 0, width: 50 },
    ]

    expect(findStickyUserMessage(children, new Set(["a", "b"]), 0, 10)).toBe(children[1])
  })

  test("treats a one-line gap as overlap", () => {
    const children = [
      { id: "a", y: 0, height: 5, screenX: 0, width: 50 },
      { id: "b", y: 11, height: 5, screenX: 0, width: 50 },
    ]

    expect(findStickyUserMessage(children, new Set(["a", "b"]), 0, 10)).toBeUndefined()
  })
})
