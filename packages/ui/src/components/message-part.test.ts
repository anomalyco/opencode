import { describe, expect, test } from "bun:test"
import { showUserActions } from "./message-part-actions"

describe("message-part", () => {
  test("shows actions for attachment-only user messages", () => {
    expect(showUserActions({ text: "", attachments: 1 })).toBe(true)
    expect(showUserActions({ text: "hello", attachments: 0 })).toBe(true)
    expect(showUserActions({ text: "", attachments: 0 })).toBe(false)
  })
})
