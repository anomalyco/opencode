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
      input_cost_per_token?: number | null
      output_cost_per_token?: number | null
      cache_read_input_token_cost?: number | null
      cache_creation_input_token_cost?: number | null
      input_cost_per_token_above_200k_tokens?: number | null
      output_cost_per_token_above_200k_tokens?: number | null
      max_tokens?: number | null
      max_input_tokens?: number | null
      max_output_tokens?: number | null
      supports_function_calling?: boolean | null
      supports_vision?: boolean | null
      supports_pdf_input?: boolean | null
      supports_audio_input?: boolean | null
      supports_audio_output?: boolean | null
      supports_video_input?: boolean | null
      supports_prompt_caching?: boolean | null
      supports_reasoning?: boolean | null
      supported_openai_params?: string[] | null
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

  function costPerMillion(costPerToken: number | null | undefined): number {
    if (!costPerToken) return 0
    return costPerToken * 1_000_000
  }

  function toModel(entry: ModelInfoEntry): Provider.Model | undefined {
    if (isWildcard(entry.model_name)) return undefined

    const info = entry.model_info ?? {}
    const underlyingModel = entry.litellm_params?.model

    const inputCost = costPerMillion(info.input_cost_per_token)
    const outputCost = costPerMillion(info.output_cost_per_token)
    const cacheReadCost = costPerMillion(info.cache_read_input_token_cost)
    const cacheWriteCost = costPerMillion(info.cache_creation_input_token_cost)

    const hasOver200K =
      info.input_cost_per_token_above_200k_tokens != null ||
      info.output_cost_per_token_above_200k_tokens != null

    const supportsVision = info.supports_vision === true
    const supportsPdf = info.supports_pdf_input === true
    const supportsTemperature = info.supported_openai_params?.includes("temperature") ?? true

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
      options: underlyingModel ? { underlyingModel } : {},
      cost: {
        input: inputCost,
        output: outputCost,
        cache: {
          read: cacheReadCost,
          write: cacheWriteCost,
        },
        experimentalOver200K: hasOver200K
          ? {
              input: costPerMillion(info.input_cost_per_token_above_200k_tokens),
              output: costPerMillion(info.output_cost_per_token_above_200k_tokens),
              cache: { read: 0, write: 0 },
            }
          : undefined,
      },
      limit: {
        context: (info.max_input_tokens ?? info.max_tokens ?? 128_000) as number,
        output: (info.max_output_tokens ?? 8_192) as number,
      },
      capabilities: {
        temperature: supportsTemperature,
        reasoning: info.supports_reasoning === true,
        attachment: supportsVision || supportsPdf,
        toolcall: info.supports_function_calling !== false,
        input: {
          text: true,
          audio: info.supports_audio_input === true,
          image: supportsVision,
          video: info.supports_video_input === true,
          pdf: supportsPdf,
        },
        output: {
          text: true,
          audio: info.supports_audio_output === true,
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

  function toBasicModel(id: string): Provider.Model {
    return {
      id,
      providerID: "litellm",
      name: id,
      api: { id, url: "", npm: "@ai-sdk/openai-compatible" },
      status: "active",
      headers: {},
      options: {},
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 128_000, output: 8_192 },
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      release_date: "",
      variants: {},
    }
  }

  async function fetchModelInfo(
    host: string,
    headers: Record<string, string>,
    timeout: number,
  ): Promise<Record<string, Provider.Model> | undefined> {
    const url = `${host}/model/info`
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeout),
    }).catch(() => undefined)

    if (!response?.ok) return undefined

    const data = (await response.json()) as { data?: ModelInfoEntry[] }
    const entries = data?.data
    if (!Array.isArray(entries)) return undefined

    const models: Record<string, Provider.Model> = {}
    for (const entry of entries) {
      const model = toModel(entry)
      if (model) models[model.id] = model
    }
    return Object.keys(models).length > 0 ? models : undefined
  }

  async function fetchModelList(
    host: string,
    headers: Record<string, string>,
    timeout: number,
  ): Promise<Record<string, Provider.Model>> {
    const url = `${host}/models`
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeout),
    }).catch(() => undefined)

    if (!response?.ok) return {}

    const data = (await response.json()) as { data?: { id: string }[] }
    const models: Record<string, Provider.Model> = {}
    for (const item of data?.data ?? []) {
      if (!item.id) continue
      models[item.id] = toBasicModel(item.id)
    }
    return models
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
    const base = host.replace(/\/+$/, "")

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options?.headers,
    }
    if (options?.apiKey) {
      headers["Authorization"] = `Bearer ${options.apiKey}`
    }

    try {
      // Try /model/info first for rich metadata, fall back to /models
      const rich = await fetchModelInfo(base, headers, timeout)
      if (rich) {
        log.info("discovered models from LiteLLM /model/info", {
          count: Object.keys(rich).length,
          host,
        })
        return rich
      }

      const basic = await fetchModelList(base, headers, timeout)
      if (Object.keys(basic).length > 0) {
        log.info("discovered models from /models (fallback)", {
          count: Object.keys(basic).length,
          host,
        })
        return basic
      }

      return undefined
    } catch (e) {
      log.warn("LiteLLM model discovery error", { error: e, host })
      return undefined
    }
  }
}
