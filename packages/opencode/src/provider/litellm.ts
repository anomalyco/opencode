import { Log } from "../util/log"
import { Env } from "../env"
import type { Provider } from "./provider"

export namespace LiteLLM {
  const log = Log.create({ service: "litellm" })

  interface ModelInfoEntry {
    model_name: string
    litellm_params?: {
      model?: string
      [key: string]: unknown
    }
    model_info?: {
      id?: string
      input_cost_per_token?: number
      output_cost_per_token?: number
      cache_read_input_token_cost?: number
      cache_creation_input_token_cost?: number
      max_tokens?: number
      max_input_tokens?: number
      max_output_tokens?: number
      supports_function_calling?: boolean
      supports_vision?: boolean
      supports_pdf_input?: boolean
      supports_audio_input?: boolean
      supports_audio_output?: boolean
      supports_video_input?: boolean
      supports_prompt_caching?: boolean
      supports_reasoning?: boolean
      [key: string]: unknown
    }
  }

  const INTERLEAVED_MODELS = ["claude", "anthropic"]

  function isWildcard(name: string): boolean {
    return name.includes("*") || name.includes("/*")
  }

  function inferInterleaved(
    underlyingModel: string | undefined,
  ): Provider.Model["capabilities"]["interleaved"] {
    if (!underlyingModel) return false
    const lower = underlyingModel.toLowerCase()
    if (INTERLEAVED_MODELS.some((m) => lower.includes(m))) return true
    return false
  }

  function toModel(entry: ModelInfoEntry): Provider.Model | undefined {
    if (isWildcard(entry.model_name)) return undefined

    const info = entry.model_info ?? {}
    const underlyingModel = entry.litellm_params?.model

    const inputCost = (info.input_cost_per_token ?? 0) * 1_000_000
    const outputCost = (info.output_cost_per_token ?? 0) * 1_000_000
    const cacheReadCost = (info.cache_read_input_token_cost ?? 0) * 1_000_000
    const cacheWriteCost = (info.cache_creation_input_token_cost ?? 0) * 1_000_000

    return {
      id: entry.model_name,
      providerID: "litellm",
      name: entry.model_name,
      api: {
        id: entry.model_name,
        url: "",
        npm: "@ai-sdk/openai-compatible",
      },
      status: "active",
      headers: {},
      options: {},
      cost: {
        input: inputCost,
        output: outputCost,
        cache: {
          read: cacheReadCost,
          write: cacheWriteCost,
        },
      },
      limit: {
        context: (info.max_tokens ?? info.max_input_tokens ?? 128_000) as number,
        output: (info.max_output_tokens ?? 8_192) as number,
      },
      capabilities: {
        temperature: true,
        reasoning: info.supports_reasoning ?? false,
        attachment: (info.supports_vision || info.supports_pdf_input) ?? false,
        toolcall: info.supports_function_calling ?? true,
        input: {
          text: true,
          audio: info.supports_audio_input ?? false,
          image: info.supports_vision ?? false,
          video: info.supports_video_input ?? false,
          pdf: info.supports_pdf_input ?? false,
        },
        output: {
          text: true,
          audio: info.supports_audio_output ?? false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: inferInterleaved(underlyingModel),
      },
      release_date: "",
      variants: {},
    }
  }

  export async function discover(
    host: string,
    options?: {
      apiKey?: string
      headers?: Record<string, string>
      timeout?: number
    },
  ): Promise<Record<string, Provider.Model> | undefined> {
    const timeout = options?.timeout ?? Number(Env.get("LITELLM_TIMEOUT") ?? "5000")
    const url = `${host.replace(/\/+$/, "")}/model/info`

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...options?.headers,
      }
      if (options?.apiKey) {
        headers["Authorization"] = `Bearer ${options.apiKey}`
      }

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeout),
      })

      if (!response.ok) {
        log.warn("LiteLLM model discovery failed", {
          status: response.status,
          url,
        })
        return undefined
      }

      const data = (await response.json()) as { data?: ModelInfoEntry[] }
      const entries = data?.data
      if (!Array.isArray(entries)) {
        log.warn("LiteLLM /model/info returned unexpected format", { url })
        return undefined
      }

      const models: Record<string, Provider.Model> = {}
      for (const entry of entries) {
        const model = toModel(entry)
        if (model) {
          models[model.id] = model
        }
      }

      log.info("discovered models from LiteLLM proxy", {
        count: Object.keys(models).length,
        host,
      })

      return models
    } catch (e) {
      log.warn("LiteLLM model discovery error", { error: e, url })
      return undefined
    }
  }
}
