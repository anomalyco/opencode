import { describe, test, expect } from "bun:test"
import { moveHistory, type PromptInfo } from "../src/cli/cmd/tui/component/prompt/history-core"

describe("moveHistory", () => {
  describe("with empty history", () => {
    test("should return undefined and not change index when history is empty and pressing Up", () => {
      const history: PromptInfo[] = []
      const result = moveHistory(history, 0, -1, "")

      expect(result.result).toBeUndefined()
      expect(result.nextIndex).toBe(0)
    })

    test("should return undefined and not change index when history is empty and pressing Down", () => {
      const history: PromptInfo[] = []
      const result = moveHistory(history, 0, 1, "")

      expect(result.result).toBeUndefined()
      expect(result.nextIndex).toBe(0)
    })

    test("should return undefined and not change index when history is empty with non-empty input", () => {
      const history: PromptInfo[] = []
      const result = moveHistory(history, 0, -1, "some text")

      expect(result.result).toBeUndefined()
      expect(result.nextIndex).toBe(0)
    })
  })

  describe("with single history entry", () => {
    test("should navigate to history entry on Up arrow", () => {
      const history = [{ input: "test command", parts: [] }]
      const result = moveHistory(history, 0, -1, "")

      expect(result.result).toBeDefined()
      expect(result.result?.input).toBe("test command")
      expect(result.result?.parts).toEqual([])
      expect(result.nextIndex).toBe(-1)
    })

    test("should return to empty prompt on Down arrow after navigating up", () => {
      const history = [{ input: "test command", parts: [] }]

      const result1 = moveHistory(history, 0, -1, "")
      expect(result1.result?.input).toBe("test command")

      const result2 = moveHistory(history, result1.nextIndex, 1, "test command")
      expect(result2.result).toBeDefined()
      expect(result2.result?.input).toBe("")
      expect(result2.result?.parts).toEqual([])
      expect(result2.nextIndex).toBe(0)
    })

    test("should not navigate beyond history bounds", () => {
      const history = [{ input: "test command", parts: [] }]

      const result1 = moveHistory(history, 0, -1, "")
      const result2 = moveHistory(history, result1.nextIndex, -1, "test command")

      expect(result2.result).toBeDefined()
      expect(result2.result?.input).toBe("test command")
      expect(result2.nextIndex).toBe(-1)
    })
  })

  describe("with multiple history entries", () => {
    test("should navigate through multiple entries", () => {
      const history = [
        { input: "first", parts: [] },
        { input: "second", parts: [] },
        { input: "third", parts: [] },
      ]

      let result = moveHistory(history, 0, -1, "")
      expect(result.result?.input).toBe("third")
      expect(result.nextIndex).toBe(-1)

      result = moveHistory(history, result.nextIndex, -1, "third")
      expect(result.result?.input).toBe("second")
      expect(result.nextIndex).toBe(-2)

      result = moveHistory(history, result.nextIndex, -1, "second")
      expect(result.result?.input).toBe("first")
      expect(result.nextIndex).toBe(-3)

      result = moveHistory(history, result.nextIndex, 1, "first")
      expect(result.result?.input).toBe("second")
      expect(result.nextIndex).toBe(-2)
    })
  })

  describe("input validation", () => {
    test("should not navigate if input has been modified", () => {
      const history = [{ input: "original", parts: [] }]

      const result1 = moveHistory(history, 0, -1, "")
      const result2 = moveHistory(history, result1.nextIndex, -1, "modified text")

      expect(result2.result).toBeUndefined()
      expect(result2.nextIndex).toBe(result1.nextIndex)
    })

    test("should allow navigation with empty input", () => {
      const history = [{ input: "test", parts: [] }]
      const result = moveHistory(history, 0, -1, "")

      expect(result.result).toBeDefined()
      expect(result.result?.input).toBe("test")
    })
  })

  describe("returned PromptInfo structure", () => {
    test("should always return valid PromptInfo with input and parts", () => {
      const history = [{ input: "test", parts: [{ type: "text" as const, text: "hello" }] }]
      const result = moveHistory(history, 0, -1, "")

      expect(result.result).toBeDefined()
      expect(typeof result.result?.input).toBe("string")
      expect(Array.isArray(result.result?.parts)).toBe(true)
    })

    test("empty prompt return should have valid structure", () => {
      const history = [{ input: "test", parts: [] }]

      const result1 = moveHistory(history, 0, -1, "")
      const result2 = moveHistory(history, result1.nextIndex, 1, "test")

      expect(result2.result).toBeDefined()
      expect(result2.result?.input).toBe("")
      expect(Array.isArray(result2.result?.parts)).toBe(true)
      expect(result2.result?.parts.length).toBe(0)
    })
  })
})
