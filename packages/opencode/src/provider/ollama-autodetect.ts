import { Log } from "../util/log"
import { Config } from "../config/config"
import type { Provider } from "../provider/provider"

const log = Log.create({ service: "ollama-autodetect" })

export interface OllamaModel {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
}

export interface OllamaTagsResponse {
  models: OllamaModel[]
}

const REASONING_FAMILIES = [
  "deepseek2",
  "qwen3",
  "gptoss",
  "r1",
]

const CODING_FAMILIES = [
  "qwen3moe",
  "coder",
]

function detectModelCapabilities(model: OllamaModel): {
  reasoning: boolean
  coding: boolean
  supportsImages: boolean
} {
  const family = model.details.family?.toLowerCase() ?? ""
  const families = model.details.families?.map(f => f.toLowerCase()) ?? []
  const name = model.name.toLowerCase()

  const isReasoning = 
    REASONING_FAMILIES.some(f => family.includes(f) || families.some(fam => fam.includes(f))) ||
    name.includes("r1") ||
    name.includes("reasoning") ||
    name.includes("think")

  const isCoding = 
    CODING_FAMILIES.some(f => family.includes(f) || families.some(fam => fam.includes(f))) ||
    name.includes("coder") ||
    name.includes("code")

  const supportsImages = 
    family.includes("llama") ||
    family.includes("gemma") ||
    family.includes("qwen") ||
    name.includes("vision") ||
    name.includes("vl")

  return {
    reasoning: isReasoning,
    coding: isCoding,
    supportsImages,
  }
}

export async function detectLocalOllamaModels(baseURL?: string): Promise<OllamaModel[]> {
  try {
    const url = baseURL ?? "http://localhost:11434"
    const timeout = 5000

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(`${url}/api/tags`, {
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      log.warn("Ollama API returned non-ok status", { status: response.status })
      return []
    }

    const data = (await response.json()) as OllamaTagsResponse
    log.info("Detected Ollama models", { count: data.models.length })
    return data.models
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      log.warn("Ollama detection timed out")
    } else {
      log.warn("Failed to detect Ollama models", { error })
    }
    return []
  }
}

export async function registerOllamaModels() {
  const models = await detectLocalOllamaModels()
  
  if (models.length === 0) {
    return
  }

  const cfg = await Config.get()
  const ollamaModels: Record<string, any> = {}

  for (const model of models) {
    const capabilities = detectModelCapabilities(model)
    const modelName = model.name.replace(/:/g, "-").replace(/\//g, "-")
    
    ollamaModels[modelName] = {
      id: model.name,
      name: model.name,
      family: model.details.family,
      reasoning: capabilities.reasoning,
      attachment: capabilities.supportsImages,
      temperature: true,
      tool_call: true,
      interleaved: capabilities.reasoning,
      cost: {
        input: 0,
        output: 0,
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      modalities: {
        input: capabilities.supportsImages 
          ? ["text", "image"] 
          : ["text"],
        output: ["text"],
      },
      options: {
        model: model.name,
      },
    }

    log.info("Registered Ollama model", { 
      name: model.name, 
      reasoning: capabilities.reasoning,
      coding: capabilities.coding,
    })
  }

  const existingProvider = cfg.provider?.["ollama"] ?? {}
  
  return {
    provider: {
      ...existingProvider,
      name: existingProvider.name ?? "Ollama (Local)",
      api: existingProvider.api ?? "http://localhost:11434/v1",
      npm: existingProvider.npm ?? "@ai-sdk/openai-compatible",
      models: ollamaModels,
    }
  }
}

export function convertOllamaModelToModel(model: OllamaModel): Provider.Model {
  const capabilities = detectModelCapabilities(model)
  const modelId = model.name.replace(/:/g, "-").replace(/\//g, "-")
  
  return {
    id: modelId,
    providerID: "ollama",
    name: model.name,
    family: model.details.family,
    api: {
      id: model.name,
      url: "http://localhost:11434/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    capabilities: {
      temperature: true,
      reasoning: capabilities.reasoning,
      attachment: capabilities.supportsImages,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: capabilities.supportsImages,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: capabilities.reasoning,
    },
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context: 128000,
      output: 8192,
    },
    status: "active",
    options: {
      model: model.name,
    },
    headers: {},
    release_date: model.modified_at,
  }
}
