/**
 * OpenRouter Provider - Access 400+ AI models through one unified API
 * https://openrouter.ai
 */

import { createOpenAI } from "@ai-sdk/openai"
import type { ModelsDev } from "./models"

export namespace OpenRouter {
  /**
   * Comprehensive catalog of the latest AI models available on OpenRouter (November 2025)
   * Based on research of current model availability
   */
  export const MODELS: Record<string, ModelsDev.Model> = {
    // ========== FLAGSHIP MODELS 2025 ==========

    // GPT-5 (Released August 2025)
    "gpt-5": {
      id: "openai/gpt-5",
      name: "GPT-5",
      release_date: "2025-08-07",
      attachment: true,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: {
        input: 1.25, // per 1M tokens
        output: 10.0,
      },
      limit: {
        context: 400_000,
        output: 16_384,
      },
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
    },
    "gpt-5-mini": {
      id: "openai/gpt-5-mini-2025-08-07",
      name: "GPT-5 Mini",
      release_date: "2025-08-07",
      attachment: true,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: {
        input: 0.15,
        output: 0.6,
      },
      limit: {
        context: 128_000,
        output: 16_384,
      },
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
    },

    // Claude 4.5 Sonnet (Released September 2025 - "Best coding model")
    "claude-4.5-sonnet": {
      id: "anthropic/claude-4.5-sonnet-20250929",
      name: "Claude 4.5 Sonnet",
      release_date: "2025-09-29",
      attachment: true,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: {
        input: 3.0,
        output: 15.0,
        cache_read: 0.3,
        cache_write: 3.75,
      },
      limit: {
        context: 200_000,
        output: 32_000,
      },
      modalities: {
        input: ["text", "image", "pdf"],
        output: ["text"],
      },
    },

    // Claude 4.1 Opus (Released August 2025 - Most capable)
    "claude-4.1-opus": {
      id: "anthropic/claude-4.1-opus",
      name: "Claude 4.1 Opus",
      release_date: "2025-08-05",
      attachment: true,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: {
        input: 15.0,
        output: 75.0,
        cache_read: 1.5,
        cache_write: 18.75,
      },
      limit: {
        context: 200_000,
        output: 32_000,
      },
      modalities: {
        input: ["text", "image", "pdf"],
        output: ["text"],
      },
    },

    // Claude 4 Sonnet
    "claude-4-sonnet": {
      id: "anthropic/claude-4-sonnet-20250522",
      name: "Claude 4 Sonnet",
      release_date: "2025-05-22",
      attachment: true,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: {
        input: 3.0,
        output: 15.0,
        cache_read: 0.3,
        cache_write: 3.75,
      },
      limit: {
        context: 200_000,
        output: 16_384,
      },
      modalities: {
        input: ["text", "image", "pdf"],
        output: ["text"],
      },
    },

    // Claude 4.5 Haiku (Fast and efficient)
    "claude-4.5-haiku": {
      id: "anthropic/claude-4.5-haiku",
      name: "Claude 4.5 Haiku",
      release_date: "2025-09-29",
      attachment: true,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: {
        input: 0.8,
        output: 4.0,
        cache_read: 0.08,
        cache_write: 1.0,
      },
      limit: {
        context: 200_000,
        output: 16_384,
      },
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
    },

    // Grok 4 Fast (xAI - Released July 2025)
    "grok-4-fast": {
      id: "x-ai/grok-4-fast",
      name: "Grok 4 Fast",
      release_date: "2025-07-01",
      attachment: true,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: {
        input: 2.0,
        output: 10.0,
      },
      limit: {
        context: 256_000,
        output: 32_768,
      },
      modalities: {
        input: ["text", "image"],
        output: ["text", "image", "video"],
      },
    },

    // Gemini 2.5 Pro (Google - Massive context window)
    "gemini-2.5-pro": {
      id: "google/gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      release_date: "2025-03-25",
      attachment: true,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: {
        input: 1.25,
        output: 5.0,
      },
      limit: {
        context: 1_000_000, // 1M token context!
        output: 8_192,
      },
      modalities: {
        input: ["text", "image", "video", "audio"],
        output: ["text"],
      },
    },

    // ========== FREE MODELS ==========

    // DeepSeek R1 (Free reasoning model - 671B parameters)
    "deepseek-r1": {
      id: "deepseek/deepseek-r1:free",
      name: "DeepSeek R1 (Free)",
      release_date: "2025-01-20",
      attachment: true,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: {
        input: 0.0,
        output: 0.0,
      },
      limit: {
        context: 164_000,
        output: 8_192,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
    },

    // DeepSeek R1 Distill Llama 70B (Free)
    "deepseek-r1-distill-llama-70b": {
      id: "deepseek/deepseek-r1-distill-llama-70b:free",
      name: "DeepSeek R1 Distill Llama 70B (Free)",
      release_date: "2025-01-20",
      attachment: true,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: {
        input: 0.0,
        output: 0.0,
      },
      limit: {
        context: 128_000,
        output: 8_192,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
    },

    // DeepSeek Chat V3 (Free - Great for coding)
    "deepseek-chat-v3": {
      id: "deepseek/deepseek-chat-v3-0324:free",
      name: "DeepSeek Chat V3 (Free)",
      release_date: "2025-03-24",
      attachment: true,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: {
        input: 0.0,
        output: 0.0,
      },
      limit: {
        context: 64_000,
        output: 8_192,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
    },

    // Gemini 2.0 Flash (Free)
    "gemini-2.0-flash": {
      id: "google/gemini-2.0-flash:free",
      name: "Gemini 2.0 Flash (Free)",
      release_date: "2024-12-11",
      attachment: true,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: {
        input: 0.0,
        output: 0.0,
      },
      limit: {
        context: 1_000_000,
        output: 8_192,
      },
      modalities: {
        input: ["text", "image", "audio"],
        output: ["text"],
      },
    },

    // Llama 3.3 70B Instruct (Free)
    "llama-3.3-70b": {
      id: "meta-llama/llama-3.3-70b-instruct:free",
      name: "Llama 3.3 70B Instruct (Free)",
      release_date: "2024-12-06",
      attachment: true,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: {
        input: 0.0,
        output: 0.0,
      },
      limit: {
        context: 128_000,
        output: 8_192,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
    },

    // Qwen QwQ 32B (Free reasoning model)
    "qwen-qwq-32b": {
      id: "qwen/qwq-32b:free",
      name: "Qwen QwQ 32B (Free)",
      release_date: "2024-11-27",
      attachment: true,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: {
        input: 0.0,
        output: 0.0,
      },
      limit: {
        context: 32_768,
        output: 8_192,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
    },

    // ========== POPULAR PAID MODELS ==========

    // GPT-4.1 Mini
    "gpt-4.1-mini": {
      id: "openai/gpt-4.1-mini-2025-04-14",
      name: "GPT-4.1 Mini",
      release_date: "2025-04-14",
      attachment: true,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: {
        input: 0.3,
        output: 1.2,
      },
      limit: {
        context: 128_000,
        output: 16_384,
      },
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
    },

    // GPT-4o
    "gpt-4o": {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      release_date: "2024-05-13",
      attachment: true,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: {
        input: 2.5,
        output: 10.0,
      },
      limit: {
        context: 128_000,
        output: 16_384,
      },
      modalities: {
        input: ["text", "image", "audio"],
        output: ["text"],
      },
    },

    // Llama 4 Maverick (Latest from Meta)
    "llama-4-maverick": {
      id: "meta-llama/llama-4-maverick:free",
      name: "Llama 4 Maverick (Free)",
      release_date: "2025-11-01",
      attachment: true,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: {
        input: 0.0,
        output: 0.0,
      },
      limit: {
        context: 128_000,
        output: 8_192,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
    },
  }

  /**
   * Create OpenRouter provider instance
   */
  export function createProvider(config: { apiKey?: string; baseURL?: string } = {}) {
    const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || ""
    const baseURL = config.baseURL || "https://openrouter.ai/api/v1"

    return createOpenAI({
      apiKey,
      baseURL,
      headers: {
        "HTTP-Referer": "https://opencode.ai",
        "X-Title": "OpenCode CLI",
      },
    })
  }

  /**
   * Get model info by ID
   */
  export function getModel(modelId: string): ModelsDev.Model | undefined {
    return Object.values(MODELS).find((m) => m.id === modelId || m.id.endsWith(modelId))
  }

  /**
   * List all available models
   */
  export function listModels(): ModelsDev.Model[] {
    return Object.values(MODELS)
  }

  /**
   * List free models only
   */
  export function listFreeModels(): ModelsDev.Model[] {
    return Object.values(MODELS).filter((m) => m.cost.input === 0 && m.cost.output === 0)
  }

  /**
   * List flagship models (latest and greatest)
   */
  export function listFlagshipModels(): ModelsDev.Model[] {
    return [
      MODELS["gpt-5"],
      MODELS["claude-4.5-sonnet"],
      MODELS["claude-4.1-opus"],
      MODELS["grok-4-fast"],
      MODELS["gemini-2.5-pro"],
    ]
  }

  /**
   * Get recommended model for coding
   */
  export function getRecommendedForCoding(): ModelsDev.Model {
    return MODELS["claude-4.5-sonnet"] // Best coding model according to benchmarks
  }

  /**
   * Get recommended free model
   */
  export function getRecommendedFree(): ModelsDev.Model {
    return MODELS["deepseek-r1"] // Best free model with reasoning
  }
}
