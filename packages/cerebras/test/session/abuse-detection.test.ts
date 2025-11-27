import { describe, expect, test, beforeEach } from "bun:test"
import { AbuseDetection } from "../../src/session/abuse-detection"

describe("AbuseDetection", () => {
  beforeEach(() => {
    // Clean up between tests
    AbuseDetection.cleanup("test-session")
  })

  describe("identical prompts detection", () => {
    test("detects repeated identical prompts", () => {
      const sessionID = "test-session-1"
      const prompt = "Tell me a joke"

      // First prompt - OK
      let result = AbuseDetection.detect({
        sessionID,
        prompt,
        promptTokenCount: 100,
      })
      expect(result).toBeNull()

      // Second prompt - OK
      result = AbuseDetection.detect({
        sessionID,
        prompt,
        promptTokenCount: 100,
      })
      expect(result).toBeNull()

      // Third prompt - Should trigger warning
      result = AbuseDetection.detect({
        sessionID,
        prompt,
        promptTokenCount: 100,
      })
      expect(result).not.toBeNull()
      expect(result?.pattern).toBe("identical_prompts")
      expect(result?.severity).toBe("critical")
    })

    test("does not trigger for different prompts", () => {
      const sessionID = "test-session-2"

      for (let i = 0; i < 5; i++) {
        const result = AbuseDetection.detect({
          sessionID,
          prompt: `Prompt number ${i}`,
          promptTokenCount: 100,
        })
        expect(result).toBeNull()
      }
    })
  })

  describe("burst requests detection", () => {
    test("detects high frequency requests", () => {
      const sessionID = "test-session-3"

      // Simulate 10 rapid requests
      for (let i = 0; i < AbuseDetection.DEFAULT_BURST_REQUEST_THRESHOLD; i++) {
        const result = AbuseDetection.detect({
          sessionID,
          prompt: `Request ${i}`,
          promptTokenCount: 100,
        })

        if (i < AbuseDetection.DEFAULT_BURST_REQUEST_THRESHOLD - 1) {
          // Should not trigger before threshold
          expect(result).toBeNull()
        } else {
          // Should trigger at threshold
          expect(result).not.toBeNull()
          expect(result?.pattern).toBe("burst_requests")
          expect(result?.severity).toBe("warning")
        }
      }
    })
  })

  describe("lopsided tokens detection", () => {
    test("detects high input to output ratio", () => {
      const sessionID = "test-session-4"

      const result = AbuseDetection.detect({
        sessionID,
        prompt: "Very long prompt",
        promptTokenCount: 3000,
        inputTokens: 3000,
        outputTokens: 20, // 150:1 ratio
      })

      expect(result).not.toBeNull()
      expect(result?.pattern).toBe("lopsided_tokens")
      expect(result?.severity).toBe("warning")
    })

    test("does not trigger for balanced token usage", () => {
      const sessionID = "test-session-5"

      const result = AbuseDetection.detect({
        sessionID,
        prompt: "Normal prompt",
        promptTokenCount: 100,
        inputTokens: 100,
        outputTokens: 200, // 0.5:1 ratio
      })

      expect(result).toBeNull()
    })

    test("does not trigger for small output token counts", () => {
      const sessionID = "test-session-6"

      const result = AbuseDetection.detect({
        sessionID,
        prompt: "Prompt",
        promptTokenCount: 1000,
        inputTokens: 1000,
        outputTokens: 5, // Too few tokens to judge
      })

      expect(result).toBeNull()
    })
  })

  describe("prompt size growth detection", () => {
    test("detects uncontrollable prompt growth", () => {
      const sessionID = "test-session-7"

      // First prompt
      AbuseDetection.detect({
        sessionID,
        prompt: "Start",
        promptTokenCount: 100,
      })

      // 2x growth
      AbuseDetection.detect({
        sessionID,
        prompt: "Growing",
        promptTokenCount: 200,
      })

      // 2x growth again
      AbuseDetection.detect({
        sessionID,
        prompt: "Still growing",
        promptTokenCount: 400,
      })

      // 2x growth again - should trigger
      const result = AbuseDetection.detect({
        sessionID,
        prompt: "Too large",
        promptTokenCount: 800,
      })

      expect(result).not.toBeNull()
      expect(result?.pattern).toBe("prompt_size_growth")
      expect(result?.severity).toBe("critical")
    })

    test("resets growth streak when growth stops", () => {
      const sessionID = "test-session-8"

      // Start
      AbuseDetection.detect({
        sessionID,
        prompt: "Start",
        promptTokenCount: 100,
      })

      // 2x growth
      AbuseDetection.detect({
        sessionID,
        prompt: "Growing",
        promptTokenCount: 200,
      })

      // Stop growing (same size)
      AbuseDetection.detect({
        sessionID,
        prompt: "Stable",
        promptTokenCount: 200,
      })

      // Resume growth - should not trigger (streak reset)
      const result = AbuseDetection.detect({
        sessionID,
        prompt: "Growing again",
        promptTokenCount: 400,
      })

      expect(result).toBeNull()
    })
  })

  describe("getStats", () => {
    test("returns statistics for a session", () => {
      const sessionID = "test-session-9"

      AbuseDetection.detect({
        sessionID,
        prompt: "First",
        promptTokenCount: 100,
        inputTokens: 100,
        outputTokens: 200,
      })

      AbuseDetection.detect({
        sessionID,
        prompt: "Second",
        promptTokenCount: 150,
        inputTokens: 150,
        outputTokens: 300,
      })

      const stats = AbuseDetection.getStats(sessionID)

      expect(stats).not.toBeNull()
      expect(stats?.totalRequests).toBe(2)
      expect(stats?.averagePromptSize).toBe(125)
      expect(stats?.tokenHistory).toHaveLength(2)
    })

    test("returns null for non-existent session", () => {
      const stats = AbuseDetection.getStats("non-existent")
      expect(stats).toBeNull()
    })
  })

  describe("cleanup", () => {
    test("removes session state", () => {
      const sessionID = "test-session-10"

      AbuseDetection.detect({
        sessionID,
        prompt: "Test",
        promptTokenCount: 100,
      })

      expect(AbuseDetection.getStats(sessionID)).not.toBeNull()

      AbuseDetection.cleanup(sessionID)

      expect(AbuseDetection.getStats(sessionID)).toBeNull()
    })
  })
})
