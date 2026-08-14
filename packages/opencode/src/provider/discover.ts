import { Schema } from "effect"

const DEFAULT_TIMEOUT = 10_000

export class DiscoverError extends Schema.TaggedErrorClass<DiscoverError>()("ProviderDiscoverError", {
  kind: Schema.Literals(["invalidUrl", "unauthorized", "invalidFormat", "timeout", "failed"]),
  message: Schema.optional(Schema.String),
}) {}

export type DiscoverInput = {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  timeoutMs?: number
}

export async function discoverOpenAICompatibleModels(input: DiscoverInput): Promise<string[]> {
  const baseURL = input.baseURL.trim()
  if (!/^https?:\/\//.test(baseURL)) throw new DiscoverError({ kind: "invalidUrl" })

  const hasVersionPath = /\/v\d+($|\/)/.test(baseURL)
  const base = hasVersionPath ? baseURL.replace(/\/?$/, "/") : baseURL
  const url = new URL(hasVersionPath ? "models" : "/v1/models", base)

  const headers: Record<string, string> = { ...(input.headers ?? {}) }
  const apiKey = input.apiKey?.trim()
  if (apiKey) {
    const envMatch = apiKey.match(/^\{env:([^}]+)\}$/)
    if (envMatch) {
      const resolved = process.env[envMatch[1] ?? ""]
      if (resolved) headers.Authorization = `Bearer ${resolved}`
    } else {
      headers.Authorization = `Bearer ${apiKey}`
    }
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new DiscoverError({ kind: "timeout" })
    }
    throw new DiscoverError({ kind: "failed", message: error instanceof Error ? error.message : String(error) })
  }

  if (response.status === 401 || response.status === 403) throw new DiscoverError({ kind: "unauthorized" })
  if (!response.ok) throw new DiscoverError({ kind: "failed", message: `status ${response.status}` })

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new DiscoverError({ kind: "invalidFormat" })
  }

  if (!isModelList(json)) throw new DiscoverError({ kind: "invalidFormat" })
  return [...new Set(json.data.map((item) => item.id.trim()).filter(Boolean))]
}

function isModelList(value: unknown): value is { data: { id: string }[] } {
  if (typeof value !== "object" || value === null || !("data" in value)) return false
  const data = (value as { data: unknown }).data
  if (!Array.isArray(data)) return false
  return data.every(
    (item) =>
      typeof item === "object" && item !== null && "id" in item && typeof (item as { id: unknown }).id === "string",
  )
}

export * as ProviderDiscover from "./discover"
