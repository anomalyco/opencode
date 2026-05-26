type DiscoveredModel = {
  id: string
  name: string
}

type DiscoverArgs = {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  fetcher?: typeof fetch
  fetchJson?: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) => Promise<{
    ok: boolean
    status: number
    data: unknown
  }>
  signal?: AbortSignal
  timeoutMs?: number
}

const MODEL_PATHS = ["models", "v1/models"] as const
const DEFAULT_TIMEOUT_MS = 5_000

export function parseDiscoveredModels(input: unknown): DiscoveredModel[] {
  if (!input || typeof input !== "object") return []

  const value = input as { data?: unknown; models?: unknown }
  const items = Array.isArray(value.data) ? value.data : Array.isArray(value.models) ? value.models : []
  const seen = new Set<string>()

  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return []

    const entry = item as { id?: unknown; name?: unknown }
    const id = typeof entry.id === "string" ? entry.id.trim() : ""
    if (!id || seen.has(id)) return []

    seen.add(id)
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id

    return [{ id, name }]
  })
}

export async function discoverCustomProviderModels(input: DiscoverArgs): Promise<DiscoveredModel[]> {
  const fetcher = input.fetcher ?? fetch
  const headers = new Headers(input.headers ?? {})
  const apiKey = input.apiKey?.trim()

  if (apiKey && !headers.has("authorization")) {
    const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
    if (!env) headers.set("Authorization", `Bearer ${apiKey}`)
  }

  const timeout = createTimeoutSignal(input.signal, input.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    let lastError: unknown

    for (const path of MODEL_PATHS) {
      const url = new URL(path, `${input.baseURL.replace(/\/+$/, "")}/`).toString()

      try {
        if (input.fetchJson) {
          const response = await input.fetchJson(url, {
            method: "GET",
            headers: Object.fromEntries(headers.entries()),
            timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          })
          if (!response.ok) {
            lastError = new Error(`Failed to fetch models from ${url}: ${response.status}`)
            continue
          }

          const models = parseDiscoveredModels(response.data)
          if (models.length > 0) return models

          lastError = new Error(`No models returned from ${url}`)
          continue
        }

        const response = await fetcher(url, {
          headers,
          signal: timeout.signal,
        })

        if (!response.ok) {
          lastError = new Error(`Failed to fetch models from ${url}: ${response.status}`)
          continue
        }

        const models = parseDiscoveredModels(await response.json())
        if (models.length > 0) return models

        lastError = new Error(`No models returned from ${url}`)
      } catch (error) {
        if (isAbortError(error)) throw error
        lastError = error
      }
    }

    if (lastError instanceof Error) throw lastError
    throw new Error("Failed to fetch models")
  } finally {
    timeout.clear()
  }
}

function createTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  if (signal) {
    if (signal.aborted) {
      controller.abort()
    } else {
      signal.addEventListener(
        "abort",
        () => {
          controller.abort()
        },
        { once: true },
      )
    }
  }

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

function isAbortError(error: unknown) {
  return !!error && typeof error === "object" && "name" in error && error.name === "AbortError"
}
