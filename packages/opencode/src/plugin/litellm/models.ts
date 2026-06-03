import type { Model } from "@opencode-ai/sdk/v2"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import * as Log from "@opencode-ai/core/util/log"
import os from "os"

const log = Log.create({ service: "plugin.litellm.models" })

interface LiteLLMModelEntry {
  id: string
  created?: number
  owned_by?: string
}

interface LiteLLMModelInfo {
  max_tokens?: number
  max_input_tokens?: number
  max_output_tokens?: number
  input_cost_per_token?: number
  output_cost_per_token?: number
  supports_vision?: boolean
  supports_function_calling?: boolean
  mode?: string
}

async function fetchModelInfo(
  baseURL: string,
  headers: Record<string, string>,
): Promise<Record<string, LiteLLMModelInfo>> {
  try {
    const url = `${baseURL.replace(/\/+$/, "")}/model/info`
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return {}
    const body = (await res.json()) as { data?: Array<{ model_name: string; model_info?: LiteLLMModelInfo }> }
    if (!Array.isArray(body.data)) return {}
    const info: Record<string, LiteLLMModelInfo> = {}
    for (const entry of body.data) {
      if (entry.model_name && entry.model_info) {
        info[entry.model_name] = entry.model_info
      }
    }
    return info
  } catch {
    return {}
  }
}

function buildModel(id: string, baseURL: string, info?: LiteLLMModelInfo, prev?: Model): Model {
  const maxContext = info?.max_tokens ?? info?.max_input_tokens ?? 128_000
  const maxOutput = info?.max_output_tokens ?? 16_384

  const inputCost = info?.input_cost_per_token ?? 0
  const outputCost = info?.output_cost_per_token ?? 0

  return {
    id: id,
    providerID: "litellm",
    name: prev?.name ?? id,
    api: {
      id,
      url: baseURL,
      npm: "@ai-sdk/openai-compatible",
    },
    status: "active",
    headers: prev?.headers ?? {},
    options: prev?.options ?? {},
    cost: {
      input: inputCost * 1_000_000,
      output: outputCost * 1_000_000,
      cache: { read: 0, write: 0 },
    },
    limit: {
      context: maxContext,
      output: maxOutput,
    },
    capabilities: {
      temperature: true,
      reasoning: prev?.capabilities?.reasoning ?? false,
      attachment: true,
      toolcall: info?.supports_function_calling ?? prev?.capabilities?.toolcall ?? true,
      input: {
        text: true,
        audio: false,
        image: info?.supports_vision ?? prev?.capabilities?.input?.image ?? true,
        video: false,
        pdf: false,
      },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: prev?.release_date ?? "",
    variants: prev?.variants ?? {},
  }
}

export async function get(
  baseURL: string,
  headers: Record<string, string> = {},
  existing: Record<string, Model> = {},
): Promise<Record<string, Model>> {
  const modelsURL = `${baseURL.replace(/\/+$/, "")}/v1/models`
  const reqHeaders: Record<string, string> = {
    "User-Agent": `opencode/${InstallationVersion} litellm (${os.platform()} ${os.release()}; ${os.arch()})`,
    ...headers,
  }

  const res = await fetch(modelsURL, {
    headers: reqHeaders,
    signal: AbortSignal.timeout(5_000),
  })
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`)

  const body = (await res.json()) as { data?: LiteLLMModelEntry[] }
  if (!Array.isArray(body.data)) return existing

  // Enrich with per-model metadata from /model/info
  const modelInfo = await fetchModelInfo(baseURL, reqHeaders)

  const result = { ...existing }

  for (const entry of body.data) {
    const id = entry.id
    if (!id) continue
    const info = modelInfo[id]
    result[id] = buildModel(id, baseURL, info, existing[id])
  }

  return result
}

export * as LiteLLMModels from "./models"
