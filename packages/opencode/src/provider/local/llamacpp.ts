import { type LocalModel } from "./index"

export interface LlamaCppModelStatus {
  value?: "loaded" | "loading" | "unloaded"
  args?: string[]
  failed?: boolean
  exit_code?: number
}

export interface LlamaCppModelInfo {
  id: string
  status?: LlamaCppModelStatus
}

export interface LlamaCppModelsResponse {
  data?: LlamaCppModelInfo[]
}

export interface LlamaCppV1Model {
  id: string
  object?: string
  meta?: Record<string, unknown> | null
}

export interface LlamaCppV1ModelsResponse {
  data?: LlamaCppV1Model[]
  object?: string
}

export interface LlamaCppPropsResponse {
  default_generation_settings?: {
    n_ctx?: number
  }
  modalities?: {
    vision?: boolean
  }
  chat_template_caps?: Record<string, unknown>
}

function llamaccpp_base_url(url: string): string {
  return url.replace(/\/$/, "")
}

function llamaccpp_tool_capable(caps?: Record<string, unknown>): boolean {
  if (!caps) return false
  const value = caps.supports_tool_calls
  return value === true || value === "true"
}

function llamaccpp_context_from_meta(meta?: Record<string, unknown> | null): number {
  if (!meta) return 0
  const ctxTrain = meta.n_ctx_train
  if (typeof ctxTrain === "number" && ctxTrain > 0) return ctxTrain
  const ctx = meta.n_ctx
  if (typeof ctx === "number" && ctx > 0) return ctx
  return 0
}

async function llamaccpp_fetch_models(url: string): Promise<LlamaCppModelsResponse | null> {
  const endpoint = llamaccpp_base_url(url) + "/models"
  const res = await fetch(endpoint, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) return null
  return res.json() as Promise<LlamaCppModelsResponse>
}

async function llamaccpp_fetch_v1_models(url: string): Promise<LlamaCppV1ModelsResponse> {
  const endpoint = llamaccpp_base_url(url) + "/v1/models"
  const res = await fetch(endpoint, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) {
    const respText = await res.text()
    throw new Error(`LlamaCPP probe failed with status ${res.status}: ${respText}`)
  }

  return res.json() as Promise<LlamaCppV1ModelsResponse>
}

async function llamaccpp_fetch_props(url: string, model?: string): Promise<LlamaCppPropsResponse> {
  const base = llamaccpp_base_url(url)
  const query = model ? `?model=${encodeURIComponent(model)}` : ""
  const endpoint = `${base}/props${query}`
  const res = await fetch(endpoint, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) {
    const respText = await res.text()
    throw new Error(`LlamaCPP props failed with status ${res.status}: ${respText}`)
  }

  return res.json() as Promise<LlamaCppPropsResponse>
}

async function llamaccpp_model_from_props(url: string, id: string, model?: string): Promise<LocalModel> {
  const props = await llamaccpp_fetch_props(url, model)
  const context = props.default_generation_settings?.n_ctx ?? 0
  const vision = props.modalities?.vision === true
  const tool_call = llamaccpp_tool_capable(props.chat_template_caps)

  return {
    id,
    context_length: context,
    tool_call,
    vision,
  }
}

async function llamaccpp_model_from_props_or_meta(
  url: string,
  id: string,
  model: string | undefined,
  meta?: Record<string, unknown> | null,
): Promise<LocalModel> {
  return llamaccpp_model_from_props(url, id, model).catch(() => ({
    id,
    context_length: llamaccpp_context_from_meta(meta),
    tool_call: false,
    vision: false,
  }))
}

export async function llamaccpp_probe_loaded_models(url: string): Promise<LocalModel[]> {
  const models = await llamaccpp_fetch_models(url).catch(() => null)
  if (models) {
    const items = models.data ?? []
    const router = items.some((m) => m.status)
    if (router) {
      const loaded = items.filter((m) => m.status?.value === "loaded")
      if (loaded.length === 0) return []
      const v1 = await llamaccpp_fetch_v1_models(url).catch(() => ({ data: [] }) as LlamaCppV1ModelsResponse)
      const map = new Map(v1.data?.map((m) => [m.id, m.meta]) ?? [])
      return Promise.all(
        loaded.map((m) => {
          const id = m.id
          const meta = map.get(id) ?? null
          return llamaccpp_model_from_props_or_meta(url, id, id, meta)
        }),
      )
    }
  }

  const v1 = await llamaccpp_fetch_v1_models(url)
  const v1items = v1.data ?? []
  if (v1items.length === 0) return []

  return Promise.all(v1items.map((m) => llamaccpp_model_from_props_or_meta(url, m.id, m.id, m.meta)))
}
