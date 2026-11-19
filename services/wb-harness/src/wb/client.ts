import { parseSSE, type SSEMessage } from "./sse"

export type WBChunk = {
  type: string
  data: Record<string, unknown>
}

export type WBAuth = {
  token: string
  userdata: string
}

export type WBMessageInput = {
  text: string
  sessionID?: string
  idempotencyKey?: string
  auth: WBAuth
  upstream: string
  signal?: AbortSignal
}

export class WBError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = "WBError"
  }
}

/**
 * The upstream rate-limits bursts with HTTP 429 and `retry-after`.
 * Keep a shared cooldown so parallel requests fail fast instead of piling up.
 */
const cooldown = { until: 0, retryAfter: 0 }

export function rateLimitStatus() {
  const remaining = Math.max(0, cooldown.until - Date.now())
  return { limited: remaining > 0, retryAfterSeconds: Math.ceil(remaining / 1000) || cooldown.retryAfter }
}

export function resetRateLimit() {
  cooldown.until = 0
  cooldown.retryAfter = 0
}

export function buildWBRequest(input: WBMessageInput) {
  return {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    text: input.text,
    ...(input.sessionID ? { session_id: input.sessionID } : {}),
  }
}

export function buildWBHeaders(auth: WBAuth) {
  return {
    authorization: `Bearer ${auth.token}`,
    "x-userdata": auth.userdata,
    "content-type": "application/json",
    accept: "text/event-stream",
    "x-accept-markdown": "true",
    "x-client": "web",
    origin: "https://www.wildberries.ru",
    referer: "https://www.wildberries.ru/",
    "user-agent":
      "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36",
  }
}

/**
 * Calls the Wildberries chat endpoint and yields parsed events.
 * The upstream replies with SSE frames whose `data` is a JSON object
 * shaped like `{ type, data }`.
 */
export async function* streamWBMessage(input: WBMessageInput): AsyncGenerator<WBChunk> {
  const limited = rateLimitStatus()
  if (limited.limited) {
    throw new WBError(
      `Wildberries rate limit is active, retry in ${limited.retryAfterSeconds}s`,
      429,
      "",
      limited.retryAfterSeconds,
    )
  }

  const response = await fetch(input.upstream, {
    method: "POST",
    headers: buildWBHeaders(input.auth),
    body: JSON.stringify(buildWBRequest(input)),
    signal: input.signal,
  })

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "")
    const retryAfter = readRetryAfter(response, body)
    if (response.status === 429) {
      cooldown.retryAfter = retryAfter ?? 60
      cooldown.until = Date.now() + cooldown.retryAfter * 1000
    }
    throw new WBError(`Wildberries upstream failed with ${response.status}`, response.status, body, retryAfter)
  }

  const body = response.body as unknown as AsyncIterable<Uint8Array>
  for await (const message of parseSSE(body)) {
    const chunk = decodeChunk(message)
    if (chunk) yield chunk
  }
}

function readRetryAfter(response: Response, body: string): number | undefined {
  const header = Number(response.headers.get("retry-after"))
  if (Number.isFinite(header) && header > 0) return header
  try {
    const parsed = JSON.parse(body) as { retryAfterSeconds?: unknown }
    if (typeof parsed.retryAfterSeconds === "number") return parsed.retryAfterSeconds
  } catch {
    return
  }
}

function decodeChunk(message: SSEMessage): WBChunk | undefined {
  const raw = message.data.trim()
  if (!raw || raw === "[DONE]") return
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || typeof parsed.type !== "string") return
    const data = isRecord(parsed.data) ? parsed.data : { value: parsed.data }
    return { type: parsed.type, data }
  } catch {
    return
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export type CollectedMessage = {
  sessionID?: string
  text: string
  scenario?: string
  state?: string
  suggests: string[]
}

/**
 * Aggregates a WB stream into a single message.
 * `text` chunks append; `updated_text` events replace the accumulated text.
 */
export async function collectWBMessage(input: WBMessageInput): Promise<CollectedMessage> {
  let text = ""
  const suggests: string[] = []
  let sessionID: string | undefined = input.sessionID
  let scenario: string | undefined
  let state: string | undefined

  for await (const chunk of streamWBMessage(input)) {
    if (chunk.type === "system_info") {
      const value = chunk.data.session_id
      if (typeof value === "string") sessionID = value
    }

    if (chunk.type === "text") {
      const value = chunk.data.text
      if (typeof value === "string") text += value
    }

    if (chunk.type === "updated_text") {
      const value = chunk.data.text
      if (typeof value === "string") text = value
    }

    if (chunk.type === "suggests") {
      const value = chunk.data.suggests
      if (Array.isArray(value)) {
        for (const item of value) if (typeof item === "string") suggests.push(item)
      }
    }

    if (chunk.type === "scenario_info") {
      const value = chunk.data.scenario
      if (typeof value === "string") scenario = value
      const manager = chunk.data.state_manager
      if (isRecord(manager) && typeof manager.state === "string") state = manager.state
    }
  }

  return { sessionID, text, scenario, state, suggests }
}
