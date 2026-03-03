import { isSyntheticUserMessage } from "@/plugin/copilot"
import { describe, test, expect } from "bun:test"

describe("isSyntheticUserMessage", () => {
  describe("returns false for non-user messages", () => {
    test("assistant message", () => {
      expect(isSyntheticUserMessage({ role: "assistant", content: "hello" })).toBe(false)
    })

    test("system message", () => {
      expect(isSyntheticUserMessage({ role: "system", content: "you are..." })).toBe(false)
    })

    test("null / undefined", () => {
      expect(isSyntheticUserMessage(null)).toBe(false)
      expect(isSyntheticUserMessage(undefined)).toBe(false)
    })
  })

  describe("returns false for genuine human user messages", () => {
    test("plain string content", () => {
      expect(isSyntheticUserMessage({ role: "user", content: "Hello!" })).toBe(false)
    })

    test("array with a text part", () => {
      expect(
        isSyntheticUserMessage({
          role: "user",
          content: [{ type: "text", text: "Hello!" }],
        }),
      ).toBe(false)
    })

    test("array mixing text and tool_result", () => {
      expect(
        isSyntheticUserMessage({
          role: "user",
          content: [
            { type: "text", text: "Please also check this result:" },
            { type: "tool_result", tool_use_id: "abc", content: "done" },
          ],
        }),
      ).toBe(false)
    })
  })

  describe("returns true for synthetic agent-produced user messages", () => {
    test("only tool_result parts (Completions / Messages API pattern)", () => {
      expect(
        isSyntheticUserMessage({
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "result A" },
            { type: "tool_result", tool_use_id: "t2", content: "result B" },
          ],
        }),
      ).toBe(true)
    })

    test("only image_url parts (Completions API vision attachment)", () => {
      expect(
        isSyntheticUserMessage({
          role: "user",
          content: [{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } }],
        }),
      ).toBe(true)
    })

    test("only input_image parts (Responses API vision attachment)", () => {
      expect(
        isSyntheticUserMessage({
          role: "user",
          content: [{ type: "input_image", image_url: "data:image/png;base64,abc" }],
        }),
      ).toBe(true)
    })

    test("only image parts (Messages API vision attachment)", () => {
      expect(
        isSyntheticUserMessage({
          role: "user",
          content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }],
        }),
      ).toBe(true)
    })

    test("only attachment parts", () => {
      expect(
        isSyntheticUserMessage({
          role: "user",
          content: [{ type: "attachment", data: "..." }],
        }),
      ).toBe(true)
    })

    test("mixed tool_result and image (compaction scenario)", () => {
      expect(
        isSyntheticUserMessage({
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "done" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
          ],
        }),
      ).toBe(true)
    })

    test("empty content array is treated as synthetic (no human text)", () => {
      expect(
        isSyntheticUserMessage({
          role: "user",
          content: [],
        }),
      ).toBe(true)
    })
  })
})
