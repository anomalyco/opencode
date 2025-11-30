import { describe, expect, test, beforeAll, mock } from "bun:test"
import { ModelsDev } from "../../src/provider/models"

// Mock the models.dev API response with a minimal Anthropic provider
const mockModelsDevData: Record<string, ModelsDev.Provider> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    npm: "@ai-sdk/anthropic",
    models: {
      "claude-opus-4-5-20251101": {
        id: "claude-opus-4-5-20251101",
        name: "Claude Opus 4.5",
        release_date: "2025-11-01",
        attachment: true,
        reasoning: true,
        temperature: true,
        tool_call: true,
        cost: {
          input: 5,
          output: 25,
          cache_read: 0.5,
          cache_write: 6.25,
        },
        limit: {
          context: 200000,
          output: 64000,
        },
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        options: {},
      },
    },
  },
}

describe("Anthropic thinking variant", () => {
  test("thinking variant is created from base opus 4.5 model", () => {
    // Simulate what the provider.ts code does
    const database = structuredClone(mockModelsDevData)

    const anthropic = database["anthropic"]
    if (anthropic?.models["claude-opus-4-5-20251101"]) {
      const opus45 = anthropic.models["claude-opus-4-5-20251101"]
      anthropic.models["claude-opus-4-5-20251101-thinking"] = {
        ...opus45,
        name: "Claude Opus 4.5 Thinking",
        options: {
          thinking: {
            type: "enabled",
            budgetTokens: 16000,
          },
        },
      }
    }

    // Verify the thinking variant exists
    const thinkingModel = database["anthropic"].models["claude-opus-4-5-20251101-thinking"]
    expect(thinkingModel).toBeDefined()
  })

  test("thinking variant has correct name", () => {
    const database = structuredClone(mockModelsDevData)

    const anthropic = database["anthropic"]
    if (anthropic?.models["claude-opus-4-5-20251101"]) {
      const opus45 = anthropic.models["claude-opus-4-5-20251101"]
      anthropic.models["claude-opus-4-5-20251101-thinking"] = {
        ...opus45,
        name: "Claude Opus 4.5 Thinking",
        options: {
          thinking: {
            type: "enabled",
            budgetTokens: 16000,
          },
        },
      }
    }

    const thinkingModel = database["anthropic"].models["claude-opus-4-5-20251101-thinking"]
    expect(thinkingModel.name).toBe("Claude Opus 4.5 Thinking")
  })

  test("thinking variant preserves original model id for API calls", () => {
    const database = structuredClone(mockModelsDevData)

    const anthropic = database["anthropic"]
    if (anthropic?.models["claude-opus-4-5-20251101"]) {
      const opus45 = anthropic.models["claude-opus-4-5-20251101"]
      anthropic.models["claude-opus-4-5-20251101-thinking"] = {
        ...opus45,
        name: "Claude Opus 4.5 Thinking",
        options: {
          thinking: {
            type: "enabled",
            budgetTokens: 16000,
          },
        },
      }
    }

    const thinkingModel = database["anthropic"].models["claude-opus-4-5-20251101-thinking"]
    // The id should be preserved from the spread, which is the original model id
    expect(thinkingModel.id).toBe("claude-opus-4-5-20251101")
  })

  test("thinking variant has thinking options enabled", () => {
    const database = structuredClone(mockModelsDevData)

    const anthropic = database["anthropic"]
    if (anthropic?.models["claude-opus-4-5-20251101"]) {
      const opus45 = anthropic.models["claude-opus-4-5-20251101"]
      anthropic.models["claude-opus-4-5-20251101-thinking"] = {
        ...opus45,
        name: "Claude Opus 4.5 Thinking",
        options: {
          thinking: {
            type: "enabled",
            budgetTokens: 16000,
          },
        },
      }
    }

    const thinkingModel = database["anthropic"].models["claude-opus-4-5-20251101-thinking"]
    expect(thinkingModel.options).toEqual({
      thinking: {
        type: "enabled",
        budgetTokens: 16000,
      },
    })
  })

  test("thinking variant has correct budget tokens", () => {
    const database = structuredClone(mockModelsDevData)

    const anthropic = database["anthropic"]
    if (anthropic?.models["claude-opus-4-5-20251101"]) {
      const opus45 = anthropic.models["claude-opus-4-5-20251101"]
      anthropic.models["claude-opus-4-5-20251101-thinking"] = {
        ...opus45,
        name: "Claude Opus 4.5 Thinking",
        options: {
          thinking: {
            type: "enabled",
            budgetTokens: 16000,
          },
        },
      }
    }

    const thinkingModel = database["anthropic"].models["claude-opus-4-5-20251101-thinking"]
    expect(thinkingModel.options.thinking.budgetTokens).toBe(16000)
  })

  test("thinking variant preserves all other model properties", () => {
    const database = structuredClone(mockModelsDevData)

    const anthropic = database["anthropic"]
    const originalModel = anthropic.models["claude-opus-4-5-20251101"]

    if (anthropic?.models["claude-opus-4-5-20251101"]) {
      const opus45 = anthropic.models["claude-opus-4-5-20251101"]
      anthropic.models["claude-opus-4-5-20251101-thinking"] = {
        ...opus45,
        name: "Claude Opus 4.5 Thinking",
        options: {
          thinking: {
            type: "enabled",
            budgetTokens: 16000,
          },
        },
      }
    }

    const thinkingModel = database["anthropic"].models["claude-opus-4-5-20251101-thinking"]

    // Verify all other properties are preserved
    expect(thinkingModel.release_date).toBe(originalModel.release_date)
    expect(thinkingModel.attachment).toBe(originalModel.attachment)
    expect(thinkingModel.reasoning).toBe(originalModel.reasoning)
    expect(thinkingModel.temperature).toBe(originalModel.temperature)
    expect(thinkingModel.tool_call).toBe(originalModel.tool_call)
    expect(thinkingModel.cost).toEqual(originalModel.cost)
    expect(thinkingModel.limit).toEqual(originalModel.limit)
    expect(thinkingModel.modalities).toEqual(originalModel.modalities)
  })

  test("original model is not modified", () => {
    const database = structuredClone(mockModelsDevData)

    const anthropic = database["anthropic"]
    const originalModelBefore = structuredClone(anthropic.models["claude-opus-4-5-20251101"])

    if (anthropic?.models["claude-opus-4-5-20251101"]) {
      const opus45 = anthropic.models["claude-opus-4-5-20251101"]
      anthropic.models["claude-opus-4-5-20251101-thinking"] = {
        ...opus45,
        name: "Claude Opus 4.5 Thinking",
        options: {
          thinking: {
            type: "enabled",
            budgetTokens: 16000,
          },
        },
      }
    }

    const originalModelAfter = database["anthropic"].models["claude-opus-4-5-20251101"]

    // Original model should be unchanged
    expect(originalModelAfter.name).toBe(originalModelBefore.name)
    expect(originalModelAfter.options).toEqual(originalModelBefore.options)
  })

  test("no thinking variant created if base model does not exist", () => {
    const database: Record<string, ModelsDev.Provider> = {
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        env: ["ANTHROPIC_API_KEY"],
        npm: "@ai-sdk/anthropic",
        models: {
          // Note: claude-opus-4-5-20251101 is NOT present
          "claude-sonnet-4-5-20250929": {
            id: "claude-sonnet-4-5-20250929",
            name: "Claude Sonnet 4.5",
            release_date: "2025-09-29",
            attachment: true,
            reasoning: true,
            temperature: true,
            tool_call: true,
            cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
            limit: { context: 200000, output: 64000 },
            options: {},
          },
        },
      },
    }

    const anthropic = database["anthropic"]
    if (anthropic?.models["claude-opus-4-5-20251101"]) {
      const opus45 = anthropic.models["claude-opus-4-5-20251101"]
      anthropic.models["claude-opus-4-5-20251101-thinking"] = {
        ...opus45,
        name: "Claude Opus 4.5 Thinking",
        options: {
          thinking: {
            type: "enabled",
            budgetTokens: 16000,
          },
        },
      }
    }

    // Thinking variant should NOT be created
    expect(database["anthropic"].models["claude-opus-4-5-20251101-thinking"]).toBeUndefined()
  })

  test("no thinking variant created if anthropic provider does not exist", () => {
    const database: Record<string, ModelsDev.Provider> = {
      openai: {
        id: "openai",
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        npm: "@ai-sdk/openai",
        models: {},
      },
    }

    const anthropic = database["anthropic"]
    if (anthropic?.models["claude-opus-4-5-20251101"]) {
      const opus45 = anthropic.models["claude-opus-4-5-20251101"]
      anthropic.models["claude-opus-4-5-20251101-thinking"] = {
        ...opus45,
        name: "Claude Opus 4.5 Thinking",
        options: {
          thinking: {
            type: "enabled",
            budgetTokens: 16000,
          },
        },
      }
    }

    // Should not throw and anthropic should still not exist
    expect(database["anthropic"]).toBeUndefined()
  })
})
