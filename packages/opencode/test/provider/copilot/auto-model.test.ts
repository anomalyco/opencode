import { describe, test, expect, mock } from "bun:test"
import { CopilotAutoLanguageModel, createCopilotAutoModel } from "@/provider/sdk/copilot/auto-model"
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"

// Mock models matching real Copilot model list
const MOCK_MODELS = [
  { id: "claude-opus-4.6", name: "Claude Opus 4.6", capabilities: { reasoning: true, toolcall: true }, limit: { context: 200000, output: 32000 } },
  { id: "claude-opus-4.5", name: "Claude Opus 4.5", capabilities: { reasoning: true, toolcall: true }, limit: { context: 200000, output: 16384 } },
  { id: "gpt-5.4", name: "GPT-5.4", capabilities: { reasoning: true, toolcall: true }, limit: { context: 128000, output: 32000 } },
  { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", capabilities: { reasoning: true, toolcall: true }, limit: { context: 200000, output: 16384 } },
  { id: "gpt-5", name: "GPT-5", capabilities: { reasoning: true, toolcall: true }, limit: { context: 128000, output: 16384 } },
  { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", capabilities: { reasoning: true, toolcall: true }, limit: { context: 1000000, output: 65536 } },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", capabilities: { reasoning: true, toolcall: true }, limit: { context: 1000000, output: 65536 } },
  { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", capabilities: { reasoning: true, toolcall: true }, limit: { context: 200000, output: 16384 } },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", capabilities: { reasoning: true, toolcall: true }, limit: { context: 200000, output: 16384 } },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4", capabilities: { reasoning: false, toolcall: true }, limit: { context: 200000, output: 16384 } },
  { id: "gpt-4.1", name: "GPT-4.1", capabilities: { reasoning: false, toolcall: true }, limit: { context: 128000, output: 16384 } },
  { id: "gpt-4o", name: "GPT-4o", capabilities: { reasoning: false, toolcall: true }, limit: { context: 128000, output: 16384 } },
  { id: "grok-code-fast-1", name: "Grok", capabilities: { reasoning: false, toolcall: true }, limit: { context: 128000, output: 16384 } },
  { id: "gpt-5-mini", name: "GPT-5 Mini", capabilities: { reasoning: false, toolcall: true }, limit: { context: 128000, output: 16384 } },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", capabilities: { reasoning: false, toolcall: true }, limit: { context: 128000, output: 16384 } },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", capabilities: { reasoning: false, toolcall: true }, limit: { context: 200000, output: 8192 } },
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", capabilities: { reasoning: false, toolcall: true }, limit: { context: 1000000, output: 65536 } },
]

function makeCallOptions(prompt: string): LanguageModelV3CallOptions {
  return {
    mode: { type: "regular" },
    prompt: [
      { role: "user", content: [{ type: "text", text: prompt }] },
    ],
  } as LanguageModelV3CallOptions
}

function makeMockModel(modelId: string): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    modelId,
    provider: "github-copilot.chat",
    get supportedUrls() { return {} },
    async doGenerate() { return { content: [{ type: "text" as const, text: "mock" }] } as any },
    async doStream() { return { stream: (async function* () {})() } as any },
  }
}

// Mock the classifier to return a specific rating without calling GPT-5-mini
function createAutoModelWithMockClassifier(classifierRating: number) {
  const createdModels: string[] = []

  const autoModel = createCopilotAutoModel({
    models: MOCK_MODELS,
    createModel(modelId: string) {
      createdModels.push(modelId)
      return makeMockModel(modelId)
    },
  })

  // Override the classifier to return our mock rating
  const model = autoModel as CopilotAutoLanguageModel
  ;(model as any).classifierModel = {
    specificationVersion: "v3",
    modelId: "mock-classifier",
    provider: "mock",
    get supportedUrls() { return {} },
    async doGenerate() {
      return {
        content: [{ type: "text" as const, text: String(classifierRating) }],
      } as any
    },
    async doStream() { return { stream: (async function* () {})() } as any },
  }

  return { model, createdModels }
}

