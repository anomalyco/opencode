import { Log } from "../util"

const log = Log.create({ service: "model-cache" })

export namespace ModelCache {
  const cache: Record<string, Record<string, any>> = {}

  export async function fetch(providerID: string, options: { baseURL?: string; apiKey?: string } = {}): Promise<Record<string, any>> {
    if (cache[providerID]) return cache[providerID]

    if (providerID === "apertis") {
      return fetchApertisModels(options)
    }

    if (providerID === "lmstudio") {
      return fetchOpenAICompatibleModels(options)
    }

    return {}
  }

  export async function refresh(providerID: string, options: { baseURL?: string; apiKey?: string } = {}): Promise<Record<string, any>> {
    const result = await fetch(providerID, options)
    if (Object.keys(result).length > 0) {
      cache[providerID] = result
    }
    return result
  }

  const APERTIS_BASE_URL = "https://api.apertis.ai/v1"

  async function fetchOpenAICompatibleModels(options: { baseURL?: string; apiKey?: string }): Promise<Record<string, any>> {
    const baseURL = options.baseURL ?? "http://127.0.0.1:1234/v1"
    const apiKey = options.apiKey

    const url = `${baseURL.replace(/\/+$/, "")}/models`

    try {
      const response = await Bun.fetch(url, {
        method: "GET",
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) {
        log.error("openai-compatible model fetch failed", { url, status: response.status })
        return {}
      }

      const json = await response.json() as { data?: Array<{ id: string; owned_by?: string }> }

      const models: Record<string, any> = {}
      for (const model of json.data ?? []) {
        models[model.id] = {
          id: model.id,
          name: model.id,
          family: model.owned_by ?? "",
          release_date: "",
          attachment: true,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 0, output: 0 },
          limit: { context: 128000, output: 4096 },
          options: {},
          modalities: {
            input: ["text", "image"],
            output: ["text"],
          },
        }
      }

      return models
    } catch (error) {
      log.error("openai-compatible model fetch error", { url, error })
      return {}
    }
  }

  async function fetchApertisModels(options: { baseURL?: string; apiKey?: string }): Promise<Record<string, any>> {
    return fetchOpenAICompatibleModels({
      baseURL: options.baseURL ?? APERTIS_BASE_URL,
      apiKey: options.apiKey,
    })
  }
}
