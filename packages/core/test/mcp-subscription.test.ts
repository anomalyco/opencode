import { describe, expect, test } from "bun:test"
import { matchesSubscribedUri, resourceUpdateText } from "@opencode/core/mcp/subscription"

describe("matchesSubscribedUri", () => {
  test("accepts the subscribed URI and its sub-resources", () => {
    expect(matchesSubscribedUri("docs://readme", "docs://readme")).toBe(true)
    expect(matchesSubscribedUri("file:///project", "file:///project/src/main.rs")).toBe(true)
    expect(matchesSubscribedUri("file:///project/", "file:///project/src/main.rs")).toBe(true)
    expect(matchesSubscribedUri("docs://readme", "docs://readme?v=2")).toBe(true)
    expect(matchesSubscribedUri("file:///a", "file:///ab")).toBe(false)
    expect(matchesSubscribedUri("docs://readme", "docs://other")).toBe(false)
  })
})

describe("resourceUpdateText", () => {
  test("joins text and cuts it at 16,000 characters", () => {
    expect(resourceUpdateText([])).toBeUndefined()
    expect(resourceUpdateText([{ type: "text", text: "hello" }])).toBe("hello")
    const long = "a".repeat(16_001)
    expect(resourceUpdateText([{ type: "text", text: long }])).toBe(`${"a".repeat(16_000)}\n[truncated]`)
  })
})
