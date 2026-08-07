import { describe, expect, test } from "bun:test"
import { excludeSideChatHistory } from "./side-chat"

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
