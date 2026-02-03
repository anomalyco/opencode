import { ca } from "zod/v4/locales"
import { type LocalModel } from "./index"

export interface LMStudioModel {
  id: string
  object: "model"
  type: "llm" | "vlm" | "embeddings"
  publisher: string
  arch: string
  compatibility_type: string
  quantization: string
  state: "loaded" | "loading" | "not-loaded"
  max_context_length: number
  loaded_context_length?: number
  capabilities?: string[]
}

export interface LMStudioModelsResponse {
  data: LMStudioModel[]
  object: "list"
}

// Documented here: https://github.com/lmstudio-ai/lms/blob/main/src/createClient.ts#L18
interface LMStudioGreeting {
  lmstudio: boolean
}

export async function lmstudio_detect_provider(url: string): Promise<boolean> {
  try {
    const endpoint = url.replace(/\/$/, "") + "/lmstudio-greeting"
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) {
      return false
    }

    const greeting = await res.json() as LMStudioGreeting
    return greeting.lmstudio === true
  }
  catch (e) {
    return false
  }
}

export async function lmstudio_probe_loaded_models(url: string): Promise<LocalModel[]> {
  const endpoint = url.replace(/\/$/, "") + "/api/v0/models"

  const res = await fetch(endpoint, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) {
    const respText = await res.text()
    throw new Error(`LMStudio probe failed with status ${res.status}: ${respText}`)
  }

  const body = (await res.json()) as LMStudioModelsResponse
  if (!body.data) {
    throw new Error("LMStudio probe failed: no data field in response")
  }

  const loaded_models = body.data
    .filter((m) => m.state === "loaded")
    .filter((m) => m.type === "llm" || m.type === "vlm")
    .filter((m) => m.loaded_context_length && m.loaded_context_length > 0)

  return loaded_models.map((m) => ({
    id: m.id,
    context_length: m.loaded_context_length as number,
    tool_call: m.capabilities ? m.capabilities.includes("tool_use") : false,
    vision: m.type === "vlm",
  }))
}
