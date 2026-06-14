import { Global } from "@opencode-ai/core/global"
import path from "node:path"
import fs from "node:fs"

// Credentials are written by the login dialog into a sibling bitcost/ dir.
const AUTH_FILE = path.join(path.dirname(Global.Path.data), "bitcost", "bitcost-auth.json")
const LOG_FILE = path.join(Global.Path.log, "bitcost-api.log")

function log(message: string) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`)
  } catch (e) {
    // ignore
  }
}

export function bitcostTraceID(prefix: string, suffix?: string) {
  return `${prefix}:${suffix ?? crypto.randomUUID()}`
}

export function logBitcostEvent(message: string, fields?: Record<string, unknown>) {
  log(`${message}${fields ? ` ${JSON.stringify(fields)}` : ""}`)
}

export interface BitcostTask {
  id: string | number
  name?: string
  status?: string
  external_url?: string | null
  externalUrl?: string | null
  completed_at?: string | null
  completedAt?: string | null
  created_at?: string | null
  createdAt?: string | null
  cost_total?: number
  costTotal?: number
  usage_count?: number
  usageCount?: number
}

function normalizeBitcostTask(task: BitcostTask): BitcostTask {
  return {
    ...task,
    external_url: task.external_url ?? task.externalUrl,
    completed_at: task.completed_at ?? task.completedAt,
    created_at: task.created_at ?? task.createdAt,
    cost_total: task.cost_total ?? task.costTotal,
    usage_count: task.usage_count ?? task.usageCount,
  }
}

export function bitcostBaseUrl(): string {
  return (process.env.BITCOST_URL ?? "https://bitcost.test").replace(/\/+$/, "")
}

// Bun's fetch accepts a `tls` option; local Herd-style hosts use an untrusted CA.
function localTls(url: string): Record<string, unknown> {
  try {
    const host = new URL(url).hostname
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".test"))
      return { tls: { rejectUnauthorized: false } }
  } catch {
    // ignore malformed URLs
  }
  return {}
}

export async function bitcostFetch(url: string, init: RequestInit = {}) {
  const requestInit = { ...init, ...localTls(url) } as RequestInit

  const headers =
    requestInit.headers instanceof Headers
      ? Object.fromEntries(requestInit.headers.entries())
      : requestInit.headers

  log(`Request: ${requestInit.method ?? "GET"} ${url} Headers: ${JSON.stringify(headers)} Body: ${requestInit.body ?? ""}`)

  const res = await fetch(url, requestInit)

  log(`Response: ${res.status} ${url} Trace: ${res.headers.get("x-bitcost-trace-id") ?? ""}`)

  return res
}

// The Bun `tls` option only helps Bun; Node's fetch ignores it, so for local
// dev hosts also relax verification via the env var (restored afterwards).
export function relaxTlsForLocal(url: string): () => void {
  if (Object.keys(localTls(url)).length === 0) return () => {}
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
  return () => {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev
  }
}

export function readBitcostToken(): string | undefined {
  try {
    return (JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) as { access_token?: string }).access_token
  } catch {
    return undefined
  }
}

/** Fetch the caller's tasks. Throws on auth/network failure. */
export async function fetchBitcostTasks(): Promise<BitcostTask[]> {
  const token = readBitcostToken()
  if (!token) throw new Error("Not logged in to Bitcost. Run /login first.")
  const base = bitcostBaseUrl()
  const restoreTls = relaxTlsForLocal(base)
  const requestID = bitcostTraceID("task-index")
  try {
    const res = await bitcostFetch(`${base}/api/tasks`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "X-Bitcost-Trace-ID": requestID,
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401 || res.status === 403) throw new Error("Your Bitcost login expired. Run /login again.")
    if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`)
    const body = (await res.json()) as { data?: BitcostTask[] }
    return (body.data ?? []).map(normalizeBitcostTask)
  } finally {
    restoreTls()
  }
}

export interface BitcostPricing {
  provider: string
  model: string
  variant?: string | null
  /** Price per 1,000,000 tokens (USD unless currency says otherwise). */
  input_price: number
  output_price: number
  cache_read_price?: number | null
  cache_write_price?: number | null
  reasoning_price?: number | null
  currency: string
  is_subscription: boolean
}

/**
 * Resolve bitcost's authoritative per-1M-token rates for a model. Returns null
 * when not logged in, on failure, or when bitcost has no pricing row (so callers
 * can fall back to the local catalog rate).
 */
export async function fetchBitcostPricing(
  provider: string,
  model: string,
  variant?: string,
): Promise<BitcostPricing | null> {
  const token = readBitcostToken()
  if (!token) return null
  const base = bitcostBaseUrl()
  const restoreTls = relaxTlsForLocal(base)
  try {
    const params = new URLSearchParams({ provider, model })
    if (variant) params.set("variant", variant)
    const res = await bitcostFetch(`${base}/api/pricing?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: BitcostPricing | null }
    return body.data ?? null
  } finally {
    restoreTls()
  }
}

/** Create a task. Throws on failure. */
export async function createBitcostTask(name: string): Promise<BitcostTask> {
  const token = readBitcostToken()
  if (!token) throw new Error("Not logged in to Bitcost. Run /login first.")
  const base = bitcostBaseUrl()
  const restoreTls = relaxTlsForLocal(base)
  const requestID = bitcostTraceID("task-create")
  try {
    const res = await bitcostFetch(`${base}/api/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Bitcost-Trace-ID": requestID,
      },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Failed to create task (${res.status})`)
    const body = (await res.json()) as { data: BitcostTask }
    return normalizeBitcostTask(body.data)
  } finally {
    restoreTls()
  }
}

/** Update a task. Throws on failure. */
export async function updateBitcostTask(id: string | number, name: string): Promise<BitcostTask> {
  const token = readBitcostToken()
  if (!token) throw new Error("Not logged in to Bitcost. Run /login first.")
  const base = bitcostBaseUrl()
  const restoreTls = relaxTlsForLocal(base)
  try {
    const res = await bitcostFetch(`${base}/api/tasks/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Failed to update task (${res.status})`)
    const body = (await res.json()) as { data: BitcostTask }
    return normalizeBitcostTask(body.data)
  } finally {
    restoreTls()
  }
}

/** Mark a task as complete. Throws on failure. */
export async function completeBitcostTask(id: string | number): Promise<BitcostTask> {
  const token = readBitcostToken()
  if (!token) throw new Error("Not logged in to Bitcost. Run /login first.")
  const base = bitcostBaseUrl()
  const restoreTls = relaxTlsForLocal(base)
  try {
    const res = await bitcostFetch(`${base}/api/tasks/${id}/complete`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Failed to complete task (${res.status})`)
    const body = (await res.json()) as { data: BitcostTask }
    return normalizeBitcostTask(body.data)
  } finally {
    restoreTls()
  }
}
