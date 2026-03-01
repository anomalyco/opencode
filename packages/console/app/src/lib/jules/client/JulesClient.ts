import * as config from "../config"
import * as errors from "./errors"
import * as schemas from "./schemas"
import type {
  Session,
  Activity,
  Source,
  CreateSessionBody,
  ListSessionsResponse,
  ListActivitiesResponse,
  ListSourcesResponse,
} from "../types"

type Result<T> = { ok: true; data: T } | { ok: false; error: errors.JulesError }

async function send(method: string, path: string, key: string, body?: unknown): Promise<Result<unknown>> {
  const response = await fetch(config.url(path), {
    method,
    headers: config.headers(key),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(config.JULES_TIMEOUT),
  })
  const text = await response.text()
  if (!response.ok) return { ok: false, error: errors.error(response.status, text) }
  if (text.length === 0) return { ok: true, data: {} }
  return { ok: true, data: JSON.parse(text) }
}

export function create(key: string, body: CreateSessionBody): Promise<Result<Session>> {
  const parsed = schemas.CreateSessionBody.safeParse(body)
  if (!parsed.success)
    return Promise.resolve({
      ok: false,
      error: new errors.JulesValidationError(parsed.error.message),
    })
  return send("POST", "/sessions", key, parsed.data) as Promise<Result<Session>>
}

export function get(key: string, id: string): Promise<Result<Session>> {
  return send("GET", "/sessions/" + id, key) as Promise<Result<Session>>
}

export function activities(key: string, id: string): Promise<Result<ListActivitiesResponse>> {
  return send("GET", "/sessions/" + id + "/activities", key) as Promise<Result<ListActivitiesResponse>>
}

export function approve(key: string, id: string): Promise<Result<Session>> {
  return send("POST", "/sessions/" + id + ":approvePlan", key, {}) as Promise<Result<Session>>
}

export function reject(key: string, id: string, feedback: string): Promise<Result<Session>> {
  return send("POST", "/sessions/" + id + ":sendMessage", key, {
    prompt: feedback,
  }) as Promise<Result<Session>>
}

export function cancel(key: string, id: string): Promise<Result<Session>> {
  return send("DELETE", "/sessions/" + id, key) as Promise<Result<Session>>
}

export function sources(key: string): Promise<Result<ListSourcesResponse>> {
  return send("GET", "/sources", key) as Promise<Result<ListSourcesResponse>>
}
