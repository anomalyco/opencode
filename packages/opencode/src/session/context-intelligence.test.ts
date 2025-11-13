import { test, expect } from "bun:test"
import { ContextIntelligence } from "./context-intelligence"

test("context intelligence - function availability", () => {
  // Test that all main functions are available
  expect(typeof ContextIntelligence.analyzeContext).toBe("function")
  expect(typeof ContextIntelligence.fetchContextContent).toBe("function")
  expect(typeof ContextIntelligence.processContextBackground).toBe("function")
  expect(typeof ContextIntelligence.updateTrafficLights).toBe("function")
  expect(typeof ContextIntelligence.trackUserOverride).toBe("function")
  expect(typeof ContextIntelligence.trackMessageOutcome).toBe("function")
})

test("context intelligence - URL detection", () => {
  const contentWithUrl = "Check this out: https://httpbin.org/json"
  const contentWithoutUrl = "Just some plain text content"

  // Test URL detection regex
  expect(contentWithUrl.match(/https?:\/\/[^\s]+/)).toBeTruthy()
  expect(contentWithoutUrl.match(/https?:\/\/[^\s]+/)).toBeFalsy()
})

test("context intelligence - learning system", () => {
  // Test user override tracking - should not throw
  expect(() => {
    ContextIntelligence.trackUserOverride("ctx-1", "low/later", "activated")
    ContextIntelligence.trackMessageOutcome("session-1", ["ctx-1"], true)
  }).not.toThrow()
})

test("context intelligence - background processing", async () => {
  const mockContext = {
    id: "test-ctx",
    name: "Test Context",
    content: "This is a test context for background processing",
  }

  // Test that processContextBackground returns a promise
  const promise = ContextIntelligence.processContextBackground(mockContext)
  expect(promise).toBeInstanceOf(Promise)

  // Note: In a real test, you'd mock the LLM provider to avoid actual API calls
})
