import { describe, expect, test } from "bun:test"
import type { PromptInfo } from "../../../src/cli/cmd/tui/component/prompt/history"
import {
  createPastePlaceholder,
  shiftRange,
  rewriteRange,
  cursorAfterNonText,
  cursorAfterReplacement,
  updateTextPart,
  shiftFilePart,
  shiftAgentPart,
  replacePart,
} from "../../../src/cli/cmd/tui/component/prompt/paste-summary"

describe("paste-summary utilities", () => {
  describe("createPastePlaceholder", () => {
    test("should create placeholder for single line", () => {
      const result = createPastePlaceholder("hello world")
      expect(result).toBe("[Pasted ~1 lines]")
    })

    test("should create placeholder for multiple lines", () => {
      const result = createPastePlaceholder("line1\nline2\nline3")
      expect(result).toBe("[Pasted ~3 lines]")
    })

    test("should create placeholder for empty text", () => {
      const result = createPastePlaceholder("")
      expect(result).toBe("[Pasted ~1 lines]")
    })

    test("should count lines correctly with trailing newline", () => {
      const result = createPastePlaceholder("line1\nline2\n")
      expect(result).toBe("[Pasted ~3 lines]")
    })

    test("should handle text with many lines", () => {
      const text = Array(50).fill("line").join("\n")
      const result = createPastePlaceholder(text)
      expect(result).toBe("[Pasted ~50 lines]")
    })
  })

  describe("shiftRange", () => {
    test("should shift range with positive delta", () => {
      const extmark = { start: 10, end: 20 }
      const result = shiftRange(extmark, 5)
      expect(result).toEqual({ start: 15, end: 25 })
    })

    test("should shift range with negative delta", () => {
      const extmark = { start: 20, end: 30 }
      const result = shiftRange(extmark, -5)
      expect(result).toEqual({ start: 15, end: 25 })
    })

    test("should handle zero delta", () => {
      const extmark = { start: 10, end: 20 }
      const result = shiftRange(extmark, 0)
      expect(result).toEqual({ start: 10, end: 20 })
    })

    test("should not mutate original extmark", () => {
      const extmark = { start: 10, end: 20 }
      const result = shiftRange(extmark, 5)
      expect(extmark).toEqual({ start: 10, end: 20 })
      expect(result).not.toBe(extmark)
    })
  })

  describe("rewriteRange", () => {
    test("should replace middle of text", () => {
      const result = rewriteRange("hello world", 6, 11, "universe")
      expect(result.nextText).toBe("hello universe")
      expect(result.diff).toBe(3)
    })

    test("should replace at start", () => {
      const result = rewriteRange("hello world", 0, 5, "hi")
      expect(result.nextText).toBe("hi world")
      expect(result.diff).toBe(-3)
    })

    test("should replace at end", () => {
      const result = rewriteRange("hello world", 6, 11, "!")
      expect(result.nextText).toBe("hello !")
      expect(result.diff).toBe(-4)
    })

    test("should replace with empty string", () => {
      const result = rewriteRange("hello world", 5, 11, "")
      expect(result.nextText).toBe("hello")
      expect(result.diff).toBe(-6)
    })

    test("should calculate positive diff correctly", () => {
      const result = rewriteRange("hi", 0, 2, "hello world")
      expect(result.nextText).toBe("hello world")
      expect(result.diff).toBe(9)
    })

    test("should handle same length replacement", () => {
      const result = rewriteRange("hello", 0, 5, "world")
      expect(result.nextText).toBe("world")
      expect(result.diff).toBe(0)
    })
  })

  describe("cursorAfterNonText", () => {
    test("should keep cursor before range", () => {
      const result = cursorAfterNonText(5, 10, 20)
      expect(result).toBe(5)
    })

    test("should keep cursor after range", () => {
      const result = cursorAfterNonText(25, 10, 20)
      expect(result).toBe(25)
    })

    test("should move cursor within range to start + 1", () => {
      const result = cursorAfterNonText(15, 10, 20)
      expect(result).toBe(11)
    })

    test("should handle cursor at start boundary", () => {
      const result = cursorAfterNonText(10, 10, 20)
      expect(result).toBe(10)
    })

    test("should handle cursor at end boundary", () => {
      const result = cursorAfterNonText(20, 10, 20)
      expect(result).toBe(20)
    })
  })

  describe("cursorAfterReplacement", () => {
    test("should keep cursor before range", () => {
      const result = cursorAfterReplacement(5, 10, 20, 3, 13)
      expect(result).toBe(5)
    })

    test("should shift cursor after range by diff", () => {
      const result = cursorAfterReplacement(25, 10, 20, 5, 15)
      expect(result).toBe(30)
    })

    test("should move cursor within range to start + replacementLength", () => {
      const result = cursorAfterReplacement(15, 10, 20, 5, 15)
      expect(result).toBe(25)
    })

    test("should handle negative diff", () => {
      const result = cursorAfterReplacement(30, 10, 20, -5, 5)
      expect(result).toBe(25)
    })

    test("should handle zero diff", () => {
      const result = cursorAfterReplacement(30, 10, 20, 0, 10)
      expect(result).toBe(30)
    })

    test("should handle cursor at start boundary", () => {
      const result = cursorAfterReplacement(10, 10, 20, 5, 15)
      expect(result).toBe(10)
    })

    test("should handle cursor at end boundary", () => {
      const result = cursorAfterReplacement(20, 10, 20, 5, 15)
      expect(result).toBe(25)
    })
  })

  describe("updateTextPart", () => {
    test("should update valid text part", () => {
      const part: PromptInfo["parts"][number] = {
        type: "text",
        text: "original",
        source: {
          text: {
            start: 0,
            end: 8,
            value: "original",
          },
        },
      }
      const result = updateTextPart(part, "new content", 10, "replacement")
      expect(result.type).toBe("text")
      if (result.type === "text") {
        expect(result.text).toBe("new content")
        if (result.source?.text) {
          expect(result.source.text.start).toBe(10)
          expect(result.source.text.end).toBe(21)
          expect(result.source.text.value).toBe("replacement")
        }
      }
    })

    test("should return unchanged for non-text part", () => {
      const part: PromptInfo["parts"][number] = {
        type: "agent",
        name: "test-agent",
      }
      const result = updateTextPart(part, "content", 10, "replacement")
      expect(result).toBe(part)
    })

    test("should return unchanged for text part without source", () => {
      const part: PromptInfo["parts"][number] = {
        type: "text",
        text: "original",
      }
      const result = updateTextPart(part, "content", 10, "replacement")
      expect(result).toBe(part)
    })

    test("should not mutate original part", () => {
      const part: PromptInfo["parts"][number] = {
        type: "text",
        text: "original",
        source: {
          text: {
            start: 0,
            end: 8,
            value: "original",
          },
        },
      }
      const original = JSON.parse(JSON.stringify(part))
      updateTextPart(part, "new content", 10, "replacement")
      expect(part).toEqual(original)
    })

    test("should handle different replacement lengths", () => {
      const part: PromptInfo["parts"][number] = {
        type: "text",
        text: "original",
        source: {
          text: {
            start: 0,
            end: 8,
            value: "original",
          },
        },
      }
      const result = updateTextPart(part, "content", 5, "hi")
      if (result.type === "text" && result.source?.text) {
        expect(result.source.text.end).toBe(7)
      }
    })
  })

  describe("shiftFilePart", () => {
    test("should shift valid file part", () => {
      const part: PromptInfo["parts"][number] = {
        type: "file",
        mime: "text/plain",
        url: "file:///test/file.txt",
        source: {
          type: "file",
          path: "/test/file.txt",
          text: {
            value: "content",
            start: 10,
            end: 20,
          },
        },
      }
      const result = shiftFilePart(part, 15, 25)
      expect(result.type).toBe("file")
      if (result.type === "file" && result.source?.text) {
        expect(result.source.text.start).toBe(15)
        expect(result.source.text.end).toBe(25)
      }
    })

    test("should return unchanged for non-file part", () => {
      const part: PromptInfo["parts"][number] = {
        type: "text",
        text: "hello",
      }
      const result = shiftFilePart(part, 10, 20)
      expect(result).toBe(part)
    })

    test("should return unchanged for file part without source", () => {
      const part: PromptInfo["parts"][number] = {
        type: "file",
        mime: "text/plain",
        url: "file:///test/file.txt",
      }
      const result = shiftFilePart(part, 10, 20)
      expect(result).toBe(part)
    })

    test("should not mutate original part", () => {
      const part: PromptInfo["parts"][number] = {
        type: "file",
        mime: "text/plain",
        url: "file:///test/file.txt",
        source: {
          type: "file",
          path: "/test/file.txt",
          text: {
            value: "content",
            start: 10,
            end: 20,
          },
        },
      }
      const original = JSON.parse(JSON.stringify(part))
      shiftFilePart(part, 15, 25)
      expect(part).toEqual(original)
    })
  })

  describe("shiftAgentPart", () => {
    test("should shift valid agent part", () => {
      const part: PromptInfo["parts"][number] = {
        type: "agent",
        name: "test-agent",
        source: {
          value: "@test-agent",
          start: 10,
          end: 20,
        },
      }
      const result = shiftAgentPart(part, 15, 25)
      expect(result.type).toBe("agent")
      if (result.type === "agent" && result.source) {
        expect(result.source.start).toBe(15)
        expect(result.source.end).toBe(25)
      }
    })

    test("should return unchanged for non-agent part", () => {
      const part: PromptInfo["parts"][number] = {
        type: "text",
        text: "hello",
      }
      const result = shiftAgentPart(part, 10, 20)
      expect(result).toBe(part)
    })

    test("should return unchanged for agent part without source", () => {
      const part: PromptInfo["parts"][number] = {
        type: "agent",
        name: "test-agent",
      }
      const result = shiftAgentPart(part, 10, 20)
      expect(result).toBe(part)
    })

    test("should not mutate original part", () => {
      const part: PromptInfo["parts"][number] = {
        type: "agent",
        name: "test-agent",
        source: {
          value: "@test-agent",
          start: 10,
          end: 20,
        },
      }
      const original = JSON.parse(JSON.stringify(part))
      shiftAgentPart(part, 15, 25)
      expect(part).toEqual(original)
    })
  })

  describe("replacePart", () => {
    test("should replace part at index 0", () => {
      const parts: PromptInfo["parts"] = [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]
      const newPart: PromptInfo["parts"][number] = { type: "text", text: "replaced" }
      const result = replacePart(parts, 0, newPart)
      expect(result[0]).toBe(newPart)
      expect(result[1]).toBe(parts[1])
    })

    test("should replace part at middle index", () => {
      const parts: PromptInfo["parts"] = [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
        { type: "text", text: "third" },
      ]
      const newPart: PromptInfo["parts"][number] = { type: "text", text: "replaced" }
      const result = replacePart(parts, 1, newPart)
      expect(result[0]).toBe(parts[0])
      expect(result[1]).toBe(newPart)
      expect(result[2]).toBe(parts[2])
    })

    test("should return same array when part is identical", () => {
      const parts: PromptInfo["parts"] = [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]
      const result = replacePart(parts, 0, parts[0])
      expect(result).toBe(parts)
    })

    test("should not mutate original array", () => {
      const parts: PromptInfo["parts"] = [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]
      const original = [...parts]
      const newPart: PromptInfo["parts"][number] = { type: "text", text: "replaced" }
      replacePart(parts, 0, newPart)
      expect(parts).toEqual(original)
    })

    test("should create new array reference", () => {
      const parts: PromptInfo["parts"] = [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]
      const newPart: PromptInfo["parts"][number] = { type: "text", text: "replaced" }
      const result = replacePart(parts, 0, newPart)
      expect(result).not.toBe(parts)
    })
  })
})
