import type { Model } from "./provider"
import * as ProviderTransform from "./transform"
import { ModelID, ProviderID } from "./schema"

export type OpenWebUIDiscoveryOk = {
  ok: true
  models: Record<string, Model>
  normalizedBase: string
}

export type OpenWebUIDiscoveryErr = {
  ok: false
  reason: "network" | "http" | "json" | "empty"
  detail?: string
}

export type OpenWebUIDiscoveryResult = OpenWebUIDiscoveryOk | OpenWebUIDiscoveryErr

type OwuiEntry = { id?: string; name?: string; model?: string; info?: { id?: string } }

function parseModelEntries(data: unknown): OwuiEntry[] {
  if (Array.isArray(data)) return data as OwuiEntry[]
  if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
    return (data as { data: OwuiEntry[] }).data
  }
  if (data && typeof data === "object" && "models" in data && Array.isArray((data as { models: unknown }).models)) {
    return (data as { models: OwuiEntry[] }).models
  }
  return []
}

function entryId(item: OwuiEntry | string): string | undefined {
  if (typeof item === "string") return item
  if (!item || typeof item !== "object") return undefined
  if (typeof item.id === "string" && item.id) return item.id
  if (typeof item.name === "string" && item.name) return item.name
  if (typeof item.model === "string" && item.model) return item.model
  if (item.info && typeof item.info.id === "string" && item.info.id) return item.info.id
  return undefined
}

/**
 * Fetches the Open WebUI model list and builds runtime {@link Model} rows.
 * Used by provider init and CLI/TUI auth validation.
 */
export async function discoverOpenWebUIModels(input: {
  rawBaseURL: string
  apiKey: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<OpenWebUIDiscoveryResult> {
  const raw = input.rawBaseURL.replace(/\/+$/, "")
  if (!raw || !input.apiKey) return { ok: false, reason: "empty", detail: "Missing base URL or API key" }

  const normalized = ProviderTransform.openwebuiOpenAICompatibleBase(raw)
  const urls = ProviderTransform.openwebuiModelListUrls(normalized)
  const timeoutMs = input.timeoutMs ?? 10_000
  const signal = input.signal ?? AbortSignal.timeout(timeoutMs)

  let response: Response | undefined
  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        Accept: "application/json",
        "Accept-Encoding": "identity",
      },
      signal,
    }).catch(() => undefined)
    response = res
    if (res?.ok) break
  }

  if (!response) return { ok: false, reason: "network", detail: "Could not reach Open WebUI" }
  if (!response.ok) return { ok: false, reason: "http", detail: `HTTP ${response.status}` }

  const text = await response.text().catch(() => "")
  const data = text
    ? await Promise.resolve(text)
        .then((x) => (x ? JSON.parse(x) : undefined))
        .catch(() => undefined)
    : undefined
  if (data === undefined) return { ok: false, reason: "json", detail: "Response was not valid JSON" }

  const entries = parseModelEntries(data)
  const models: Record<string, Model> = {}

  for (const item of entries) {
    const rawID = entryId(item)
    if (!rawID) continue
    const e = item && typeof item === "object" ? item : undefined
    const label = typeof e?.name === "string" ? e.name : rawID
    models[rawID] = {
      id: ModelID.make(rawID),
      providerID: ProviderID.make("openwebui"),
      name: label,
      api: {
        id: rawID,
        url: normalized,
        npm: "@ai-sdk/openai-compatible",
      },
      status: "active",
      headers: {},
      options: {},
      cost: {
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 },
      },
      limit: {
        context: 128_000,
        output: 4_096,
      },
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

  if (Object.keys(models).length === 0) {
    return { ok: false, reason: "empty", detail: "No models in response" }
  }

  return { ok: true, models, normalizedBase: normalized }
}