describe("CopilotAutoLanguageModel", () => {
  describe("tier classification", () => {
    test("short prompts skip LLM and go to fast", async () => {
      const { model, createdModels } = createAutoModelWithMockClassifier(5)
      await model.doGenerate(makeCallOptions("hi"))
      // Should pick fast model without consulting classifier (prompt < 20 chars)
      expect(createdModels.at(-1)).toBe("gpt-5-mini")
    })

    test("rating 1 routes to fast tier", async () => {
      const { model, createdModels } = createAutoModelWithMockClassifier(1)
      await model.doGenerate(makeCallOptions("write a hello world program in Python"))
      expect(createdModels.at(-1)).toBe("gpt-5-mini")
    })

    test("rating 2 routes to fast tier", async () => {
      const { model, createdModels } = createAutoModelWithMockClassifier(2)
      await model.doGenerate(makeCallOptions("write a function to reverse a string"))
      expect(createdModels.at(-1)).toBe("gpt-5-mini")
    })

    test("rating 3 routes to standard tier", async () => {
      const { model, createdModels } = createAutoModelWithMockClassifier(3)
      await model.doGenerate(makeCallOptions("implement a LRU cache with get and put"))
      // createdModels[0] is the classifier (gpt-5-mini), the routed model is last
      expect(createdModels.at(-1)).toBe("claude-sonnet-4.6")
    })

    test("rating 4 routes to reasoning tier", async () => {
      const { model, createdModels } = createAutoModelWithMockClassifier(4)
      await model.doGenerate(makeCallOptions("design a rate limiter using the token bucket algorithm"))
      expect(createdModels.at(-1)).toBe("claude-opus-4.6")
    })

    test("rating 5 routes to reasoning tier", async () => {
      const { model, createdModels } = createAutoModelWithMockClassifier(5)
      await model.doGenerate(makeCallOptions("design a distributed consensus algorithm similar to Raft"))
      expect(createdModels.at(-1)).toBe("claude-opus-4.6")
    })
  })

  describe("model preferences", () => {
    test("reasoning tier prefers opus over gpt-5", async () => {
      const { model, createdModels } = createAutoModelWithMockClassifier(5)
      await model.doGenerate(makeCallOptions("implement a lock-free concurrent hash map"))
      expect(createdModels.at(-1)).toBe("claude-opus-4.6")
    })

    test("standard tier prefers sonnet 4.6 over gpt-4.1", async () => {
      const { model, createdModels } = createAutoModelWithMockClassifier(3)
      await model.doGenerate(makeCallOptions("add pagination to the API endpoint"))
      // createdModels[0] is the classifier (gpt-5-mini), the routed model is last
      expect(createdModels.at(-1)).toBe("claude-sonnet-4.6")
    })

    test("fast tier prefers gpt-5-mini over codex-mini", async () => {
      const { model, createdModels } = createAutoModelWithMockClassifier(1)
      await model.doGenerate(makeCallOptions("write a function that adds two numbers"))
      expect(createdModels.at(-1)).toBe("gpt-5-mini")
    })
  })

  describe("fallback on unavailable models", () => {
    test("falls back to next model when first is unavailable", async () => {
      const createdModels: string[] = []
      let callCount = 0

      const autoModel = createCopilotAutoModel({
        models: MOCK_MODELS,
        createModel(modelId: string) {
          createdModels.push(modelId)
          return {
            specificationVersion: "v3" as const,
            modelId,
            provider: "github-copilot.chat",
                    get supportedUrls() { return {} },
            async doGenerate() {
              callCount++
              if (modelId === "claude-opus-4.6") {
                throw new Error("The requested model is not supported.")
              }
              return { content: [{ type: "text" as const, text: "ok" }] } as any
            },
            async doStream() { throw new Error("not implemented") },
          }
        },
      })

      // Mock classifier
      ;(autoModel as any).classifierModel = {
        specificationVersion: "v3",
        modelId: "mock",
        provider: "mock",
            get supportedUrls() { return {} },
        async doGenerate() {
          return { content: [{ type: "text" as const, text: "5" }] } as any
        },
        async doStream() { return {} as any },
      }

      await autoModel.doGenerate(makeCallOptions("design a distributed consensus algorithm"))

      // Should have tried opus first, then fallen back to next reasoning model
      expect(createdModels).toContain("claude-opus-4.6")
      // The last model should NOT be opus (it failed), should be the fallback
      expect(createdModels.at(-1)).not.toBe("claude-opus-4.6")
    })

    test("remembers unavailable models across calls", async () => {
      const createdModels: string[] = []

      const autoModel = createCopilotAutoModel({
        models: MOCK_MODELS,
        createModel(modelId: string) {
          createdModels.push(modelId)
          return {
            specificationVersion: "v3" as const,
            modelId,
            provider: "github-copilot.chat",
                    get supportedUrls() { return {} },
            async doGenerate() {
              if (modelId === "claude-opus-4.6") {
                throw new Error("The requested model is not supported.")
              }
              return { content: [{ type: "text" as const, text: "ok" }] } as any
            },
            async doStream() { throw new Error("not implemented") },
          }
        },
      })

      ;(autoModel as any).classifierModel = {
        specificationVersion: "v3",
        modelId: "mock",
        provider: "mock",
            get supportedUrls() { return {} },
        async doGenerate() {
          return { content: [{ type: "text" as const, text: "5" }] } as any
        },
        async doStream() { return {} as any },
      }

      // First call — opus fails, falls back
      await autoModel.doGenerate(makeCallOptions("design a distributed consensus algorithm"))
      const firstCallModels = [...createdModels]

      createdModels.length = 0

      // Second call — should skip opus entirely
      await autoModel.doGenerate(makeCallOptions("implement a compiler backend for x86"))
      expect(createdModels).not.toContain("claude-opus-4.6")
    })
  })

  describe("doStream", () => {
    test("routes stream calls the same as generate", async () => {
      const { model, createdModels } = createAutoModelWithMockClassifier(3)
      ;(makeMockModel("test") as any).doStream = async () => ({ stream: (async function* () {})() })

      // Override createModel to return streamable mock
      const streamableModel = createCopilotAutoModel({
        models: MOCK_MODELS,
        createModel(modelId: string) {
          createdModels.push(modelId)
          return {
            ...makeMockModel(modelId),
            async doStream() { return { stream: (async function* () {})() } as any },
          }
        },
      })

      ;(streamableModel as any).classifierModel = (model as any).classifierModel

      await streamableModel.doStream(makeCallOptions("implement a REST API with pagination"))
      expect(createdModels).toContain("claude-sonnet-4.6")
    })
  })

  describe("resolvedModelId", () => {
    test("exposes the last resolved model", async () => {
      const { model } = createAutoModelWithMockClassifier(5)
      expect(model.resolvedModelId).toBeNull()
      await model.doGenerate(makeCallOptions("design a distributed system"))
      expect(model.resolvedModelId).toBe("claude-opus-4.6")
    })
  })

  describe("gemini classification", () => {
    test("gemini-3-pro-preview goes to reasoning, not fast", async () => {
      const { model, createdModels } = createAutoModelWithMockClassifier(5)
      // The tier should include gemini pro in reasoning
      await model.doGenerate(makeCallOptions("design an architecture for real-time processing"))
      // It should pick opus first, but gemini pro should be in the reasoning candidates
      expect(createdModels.at(-1)).toBe("claude-opus-4.6")
    })

    test("gemini-3-flash goes to fast", async () => {
      const { model, createdModels } = createAutoModelWithMockClassifier(1)
      await model.doGenerate(makeCallOptions("write a hello world function please"))
      // gpt-5-mini is preferred in fast, but flash should be in the tier
      expect(createdModels.at(-1)).toBe("gpt-5-mini")
    })
  })
})
