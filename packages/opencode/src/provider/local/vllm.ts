import { type LocalModel } from "./index"

export interface VllmModel {
  id: string
  object: "model"
  created: number
  owned_by: string
  root: string
  parent: null
  max_model_len: number
}

export interface VllmModelsResponse {
  object: "list"
  data: VllmModel[]
}

export async function vllm_detect_provider(url: string): Promise<boolean> {
  try {
    const endpoint = url + "/v1/models"
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) {
      return false
    }

    if (res.headers.get("Server")?.toLowerCase() !== "uvicorn") {
      return false
    }

    const body = (await res.json()) as VllmModelsResponse
    const model = body.data?.[0]
    if (!model) {
      return false
    }

    return model.owned_by === "vllm"
  } catch (e) {
    return false
  }
}

export async function vllm_probe_loaded_models(url: string): Promise<LocalModel[]> {
  const endpoint = url + "/v1/models"

  const res = await fetch(endpoint, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) {
    const respText = await res.text()
    throw new Error(`vLLM probe failed with status ${res.status}: ${respText}`)
  }

  const body = (await res.json()) as VllmModelsResponse
  if (!body.data) {
    throw new Error("vLLM probe failed: no data field in response")
  }

  return body.data.map((m) => ({
    id: m.id,
    context_length: m.max_model_len,
    // vLLM model listing does not expose per-model capabilities.
    // Vision is inferred with a very naive heuristic from model id.
    // Tool calls are hardcoded true and may still fail at inference time.
    tool_call: true,
    vision: m.id.toLowerCase().includes("vl"),
  }))
}
