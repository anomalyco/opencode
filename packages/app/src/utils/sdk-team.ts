import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"

function config(sdk: OpencodeClient) {
  const client = sdk as unknown as {
    client?: {
      getConfig?: () => {
        baseUrl?: string
        fetch?: typeof globalThis.fetch
        headers?: HeadersInit
      }
    }
  }
  const value = client.client?.getConfig?.()
  if (!value?.baseUrl) throw new Error("SDK baseUrl unavailable")
  return value
}

export async function sdkJson<T>(
  sdk: OpencodeClient,
  input: {
    path: string
    directory?: string
    method?: "GET" | "POST" | "DELETE"
    body?: unknown
  },
) {
  const current = config(sdk)
  const url = new URL(input.path, current.baseUrl)

  if (input.directory) url.searchParams.set("directory", input.directory)

  const headers = new Headers(current.headers ?? {})
  const init: RequestInit = {
    method: input.method ?? (input.body === undefined ? "GET" : "POST"),
    headers,
  }

  if (input.body !== undefined) {
    headers.set("content-type", "application/json")
    init.body = JSON.stringify(input.body)
  }

  const response = await (current.fetch ?? globalThis.fetch)(new Request(url.toString(), init))
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `${response.status} ${response.statusText}`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
