import type { ModelsDev } from "./models"

export namespace Meganova {
  export const PROVIDER_ID = "meganova"
  export const API_URL = "https://api.meganova.ai/v1"
  export const ENV_KEY = "MEGANOVA_API_KEY"

  function model(
    id: string,
    name: string,
    opts: {
      family?: string
      context: number
      output: number
      input_cost: number
      output_cost: number
      toolcall?: boolean
      reasoning?: boolean
      attachment?: boolean
      image?: boolean
      temperature?: boolean
    },
  ): ModelsDev.Model {
    return {
      id,
      name,
      family: opts.family,
      release_date: "2025-01-01",
      attachment: opts.attachment ?? (opts.image ?? false),
      reasoning: opts.reasoning ?? false,
      temperature: opts.temperature ?? true,
      tool_call: opts.toolcall ?? true,
      cost: {
        input: opts.input_cost,
        output: opts.output_cost,
      },
      limit: {
        context: opts.context,
        output: opts.output,
      },
      modalities: {
        input: opts.image ? ["text", "image"] : ["text"],
        output: ["text"],
      },
      options: {},
    }
  }

  export function provider(): ModelsDev.Provider {
    return {
      id: PROVIDER_ID,
      name: "Meganova",
      api: API_URL,
      npm: "@ai-sdk/openai-compatible",
      env: [ENV_KEY],
      models: {
        // Anthropic Claude models
        "anthropic/claude-opus-4-6": model("anthropic/claude-opus-4-6", "Claude Opus 4.6", {
          family: "claude",
          context: 1000000,
          output: 32000,
          input_cost: 4.0,
          output_cost: 20.0,
          reasoning: true,
          image: true,
          attachment: true,
        }),
        "anthropic/claude-sonnet-4-5-20250929": model(
          "anthropic/claude-sonnet-4-5-20250929",
          "Claude Sonnet 4.5",
          {
            family: "claude",
            context: 1000000,
            output: 16000,
            input_cost: 2.4,
            output_cost: 12.0,
            reasoning: true,
            image: true,
            attachment: true,
          },
        ),
        "anthropic/claude-haiku-4-5-20251001": model(
          "anthropic/claude-haiku-4-5-20251001",
          "Claude Haiku 4.5",
          {
            family: "claude",
            context: 200000,
            output: 8192,
            input_cost: 0.8,
            output_cost: 4.0,
            image: true,
            attachment: true,
          },
        ),
        "anthropic/claude-opus-4-5-20251101": model(
          "anthropic/claude-opus-4-5-20251101",
          "Claude Opus 4.5",
          {
            family: "claude",
            context: 200000,
            output: 32000,
            input_cost: 4.0,
            output_cost: 20.0,
            reasoning: true,
            image: true,
            attachment: true,
          },
        ),

        // OpenAI GPT models
        "openai/gpt-5.2": model("openai/gpt-5.2", "GPT-5.2", {
          family: "gpt",
          context: 400000,
          output: 16384,
          input_cost: 1.4,
          output_cost: 11.2,
          reasoning: true,
          image: true,
          attachment: true,
        }),
        "openai/gpt-5.1": model("openai/gpt-5.1", "GPT-5.1", {
          family: "gpt",
          context: 400000,
          output: 16384,
          input_cost: 1.0,
          output_cost: 8.0,
          reasoning: true,
          image: true,
          attachment: true,
        }),
        "openai/gpt-5": model("openai/gpt-5", "GPT-5", {
          family: "gpt",
          context: 400000,
          output: 16384,
          input_cost: 1.0,
          output_cost: 8.0,
          reasoning: true,
          image: true,
          attachment: true,
        }),
        "openai/gpt-5-mini": model("openai/gpt-5-mini", "GPT-5 Mini", {
          family: "gpt",
          context: 400000,
          output: 16384,
          input_cost: 0.2,
          output_cost: 1.6,
          image: true,
          attachment: true,
        }),
        "openai/gpt-5-nano": model("openai/gpt-5-nano", "GPT-5 Nano", {
          family: "gpt",
          context: 400000,
          output: 16384,
          input_cost: 0.04,
          output_cost: 0.32,
          image: true,
          attachment: true,
        }),
        "openai/gpt-4o-mini": model("openai/gpt-4o-mini", "GPT-4o Mini", {
          family: "gpt",
          context: 128000,
          output: 16384,
          input_cost: 0.12,
          output_cost: 0.48,
          image: true,
          attachment: true,
        }),

        // Google Gemini models
        "gemini/gemini-3-pro-preview": model("gemini/gemini-3-pro-preview", "Gemini 3 Pro", {
          family: "gemini",
          context: 1048576,
          output: 65536,
          input_cost: 1.6,
          output_cost: 9.6,
          reasoning: true,
          image: true,
          attachment: true,
        }),
        "gemini/gemini-3-flash-preview": model("gemini/gemini-3-flash-preview", "Gemini 3 Flash", {
          family: "gemini",
          context: 1048576,
          output: 65536,
          input_cost: 0.4,
          output_cost: 2.4,
          image: true,
          attachment: true,
        }),
        "gemini/gemini-2.5-pro": model("gemini/gemini-2.5-pro", "Gemini 2.5 Pro", {
          family: "gemini",
          context: 1048576,
          output: 65536,
          input_cost: 1.0,
          output_cost: 8.0,
          reasoning: true,
          image: true,
          attachment: true,
        }),
        "gemini/gemini-2.5-flash": model("gemini/gemini-2.5-flash", "Gemini 2.5 Flash", {
          family: "gemini",
          context: 1048576,
          output: 65536,
          input_cost: 0.24,
          output_cost: 2.0,
          reasoning: true,
          image: true,
          attachment: true,
        }),
        "gemini/gemini-2.5-flash-lite": model("gemini/gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite", {
          family: "gemini",
          context: 1048576,
          output: 65536,
          input_cost: 0.08,
          output_cost: 0.32,
          image: true,
          attachment: true,
        }),

        // xAI
        "x-ai/grok-4-fast": model("x-ai/grok-4-fast", "Grok 4 Fast", {
          family: "grok",
          context: 2000000,
          output: 16384,
          input_cost: 0.2,
          output_cost: 0.5,
          image: true,
          attachment: true,
        }),

        // DeepSeek
        "deepseek-ai/DeepSeek-V3.2": model("deepseek-ai/DeepSeek-V3.2", "DeepSeek V3.2", {
          family: "deepseek",
          context: 163840,
          output: 8192,
          input_cost: 0.26,
          output_cost: 0.38,
        }),

        // GLM models
        "zai-org/GLM-5": model("zai-org/GLM-5", "GLM-5", {
          family: "glm",
          context: 202752,
          output: 8192,
          input_cost: 0.8,
          output_cost: 2.56,
        }),
        "zai-org/GLM-4.7": model("zai-org/GLM-4.7", "GLM-4.7", {
          family: "glm",
          context: 202752,
          output: 8192,
          input_cost: 0.2,
          output_cost: 0.8,
        }),

        // Qwen
        "Qwen/Qwen3-235B-A22B-Instruct-2507": model(
          "Qwen/Qwen3-235B-A22B-Instruct-2507",
          "Qwen3 235B",
          {
            family: "qwen",
            context: 262144,
            output: 8192,
            input_cost: 0.09,
            output_cost: 0.57,
          },
        ),

        // Moonshot Kimi
        "moonshotai/Kimi-K2.5": model("moonshotai/Kimi-K2.5", "Kimi K2.5", {
          family: "kimi",
          context: 262144,
          output: 8192,
          input_cost: 0.4,
          output_cost: 2.2,
          image: true,
          attachment: true,
        }),
        "moonshotai/Kimi-K2-Thinking": model("moonshotai/Kimi-K2-Thinking", "Kimi K2 Thinking", {
          family: "kimi",
          context: 262144,
          output: 8192,
          input_cost: 0.6,
          output_cost: 2.6,
          reasoning: true,
        }),

        // MiniMax
        "MiniMaxAI/MiniMax-M2.5": model("MiniMaxAI/MiniMax-M2.5", "MiniMax M2.5", {
          family: "minimax",
          context: 204800,
          output: 8192,
          input_cost: 0.3,
          output_cost: 1.2,
        }),

        // Xiaomi MiMo
        "XiaomiMiMo/MiMo-V2-Flash": model("XiaomiMiMo/MiMo-V2-Flash", "MiMo V2 Flash", {
          family: "mimo",
          context: 262144,
          output: 8192,
          input_cost: 0.1,
          output_cost: 0.3,
        }),
      },
    }
  }
}
