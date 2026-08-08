import { describe, expect, test } from "bun:test"
import { appendPromptText, excludeSideChatHistory, isSideChatTab, quoteSelection } from "./side-chat"

describe("excludeSideChatHistory", () => {
  test("keeps new side-chat turns while hiding the inherited transcript", () => {
    const messages = [
      { id: "inherited-user", role: "user" },
      { id: "inherited-assistant", role: "assistant" },
      { id: "side-user", role: "user" },
      { id: "side-assistant", role: "assistant" },
    ]

    expect(excludeSideChatHistory(messages, new Set(["inherited-user", "inherited-assistant"]))).toEqual([
      { id: "side-user", role: "user" },
      { id: "side-assistant", role: "assistant" },
    ])
  })

  test("returns the original collection when there is no inherited transcript", () => {
    const messages = [{ id: "side-user" }]
    expect(excludeSideChatHistory(messages, undefined)).toBe(messages)
  })
})

describe("side-chat tabs", () => {
  test("recognizes only side-chat tab IDs", () => {
    expect(isSideChatTab("side-chat://one")).toBe(true)
    expect(isSideChatTab("file://side-chat.ts")).toBe(false)
    expect(isSideChatTab(undefined)).toBe(false)
  })
})

describe("side-chat quotes", () => {
  test("formats a trimmed multiline selection as an attributed blockquote", () => {
    expect(quoteSelection("Main Chat", "  first\r\n\r\nsecond  ")).toBe("Main Chat:\n> first\n>\n> second\n\n")
  })

  test("appends a quote without discarding existing prompt parts", () => {
    const result = appendPromptText([{ type: "text", content: "question", start: 0, end: 8 }], "Side Chat:\n> answer")
    expect(result).toEqual({
      prompt: [
        { type: "text", content: "question", start: 0, end: 8 },
        { type: "text", content: "\n\nSide Chat:\n> answer", start: 8, end: 29 },
      ],
      cursor: 29,
    })
  })
})
