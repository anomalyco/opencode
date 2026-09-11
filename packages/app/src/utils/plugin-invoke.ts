import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export type { OfficeComment, OfficePreviewResult } from "@opencode-ai/session-ui/office-preview"

// ponytail: detection is click-triggered, not on the render path; a hung invoke must not leave the attachment click dead
const INVOKE_TIMEOUT_MS = 10_000

export type PluginEntry = { id: string; invokes: string[] }

// ponytail: the active server connection only lives in the Solid Server context,
// which plain functions cannot read; the session page keeps this in sync.
let connection: ServerConnection.HttpBase | undefined

export function setPluginServer(http: ServerConnection.HttpBase | undefined) {
  connection = http
}

function requireConnection() {
  if (!connection) throw new Error("No active server connection")
  return connection
}

function authHeaders(http: ServerConnection.HttpBase): Record<string, string> {
  const out: Record<string, string> = {}
  if (http.password)
    out["Authorization"] = `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}`
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ponytail: the server may answer { error } JSON, { message } JSON, or plain text; empty body falls back to the status
async function requestError(res: Response, fallback: string) {
  const body = await res.text()
  if (!body) return new Error(fallback)
  const parsed: unknown = (() => {
    try {
      return JSON.parse(body)
    } catch {
      return undefined
    }
  })()
  const record = isRecord(parsed) ? parsed : undefined
  const message =
    typeof record?.error === "string" ? record.error : typeof record?.message === "string" ? record.message : undefined
  return new Error(message ?? body)
}

export async function listPlugins(fetcher: typeof globalThis.fetch = globalThis.fetch): Promise<PluginEntry[]> {
  const base = requireConnection()
  const res = await fetcher(`${base.url}/api/plugin`, {
    headers: authHeaders(base),
    signal: AbortSignal.timeout(INVOKE_TIMEOUT_MS),
  })
  if (!res.ok) throw await requestError(res, `GET /api/plugin failed: ${res.status}`)
  const body: unknown = await res.json()
  return isRecord(body) && Array.isArray(body.data) ? (body.data as PluginEntry[]) : []
}

export async function pluginInvoke<T = unknown>(
  pluginID: string,
  name: string,
  input: unknown,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<T | undefined> {
  const base = requireConnection()
  const path = `/api/plugin/${encodeURIComponent(pluginID)}/invoke`
  const res = await fetcher(`${base.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(base) },
    body: JSON.stringify({ name, input }),
    signal: AbortSignal.timeout(INVOKE_TIMEOUT_MS),
  })
  if (!res.ok) throw await requestError(res, `POST ${path} failed: ${res.status}`)
  if (res.status === 204) return undefined
  const body: unknown = await res.json()
  // ponytail: v2 httpapi wraps success payloads in { data } / { result }; raw body if unwrapped
  return isRecord(body) && "result" in body ? (body.result as T) : (body as T)
}
