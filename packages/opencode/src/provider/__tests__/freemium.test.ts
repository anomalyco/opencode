import { describe, it, expect, beforeEach, mock } from "bun:test"
import { Freemium } from "../freemium"

describe("Freemium", () => {
  const mockModels: Freemium.OpenRouterModel[] = [
    {
      id: "basic-model",
      name: "Basic Model",
      context_length: 4096,
      pricing: { prompt: "0", completion: "0" },
      top_provider: { max_completion_tokens: 4096 },
      supported_parameters: [],
      architecture: { input_modalities: ["text"] },
    },
    {
      id: "premium-gpt4",
      name: "GPT-4 Premium",
      context_length: 128000,
      pricing: { prompt: "0", completion: "0" },
      top_provider: { max_completion_tokens: 16000 },
      supported_parameters: ["tools"],
      architecture: { input_modalities: ["text", "image"] },
    },
    {
      id: "deepseek-coder",
      name: "DeepSeek Coder",
      context_length: 64000,
      pricing: { prompt: "0", completion: "0" },
      top_provider: { max_completion_tokens: 8000 },
      supported_parameters: ["tools"],
      architecture: { input_modalities: ["text"] },
    },
  ]

  beforeEach(() => {
    // Reset state between tests
    Freemium.setComplexity(Freemium.TaskComplexity.MEDIUM)
  })

  describe("estimateTokens", () => {
    it("should estimate tokens as text.length / 4", () => {
      expect(Freemium.estimateTokens("hello")).toBe(2)
      expect(Freemium.estimateTokens("a".repeat(100))).toBe(25)
      expect(Freemium.estimateTokens("")).toBe(0)
    })
  })

  describe("detectComplexity", () => {
    it("should detect SIMPLE tasks", () => {
      expect(Freemium.detectComplexity("fix typo in file")).toBe(Freemium.TaskComplexity.SIMPLE)
      expect(Freemium.detectComplexity("add comment to function")).toBe(
        Freemium.TaskComplexity.SIMPLE,
      )
      expect(Freemium.detectComplexity("rename variable")).toBe(Freemium.TaskComplexity.SIMPLE)
    })

    it("should detect MEDIUM tasks", () => {
      expect(Freemium.detectComplexity("refactor this function")).toBe(
        Freemium.TaskComplexity.MEDIUM,
      )
      expect(Freemium.detectComplexity("optimize the query")).toBe(Freemium.TaskComplexity.MEDIUM)
      expect(Freemium.detectComplexity("a".repeat(10000), 3)).toBe(Freemium.TaskComplexity.MEDIUM)
    })

    it("should detect COMPLEX tasks", () => {
      expect(Freemium.detectComplexity("refactor and architect the entire system")).toBe(
        Freemium.TaskComplexity.COMPLEX,
      )
      expect(Freemium.detectComplexity("refactor and optimize this code")).toBe(
        Freemium.TaskComplexity.COMPLEX,
      )
      expect(Freemium.detectComplexity("simple task", 15)).toBe(Freemium.TaskComplexity.COMPLEX)
      expect(Freemium.detectComplexity("a".repeat(20000))).toBe(Freemium.TaskComplexity.COMPLEX)
    })
  })

  describe("selectBestModel", () => {
    it("should return null for empty models array", () => {
      expect(Freemium.selectBestModel([])).toBeNull()
    })

    it("should select a model based on complexity scoring", () => {
      const selected = Freemium.selectBestModel(mockModels, 0, Freemium.TaskComplexity.SIMPLE)
      expect(selected).toBeDefined()
      // For simple tasks, any model is acceptable
      expect(mockModels.map((m) => m.id)).toContain(selected?.id)
    })

    it("should prefer premium models for complex tasks", () => {
      const selected = Freemium.selectBestModel(mockModels, 0, Freemium.TaskComplexity.COMPLEX)
      expect(selected).toBeDefined()
      expect(selected?.name).toContain("GPT-4")
    })

    it("should prefer mid-tier models for medium complexity", () => {
      const selected = Freemium.selectBestModel(mockModels, 0, Freemium.TaskComplexity.MEDIUM)
      expect(selected).toBeDefined()
      // DeepSeek or GPT-4 should be selected based on scoring
      expect(["deepseek-coder", "premium-gpt4"]).toContain(selected?.id)
    })

    it("should penalize models with insufficient context", () => {
      const largeTokenCount = 100000
      const selected = Freemium.selectBestModel(mockModels, largeTokenCount)
      expect(selected).toBeDefined()
      // Should select the model with largest context
      expect(selected?.id).toBe("premium-gpt4")
    })
  })

  describe("markRateLimited", () => {
    it("should exclude rate-limited models from selection", () => {
      Freemium.markRateLimited("premium-gpt4")
      const selected = Freemium.selectBestModel(mockModels, 0, Freemium.TaskComplexity.COMPLEX)
      expect(selected).toBeDefined()
      expect(selected?.id).not.toBe("premium-gpt4")
    })

    it("should select fallback when all models are rate-limited", () => {
      mockModels.forEach((m) => Freemium.markRateLimited(m.id))
      const selected = Freemium.selectBestModel(mockModels)
      expect(selected).toBeDefined()
    })
  })

  describe("setComplexity", () => {
    it("should set the current complexity level", () => {
      Freemium.setComplexity(Freemium.TaskComplexity.COMPLEX)
      const selected = Freemium.selectBestModel(mockModels)
      expect(selected).toBeDefined()
      // Should prefer premium model when complexity is COMPLEX
      expect(selected?.name).toContain("GPT-4")
    })
  })

  describe("model scoring", () => {
    it("should score models with tools support higher", () => {
      const selected = Freemium.selectBestModel(mockModels, 0, Freemium.TaskComplexity.MEDIUM)
      expect(selected).toBeDefined()
      // Should prefer models with tools support
      expect(["premium-gpt4", "deepseek-coder"]).toContain(selected?.id)
    })

    it("should score models with larger context higher", () => {
      const selected = Freemium.selectBestModel(mockModels, 50000)
      expect(selected).toBeDefined()
      // Should prefer models with sufficient context
      expect(selected?.context_length).toBeGreaterThanOrEqual(50000)
    })
  })
})
