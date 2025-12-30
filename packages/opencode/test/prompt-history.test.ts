import { describe, test, expect, beforeEach } from "bun:test"
import { createStore, produce } from "solid-js/store"

// Minimal type definition matching the actual PromptInfo
type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: any[]
}

/**
 * Standalone implementation of the history move logic for testing.
 * This mirrors the logic in history.tsx without the SolidJS context dependencies.
 */
function createTestHistory() {
  let store = {
    index: 0,
    history: [] as PromptInfo[],
  }

  return {
    setHistory(history: PromptInfo[]) {
      store.history = history
      store.index = 0
    },
    getIndex() {
      return store.index
    },
    move(direction: 1 | -1, input: string): PromptInfo | undefined {
      // Guard: no history means nothing to navigate
      if (!store.history.length) return undefined

      const current = store.history.at(store.index)
      // Guard: if we can't find current position in history, bail out
      if (!current) return undefined

      // Guard: if user has modified input from what's in history, don't navigate
      if (current.input !== input && input.length) return undefined

      const next = store.index + direction
      // Don't go beyond history bounds
      if (Math.abs(next) > store.history.length) {
        // Still at current position, return current or empty
        if (store.index === 0) {
          return { input: "", parts: [] }
        }
        return store.history.at(store.index)
      }
      // Don't go past index 0 (most recent)
      if (next > 0) {
        if (store.index === 0) {
          return { input: "", parts: [] }
        }
        return store.history.at(store.index)
      }
      
      store.index = next

      // At index 0, return empty prompt (user's current typing position)
      if (store.index === 0) {
        return { input: "", parts: [] }
      }

      // Return the history entry at current index
      return store.history.at(store.index)
    },
    append(item: PromptInfo) {
      store.history.push({ ...item })
      store.index = 0
    },
  }
}

describe("Prompt History", () => {
  describe("move() with empty history", () => {
    test("should return undefined when history is empty and pressing Up", () => {
      const history = createTestHistory()
      const result = history.move(-1, "")
      expect(result).toBeUndefined()
    })

    test("should return undefined when history is empty and pressing Down", () => {
      const history = createTestHistory()
      const result = history.move(1, "")
      expect(result).toBeUndefined()
    })

    test("should return undefined when history is empty with non-empty input", () => {
      const history = createTestHistory()
      const result = history.move(-1, "some text")
      expect(result).toBeUndefined()
    })
  })

  describe("move() with single history entry", () => {
    test("should navigate to history entry on Up arrow", () => {
      const history = createTestHistory()
      history.setHistory([{ input: "test command", parts: [] }])
      
      const result = history.move(-1, "")
      
      expect(result).toBeDefined()
      expect(result?.input).toBe("test command")
      expect(result?.parts).toEqual([])
    })

    test("should return to empty prompt on Down arrow after navigating up", () => {
      const history = createTestHistory()
      history.setHistory([{ input: "test command", parts: [] }])
      
      // Navigate up first
      history.move(-1, "")
      
      // Then navigate down
      const result = history.move(1, "test command")
      
      expect(result).toBeDefined()
      expect(result?.input).toBe("")
      expect(result?.parts).toEqual([])
    })

    test("should not navigate beyond history bounds", () => {
      const history = createTestHistory()
      history.setHistory([{ input: "test command", parts: [] }])
      
      // Navigate up once
      history.move(-1, "")
      
      // Try to navigate up again (should stay at same position)
      const result = history.move(-1, "test command")
      
      expect(result).toBeDefined()
      expect(result?.input).toBe("test command")
    })
  })

  describe("move() with multiple history entries", () => {
    test("should navigate through multiple entries", () => {
      const history = createTestHistory()
      history.setHistory([
        { input: "first", parts: [] },
        { input: "second", parts: [] },
        { input: "third", parts: [] },
      ])
      
      // Navigate up to most recent (third)
      let result = history.move(-1, "")
      expect(result?.input).toBe("third")
      
      // Navigate up to second
      result = history.move(-1, "third")
      expect(result?.input).toBe("second")
      
      // Navigate up to first
      result = history.move(-1, "second")
      expect(result?.input).toBe("first")
      
      // Navigate down back to second
      result = history.move(1, "first")
      expect(result?.input).toBe("second")
    })
  })

  describe("move() input validation", () => {
    test("should not navigate if input has been modified", () => {
      const history = createTestHistory()
      history.setHistory([{ input: "original", parts: [] }])
      
      // Navigate to history
      history.move(-1, "")
      
      // Try to navigate with modified input
      const result = history.move(-1, "modified text")
      
      // Should return undefined because input doesn't match
      expect(result).toBeUndefined()
    })

    test("should allow navigation with empty input", () => {
      const history = createTestHistory()
      history.setHistory([{ input: "test", parts: [] }])
      
      const result = history.move(-1, "")
      
      expect(result).toBeDefined()
      expect(result?.input).toBe("test")
    })
  })

  describe("returned PromptInfo structure", () => {
    test("should always return valid PromptInfo with input and parts", () => {
      const history = createTestHistory()
      history.setHistory([{ input: "test", parts: [{ type: "text", text: "hello" }] }])
      
      const result = history.move(-1, "")
      
      expect(result).toBeDefined()
      expect(typeof result?.input).toBe("string")
      expect(Array.isArray(result?.parts)).toBe(true)
    })

    test("empty prompt return should have valid structure", () => {
      const history = createTestHistory()
      history.setHistory([{ input: "test", parts: [] }])
      
      // Navigate up then down to get empty prompt
      history.move(-1, "")
      const result = history.move(1, "test")
      
      expect(result).toBeDefined()
      expect(result?.input).toBe("")
      expect(Array.isArray(result?.parts)).toBe(true)
      expect(result?.parts.length).toBe(0)
    })
  })

  describe("append()", () => {
    test("should add entry to history", () => {
      const history = createTestHistory()
      
      history.append({ input: "new entry", parts: [] })
      
      const result = history.move(-1, "")
      expect(result?.input).toBe("new entry")
    })

    test("should reset index after append", () => {
      const history = createTestHistory()
      history.setHistory([{ input: "old", parts: [] }])
      
      // Navigate into history
      history.move(-1, "")
      
      // Append new entry
      history.append({ input: "new", parts: [] })
      
      // Index should be reset, so navigating up should show "new"
      const result = history.move(-1, "")
      expect(result?.input).toBe("new")
    })
  })
})
