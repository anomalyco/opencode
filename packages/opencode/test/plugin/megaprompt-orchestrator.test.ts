import { describe, expect, test } from "bun:test"
import {
  orchestrate,
  filterSuccessfulResponses,
  formatFailures,
  type ModelConfig,
} from "@opencode-ai/plugin/megaprompt/orchestrator"

describe("megaprompt.orchestrator", () => {
  describe("orchestrate", () => {
    test("handles successful responses from all models", async () => {
      const models: ModelConfig[] = [
        { providerID: "openai", modelID: "gpt-4o" },
        { providerID: "anthropic", modelID: "claude-3" },
      ]

      const generate = async (model: ModelConfig) => {
        return `Response from ${model.providerID}/${model.modelID}`
      }

      const results = await orchestrate({
        prompt: "test prompt",
        models,
        generate,
      })

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[0].text).toBe("Response from openai/gpt-4o")
      expect(results[1].success).toBe(true)
      expect(results[1].text).toBe("Response from anthropic/claude-3")
    })

    test("handles failed responses gracefully", async () => {
      const models: ModelConfig[] = [
        { providerID: "openai", modelID: "gpt-4o" },
        { providerID: "anthropic", modelID: "claude-3" },
      ]

      const generate = async (model: ModelConfig) => {
        if (model.providerID === "anthropic") {
          throw new Error("Rate limited")
        }
        return `Response from ${model.modelID}`
      }

      const results = await orchestrate({
        prompt: "test prompt",
        models,
        generate,
      })

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(false)
      expect(results[1].error).toBe("Rate limited")
    })

    test("handles all failures", async () => {
      const models: ModelConfig[] = [
        { providerID: "openai", modelID: "gpt-4o" },
      ]

      const generate = async () => {
        throw new Error("Service unavailable")
      }

      const results = await orchestrate({
        prompt: "test prompt",
        models,
        generate,
      })

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(false)
      expect(results[0].error).toBe("Service unavailable")
    })

    test("runs requests in parallel", async () => {
      const startTimes: number[] = []
      const models: ModelConfig[] = [
        { providerID: "a", modelID: "1" },
        { providerID: "b", modelID: "2" },
        { providerID: "c", modelID: "3" },
      ]

      const generate = async () => {
        startTimes.push(Date.now())
        await new Promise((r) => setTimeout(r, 50))
        return "response"
      }

      await orchestrate({
        prompt: "test",
        models,
        generate,
      })

      // All requests should start within 20ms of each other if truly parallel
      const maxDiff = Math.max(...startTimes) - Math.min(...startTimes)
      expect(maxDiff).toBeLessThan(20)
    })
  })

  describe("filterSuccessfulResponses", () => {
    test("filters out failed responses", () => {
      const responses = [
        { modelID: "a", providerID: "x", text: "ok", success: true },
        { modelID: "b", providerID: "y", text: "", success: false, error: "failed" },
        { modelID: "c", providerID: "z", text: "also ok", success: true },
      ]

      const result = filterSuccessfulResponses(responses)

      expect(result).toHaveLength(2)
      expect(result[0].modelID).toBe("a")
      expect(result[1].modelID).toBe("c")
    })
  })

  describe("formatFailures", () => {
    test("returns empty string when no failures", () => {
      const responses = [
        { modelID: "a", providerID: "x", text: "ok", success: true },
      ]

      const result = formatFailures(responses)

      expect(result).toBe("")
    })

    test("formats failure messages", () => {
      const responses = [
        { modelID: "a", providerID: "x", text: "ok", success: true },
        { modelID: "b", providerID: "y", text: "", success: false, error: "Rate limited" },
        { modelID: "c", providerID: "z", text: "", success: false, error: "Timeout" },
      ]

      const result = formatFailures(responses)

      expect(result).toContain("following models failed")
      expect(result).toContain("y/b: Rate limited")
      expect(result).toContain("z/c: Timeout")
    })
  })
})
