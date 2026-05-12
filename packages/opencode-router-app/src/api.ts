import { z } from "zod"

export const SessionSchema = z.object({
  hash: z.string(),
  email: z.string(),
  repoUrl: z.string(),
  /** Session branch — auto-generated unique name (e.g. "calm-snails-dream") */
  branch: z.string(),
  /** Source branch the session was created from (e.g. "main") */
  sourceBranch: z.string(),
  state: z.enum(["creating", "running", "stopped"]),
  /**
   * Deep link URL to the opencode session, e.g.
   *   https://<hash>-oc.<domain>/<workspace-b64>/session/<sessionId>
   *
   * null when the pod is not running or the session URL is not yet resolved.
   * The events SSE fires `complete` only once this is non-null.
   */
  url: z.string().nullable(),
  /** Attach URL for local client connections */
  attachUrl: z.string().optional(),
  /** Password for attach authentication (only included for session owner) */
  attachPassword: z.string().optional(),
  lastActivity: z.string(),
  createdAt: z.string(),
  idleTimeoutMinutes: z.number(),
  description: z.string().optional(),
  title: z.string().optional(),
})
export type Session = z.infer<typeof SessionSchema>

export const StoredMessageSchema = z.object({
  partID: z.string().min(1),
  messageID: z.string().min(1),
  sessionID: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  time: z.number(),
})
export type StoredMessage = z.infer<typeof StoredMessageSchema>

export const SessionsResponseSchema = z.object({
  email: z.string(),
  sessions: z.array(SessionSchema),
})
export type SessionsResponse = z.infer<typeof SessionsResponseSchema>

export const SessionProgressSnapshotSchema = z.object({
  title: z.string().optional(),
  messages: z.array(StoredMessageSchema),
})
export type SessionProgressSnapshot = z.infer<typeof SessionProgressSnapshotSchema>

const SessionEventsProgressSchema = z.object({ stage: z.string(), message: z.string() })
const SessionEventsStateChangeSchema = z.object({ state: z.enum(["creating", "running", "stopped"]) })
const SessionEventsCompleteSchema = z.object({ url: z.string() })
const SessionEventsErrorSchema = z.object({ message: z.string() })

/** Parse the JSON `data:` payload of an SSE MessageEvent or throw. */
function parseSseData<T>(e: Event, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse((e as MessageEvent).data))
}

const TIMEOUT_MS = 15_000

export async function listSessions(): Promise<SessionsResponse> {
  const res = await fetch("/api/sessions", { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`)
  return res.json()
}

export interface CreateSessionResponse {
  hash: string
  url: string | null
  state: "creating"
  error?: string
}

export async function createSession(
  repoUrl: string,
  branch: string,
  sourceBranch: string,
  initialMessage?: string,
): Promise<CreateSessionResponse> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl, branch, sourceBranch, ...(initialMessage ? { initialMessage } : {}) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Failed to create session: ${res.status}`)
  }
  return res.json()
}

export async function getSessionState(
  hash: string,
): Promise<{ hash: string; state: "creating" | "running" | "stopped"; url: string | null }> {
  const res = await fetch(`/api/sessions/${hash}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Failed to get session state: ${res.status}`)
  return res.json()
}

export interface SessionEventHandlers {
  onProgress?: (stage: string, message: string) => void
  onStateChange?: (state: "creating" | "running" | "stopped") => void
  onComplete?: (url: string) => void
  onError?: (message: string) => void
}

/**
 * Subscribe to SSE session startup events from GET /api/sessions/:hash/events.
 * Returns the EventSource so the caller can close it on cleanup.
 *
 * Events received:
 *   progress     { stage, message }  — human-readable startup stage update
 *   state_change { state }           — pod state transition
 *   complete     { url }             — session ready; navigate to url
 *   error        { message }         — unrecoverable error
 */
