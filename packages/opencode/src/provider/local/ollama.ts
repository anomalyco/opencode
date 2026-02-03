import { type LocalModel } from "./index"

export interface OllamaModelDetails {
  parent_model?: string
  format?: string
  family?: string
  families?: string[]
  parameter_size?: string
  quantization_level?: string
}

export interface OllamaLoadedModel {
  name: string
  model: string
  size: number
  digest: string
  details?: OllamaModelDetails
  expires_at?: string
  size_vram: number
  context_length: number
}

export interface OllamaLoadedModelsResponse {
  models: OllamaLoadedModel[]
}

export interface OllamaModelShowResponse {
  parameters?: string
  license?: string
  capabilities?: string[]
  modified_at?: string
  details?: OllamaModelDetails
  template?: string
  model_info?: Record<string, any>
}

async function ollama_show_model(url: string, model: string): Promise<OllamaModelShowResponse> {
  const endpoint = url.replace(/\/$/, "") + "/api/show"

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(3000),
  })

  if (!res.ok) {
    const respText = await res.text()
    throw new Error(`Ollama show model failed with status ${res.status}: ${respText}`)
  }

  return res.json() as Promise<OllamaModelShowResponse>
}

export async function ollama_detect_provider(url: string): Promise<boolean> {
  const endpoint = url.replace(/\/$/, "") + "/"

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) {
      return false
    }

    return await res.text() === "Ollama is running"
  } catch (e) {
    return false
  }
}

export async function ollama_probe_loaded_models(url: string): Promise<LocalModel[]> {
  const endpoint = url.replace(/\/$/, "") + "/api/ps"

  const res = await fetch(endpoint, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) {
    const respText = await res.text()
    throw new Error(`Ollama probe failed with status ${res.status}: ${respText}`)
  }

  const body = (await res.json()) as OllamaLoadedModelsResponse
  if (body.models === undefined) {
    throw new Error("Ollama probe failed: no models field in response")
  }

  const models: LocalModel[] = await Promise.all(
    body.models.map(async (m) => {
      const show = await ollama_show_model(url, m.model).catch(() => ({} as OllamaModelShowResponse))
      const caps = show.capabilities ?? []

      return {
        id: m.name,
        context_length: m.context_length,
        tool_call: caps.includes("tools"),
        vision: caps.includes("vision"),
      }
    })
  )

  return models
}
