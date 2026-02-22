export type Client = {
  baseUrl: string
  token: string
  timeout: number
}

export function client(input?: Partial<Client>): Client {
  const baseUrl = input?.baseUrl ?? Bun.env.FINNY_API_BASE_URL ?? "http://localhost:7090"
  const token = input?.token ?? Bun.env.FINNY_API_TOKEN ?? ""
  if (!token) throw new Error("FINNY_API_TOKEN is required")
  const timeout = input?.timeout ?? 15000
  return { baseUrl, token, timeout }
}

type RequestInput = {
  path: string
  method?: string
  body?: unknown
  headers?: Record<string, string>
  client?: Client
}

export async function request<T>(input: RequestInput): Promise<T> {
  const cfg = input.client ?? client()
  const url = new URL(input.path, cfg.baseUrl)
  const method = input.method ?? "POST"
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    "Content-Type": "application/json",
  }
  if (input.headers) Object.assign(headers, input.headers)
  const body = method === "GET" || input.body === undefined ? undefined : JSON.stringify(input.body)
  const res = await fetch(url.toString(), {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(cfg.timeout),
  })
  if (res.ok) return res.json() as Promise<T>
  const text = await res.text()
  throw new Error(`finny request failed: ${res.status} ${res.statusText} ${text}`)
}
