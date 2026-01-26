import { describe, expect, test } from "bun:test"
import {
  buildJudgePrompt,
  parseEvaluationResult,
  type ModelResponse,
} from "@opencode-ai/plugin/megaprompt/evaluator"

describe("megaprompt.evaluator", () => {
  describe("buildJudgePrompt", () => {
    test("returns message when no responses available", () => {
      const responses: ModelResponse[] = []
      const result = buildJudgePrompt("test prompt", responses)
      expect(result).toBe("No responses available to evaluate.")
    })

    test("returns single winner message when only one response", () => {
      const responses: ModelResponse[] = [
        {
          modelID: "gpt-4o",
          providerID: "openai",
          text: "Test response",
          success: true,
        },
      ]
      const result = buildJudgePrompt("test prompt", responses)
      expect(result).toContain("Only one model responded successfully")
      expect(result).toContain("openai/gpt-4o")
      expect(result).toContain("Test response")
    })

    test("builds proper judge prompt for multiple responses", () => {
      const responses: ModelResponse[] = [
        {
          modelID: "gpt-4o",
          providerID: "openai",
          text: "Response from GPT-4o",
          success: true,
        },
        {
          modelID: "claude-3-5-sonnet",
          providerID: "anthropic",
          text: "Response from Claude",
          success: true,
        },
      ]
      const result = buildJudgePrompt("What is 2+2?", responses)

      expect(result).toContain("Role: Improvement Specialist")
      expect(result).toContain("What is 2+2?")
      expect(result).toContain("openai/gpt-4o")
      expect(result).toContain("anthropic/claude-3-5-sonnet")
      expect(result).toContain("Response from GPT-4o")
      expect(result).toContain("Response from Claude")
      expect(result).toContain("## Winner")
      expect(result).toContain("## Improvements")
    })

    test("filters out failed responses", () => {
      const responses: ModelResponse[] = [
        {
          modelID: "gpt-4o",
          providerID: "openai",
          text: "Good response",
          success: true,
        },
        {
          modelID: "claude-3",
          providerID: "anthropic",
          text: "",
          success: false,
          error: "Rate limited",
        },
      ]
      const result = buildJudgePrompt("test", responses)
      expect(result).toContain("Only one model responded successfully")
      expect(result).not.toContain("Rate limited")
    })
  })

  describe("parseEvaluationResult", () => {
    test("parses winner and feedback correctly", () => {
      const evaluatorResponse = `## Winner
**Model**: openai/gpt-4o
**Reason**: Best overall clarity and accuracy

## Improvements from Other Responses
- Consider adding more examples
- Include edge case handling
- Mention performance considerations

## Winning Response
This is the winning response text.`

      const responses: ModelResponse[] = [
        { modelID: "gpt-4o", providerID: "openai", text: "original", success: true },
      ]

      const result = parseEvaluationResult(evaluatorResponse, responses)

      expect(result.winner.providerID).toBe("openai")
      expect(result.winner.modelID).toBe("gpt-4o")
      expect(result.winner.reason).toBe("Best overall clarity and accuracy")
      expect(result.feedback).toHaveLength(3)
      expect(result.feedback[0]).toBe("Consider adding more examples")
      expect(result.winningResponse).toContain("This is the winning response text")
    })

    test("handles missing sections gracefully", () => {
      const evaluatorResponse = `Some unstructured response`
      const responses: ModelResponse[] = [
        { modelID: "gpt-4o", providerID: "openai", text: "fallback", success: true },
      ]

      const result = parseEvaluationResult(evaluatorResponse, responses)

      expect(result.winner.modelID).toBe("")
      expect(result.feedback).toHaveLength(0)
    })

    test("falls back to original response when parsing fails", () => {
      const evaluatorResponse = `## Winner
**Model**: anthropic/claude-3-5-sonnet
**Reason**: Great response

## Winning Response`

      const responses: ModelResponse[] = [
        { modelID: "gpt-4o", providerID: "openai", text: "gpt response", success: true },
        { modelID: "claude-3-5-sonnet", providerID: "anthropic", text: "claude response", success: true },
      ]

      const result = parseEvaluationResult(evaluatorResponse, responses)

      expect(result.winner.providerID).toBe("anthropic")
      expect(result.winner.modelID).toBe("claude-3-5-sonnet")
      expect(result.winningResponse).toBe("claude response")
    })
  })
})
