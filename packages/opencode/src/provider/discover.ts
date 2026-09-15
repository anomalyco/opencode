export * as ProviderDiscover from "./discover"

// Maps an OpenAI-compatible /models response to the provider Model shape.
// Used to keep custom config providers in sync with the models their
// endpoint actually serves instead of a static or catalog-stale list.

const DISCOVERY_TIMEOUT_MS = 5_000

type RawModel = {
  id?: unknown
  object?: unknown
  created?: unknown
  owned_by?: unknown
  context_length?: unknown
  max_model_len?: unknown
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export type Discovered = {
  id: string
  name?: string
  created?: number
  context?: number
  output?: number
}

export function parseModels(data: unknown): Discovered[] {
  if (!Array.isArray(data)) return []
  const out: Discovered[] = []
  for (const item of data) {
    if (!item || typeof item !== "object") continue
    const record = item as RawModel
    const id = asString(record.id)
    if (!id) continue
    // Skip non-chat entries like embeddings/rerank when identifiable
    if (/(embed|rerank|whisper|tts|moderation)/i.test(id)) continue
    out.push({
      id,
      name: asString((record as Record<string, unknown>).name),
      created: asNumber(record.created),
      context: asNumber(record.context_length) ?? asNumber(record.max_model_len),
    })
  }
  return out
}

export async function discover(
  baseURL: string,
  apiKey: string | undefined,
): Promise<Discovered[]> {
  const url = `${baseURL.replace(/\/+$/, "")}/models`
  const headers: Record<string, string> = {}
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`model discovery failed: ${res.status}`)
  const json: unknown = await res.json()
  const data =
    json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).data)
      ? ((json as Record<string, unknown>).data as unknown)
      : Array.isArray(json)
        ? json
        : undefined
  if (!data) throw new Error("model discovery returned unexpected shape")
  return parseModels(data)
}