export function subscribeSessionEvents(hash: string, handlers: SessionEventHandlers): EventSource {
  const es = new EventSource(`/api/sessions/${hash}/events`)

  es.addEventListener("progress", (e) => {
    try {
      const data = parseSseData(e, SessionEventsProgressSchema)
      handlers.onProgress?.(data.stage, data.message)
    } catch (err) {
      console.warn("subscribeSessionEvents: invalid progress payload:", err)
    }
  })

  es.addEventListener("state_change", (e) => {
    try {
      const data = parseSseData(e, SessionEventsStateChangeSchema)
      handlers.onStateChange?.(data.state)
    } catch (err) {
      console.warn("subscribeSessionEvents: invalid state_change payload:", err)
    }
  })

  es.addEventListener("complete", (e) => {
    try {
      const data = parseSseData(e, SessionEventsCompleteSchema)
      es.close()
      handlers.onComplete?.(data.url)
    } catch (err) {
      console.warn("subscribeSessionEvents: invalid complete payload:", err)
    }
  })

  es.addEventListener("error", (e) => {
    const raw = (e as MessageEvent).data
    let message = "Connection error"
    if (raw) {
      try {
        message = SessionEventsErrorSchema.parse(JSON.parse(raw)).message
      } catch (err) {
        console.warn("subscribeSessionEvents: invalid error payload:", err)
      }
    }
    es.close()
    handlers.onError?.(message)
  })

  return es
}

export async function terminateSession(hash: string): Promise<void> {
  const res = await fetch(`/api/sessions/${hash}`, { method: "DELETE", signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any).error ?? `Failed to terminate session: ${res.status}`)
  }
}

export async function resumeSession(hash: string): Promise<void> {
  const res = await fetch(`/api/sessions/${hash}/resume`, { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any).error ?? `Failed to resume session: ${res.status}`)
  }
}

export async function suggestBranch(repoUrl: string): Promise<{ branch: string }> {
  const params = new URLSearchParams({ repoUrl })
  const res = await fetch(`/api/sessions/suggest-branch?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Failed to suggest branch: ${res.status}`)
  return res.json()
}

export interface Repo {
  name: string
  fullName: string
  url: string
  isPrivate: boolean
  defaultBranch: string
}

export interface Branch {
  name: string
}

export async function listUserRepos(): Promise<Repo[]> {
  const res = await fetch("/api/user/repos", { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Failed to list repos: ${res.status}`)
  return res.json()
}

export async function listRepoBranches(repoFullName: string): Promise<Branch[]> {
  const params = new URLSearchParams({ repo: repoFullName })
  const res = await fetch(`/api/user/repos/branches?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Failed to list branches: ${res.status}`)
  return res.json()
}

export function subscribeSessionsStream(handlers: {
  onSessions?: (data: SessionsResponse) => void
  onError?: (err: Event) => void
}): EventSource {
  const es = new EventSource("/api/sessions/stream")
  es.addEventListener("sessions", (e) => {
    try {
      handlers.onSessions?.(parseSseData(e, SessionsResponseSchema))
    } catch (err) {
      console.warn("subscribeSessionsStream: invalid sessions payload:", err)
    }
  })
  // Named "error" event sent by the router when it can't list sessions
  es.addEventListener("error", (e) => {
    es.close()
    handlers.onError?.(e)
  })
  // Also handle connection-level errors (e.g. server unreachable)
  es.onerror = (e) => {
    handlers.onError?.(e)
  }
  return es
}

export function subscribeProgressStream(
  hash: string,
  handlers: {
    onSnapshot?: (progress: SessionProgressSnapshot) => void
    onMessage?: (msg: StoredMessage) => void
    onError?: (err: Event) => void
  },
): EventSource {
  const es = new EventSource(`/api/sessions/${hash}/progress/stream`)
  es.addEventListener("snapshot", (e) => {
    try {
      handlers.onSnapshot?.(parseSseData(e, SessionProgressSnapshotSchema))
    } catch (err) {
      console.warn("subscribeProgressStream: invalid snapshot payload:", err)
    }
  })
  es.addEventListener("message", (e) => {
    try {
      handlers.onMessage?.(parseSseData(e, StoredMessageSchema))
    } catch (err) {
      console.warn("subscribeProgressStream: invalid message payload:", err)
    }
  })
  if (handlers.onError) es.onerror = handlers.onError
  return es
}
