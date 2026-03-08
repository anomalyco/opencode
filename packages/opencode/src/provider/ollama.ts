import { Log } from "../util/log"

const log = Log.create({ service: "ollama" })

export interface OllamaModel {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details?: {
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

export interface OllamaStatus {
  running: boolean
  url: string
  models: OllamaModel[]
}

const OLLAMA_DEFAULT_URL = "http://localhost:11434"
const OLLAMA_API_TAGS = "/api/tags"

export async function detect(url: string = OLLAMA_DEFAULT_URL): Promise<OllamaStatus> {
  const start = Date.now()

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    const response = await fetch(`${url}${OLLAMA_API_TAGS}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })

    clearTimeout(timeout)

    if (!response.ok) {
      log.info("ollama not responding", { url, status: response.status })
      return { running: false, url, models: [] }
    }

    const data = (await response.json()) as OllamaTagsResponse
    const models = data.models ?? []

    log.info("ollama detected", { url, modelCount: models.length, ms: Date.now() - start })

    return {
      running: true,
      url,
      models,
    }
  } catch (error) {
    const err = error as Error
    if (err.name === "AbortError") {
      log.info("ollama timeout", { url })
    } else {
      log.info("ollama not running", { url, error: err.message })
    }
    return { running: false, url, models: [] }
  }
}

export function parseModelName(fullName: string): { model: string; tag?: string } {
  const colonIndex = fullName.lastIndexOf(":")
  if (colonIndex === -1) {
    return { model: fullName }
  }
  return {
    model: fullName.substring(0, colonIndex),
    tag: fullName.substring(colonIndex + 1),
  }
}
