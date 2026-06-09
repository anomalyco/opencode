import { apiUrl } from "@/utils/api-url"
import type { PromptApprovalInput } from "./submit"

export type DocSubmitActor = {
  actorID: string
  name: string
  status: "pending" | "approved"
}

export type DocSubmitState = {
  submitID: string
  sessionID: string
  // 'doc' → targetID is the prompt doc id; 'question' → targetID is the question request id.
  targetKind: "doc" | "question"
  targetID: string
  // For 'question' votes: whether the vote sends a reply or dismisses the question.
  questionAction?: "send" | "dismiss"
  actorID: string
  status: "pending" | "sent" | "cancelled" | "expired" | "left"
  actors: DocSubmitActor[]
  cancelledBy?: DocSubmitActor
  timeoutMs: number
  expiresAt: number
}

export type DocSubmitEvent = {
  type: "created" | "updated" | "sent" | "cancelled" | "expired" | "left"
  state: DocSubmitState
}

type StartInput = {
  baseUrl: string
  directory: string
  sessionID: string
  docID: string
  actorID: string
  actorIDs: string[]
  names?: Record<string, string>
  prompt: Pick<PromptApprovalInput, "messageID" | "agent" | "model" | "variant" | "parts">
  timeoutMs?: number
}

type RespondInput = {
  baseUrl: string
  directory: string
  sessionID: string
  submitID: string
  actorID: string
  action: "approve" | "cancel"
}

type SocketInput = {
  baseUrl: string
  directory: string
  sessionID: string
  docID: string
  actorID: string
  event: (event: DocSubmitEvent) => void
}

const path = (input: { baseUrl: string; directory: string }, value: string) => {
  const url = apiUrl(input.baseUrl, value)
  url.searchParams.set("directory", input.directory)
  return url
}

const json = async (url: URL, body: unknown) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as DocSubmitState
}

export async function startSubmit(input: StartInput) {
  return json(path(input, `/session/${input.sessionID}/prompt-doc/submit`), {
    docID: input.docID,
    actorID: input.actorID,
    actorIDs: input.actorIDs,
    names: input.names,
    prompt: input.prompt,
    timeoutMs: input.timeoutMs,
  })
}

export async function respondSubmit(input: RespondInput) {
  return json(path(input, `/session/${input.sessionID}/prompt-doc/submit/${input.submitID}/respond`), {
    actorID: input.actorID,
    action: input.action,
  })
}

const state = (value: unknown): DocSubmitState | undefined => {
  if (!value || typeof value !== "object") return
  const item = value as { status?: unknown; submitID?: unknown; actors?: unknown }
  if (typeof item.submitID !== "string") return
  if (
    item.status !== "pending" &&
    item.status !== "sent" &&
    item.status !== "cancelled" &&
    item.status !== "expired" &&
    item.status !== "left"
  )
    return
  if (!Array.isArray(item.actors)) return
  return value as DocSubmitState
}

const parse = (data: string) => {
  try {
    const value = JSON.parse(data) as unknown
    if (!value || typeof value !== "object") return
    const type = (value as { type?: unknown }).type
    if (
      type !== "created" &&
      type !== "updated" &&
      type !== "sent" &&
      type !== "cancelled" &&
      type !== "expired" &&
      type !== "left"
    )
      return
    const next = state((value as { state?: unknown }).state)
    if (!next) return
    return { type, state: next } satisfies DocSubmitEvent
  } catch {
    return
  }
}

// ── Question reply consent (reuses the generalized consent machine, question endpoints) ──────────

export type QuestionSubmitPayload = { requestID: string; answers?: string[][]; reject?: boolean }

type QuestionStartInput = {
  baseUrl: string
  directory: string
  sessionID: string
  requestID: string
  actorID: string
  actorIDs: string[]
  names?: Record<string, string>
  payload: QuestionSubmitPayload
  timeoutMs?: number
}

export async function startQuestionSubmit(input: QuestionStartInput) {
  return json(path(input, `/session/${input.sessionID}/question/submit`), {
    requestID: input.requestID,
    actorID: input.actorID,
    actorIDs: input.actorIDs,
    names: input.names,
    payload: input.payload,
    timeoutMs: input.timeoutMs,
  })
}

export async function respondQuestionSubmit(input: RespondInput) {
  return json(path(input, `/session/${input.sessionID}/question/submit/${input.submitID}/respond`), {
    actorID: input.actorID,
    action: input.action,
  })
}

type QuestionSocketInput = {
  baseUrl: string
  directory: string
  sessionID: string
  requestID: string
  actorID: string
  event: (event: DocSubmitEvent) => void
}

// Reconnecting websocket for question-reply consent lifecycle events (mirrors connectSubmit).
export function connectQuestionSubmit(input: QuestionSocketInput) {
  const url = path(input, `/session/${input.sessionID}/question/submit/connect`)
  url.searchParams.set("requestID", input.requestID)
  url.searchParams.set("actorID", input.actorID)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"

  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let ws: WebSocket | undefined

  const retry = () => {
    if (closed || timer) return
    timer = setTimeout(() => {
      timer = undefined
      connect()
    }, 500)
  }

  const connect = () => {
    if (closed) return
    const socket = new WebSocket(url)
    ws = socket
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return
      const next = parse(event.data)
      if (next) input.event(next)
    })
    socket.addEventListener("close", () => {
      if (ws === socket) ws = undefined
      retry()
    })
    socket.addEventListener("error", () => {
      if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close()
      retry()
    })
  }

  connect()

  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close(1000)
  }
}

// ── Shared answer draft + presence (bidirectional channel) ───────────────────────────────────────

export type QuestionDraft = {
  requestID: string
  sessionID: string
  answers: string[][]
  custom: string[]
  customOn: boolean[]
  rev: number
}

export type QuestionDraftOp =
  | { kind: "single"; q: number; value: string | null }
  | { kind: "toggle"; q: number; label: string; on: boolean }
  | { kind: "custom"; q: number; text: string; on: boolean; multi: boolean }

export type QuestionPresenceEntry = {
  actorID: string
  name: string
  color: string
  qIndex: number
  selection: string[]
  customFocused: boolean
}

type DraftSocketInput = {
  baseUrl: string
  directory: string
  sessionID: string
  requestID: string
  actorID: string
  onDraft: (draft: QuestionDraft) => void
  onPresence: (list: QuestionPresenceEntry[]) => void
}

export type QuestionDraftChannel = {
  sendOp: (op: QuestionDraftOp) => void
  sendPresence: (entry: QuestionPresenceEntry) => void
  close: () => void
}

const draftMessage = (data: string): { type: "draft"; draft: QuestionDraft } | { type: "presence"; presence: QuestionPresenceEntry[] } | undefined => {
  try {
    const value = JSON.parse(data) as { type?: unknown; draft?: unknown; presence?: unknown }
    if (value?.type === "draft" && value.draft && typeof value.draft === "object") return { type: "draft", draft: value.draft as QuestionDraft }
    if (value?.type === "presence" && Array.isArray(value.presence)) return { type: "presence", presence: value.presence as QuestionPresenceEntry[] }
    return
  } catch {
    return
  }
}

export function connectQuestionDraft(input: DraftSocketInput): QuestionDraftChannel {
  const url = path(input, `/session/${input.sessionID}/question/draft/connect`)
  url.searchParams.set("requestID", input.requestID)
  url.searchParams.set("actorID", input.actorID)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"

  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let ws: WebSocket | undefined
  // Buffer outbound ops while (re)connecting so a click never gets dropped mid-handshake.
  let queue: string[] = []

  const flush = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    for (const data of queue) ws.send(data)
    queue = []
  }

  const push = (msg: unknown) => {
    queue.push(JSON.stringify(msg))
    flush()
  }

  const retry = () => {
    if (closed || timer) return
    timer = setTimeout(() => {
      timer = undefined
      connect()
    }, 500)
  }

  const connect = () => {
    if (closed) return
    const socket = new WebSocket(url)
    ws = socket
    socket.addEventListener("open", flush)
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return
      const next = draftMessage(event.data)
      if (!next) return
      if (next.type === "draft") input.onDraft(next.draft)
      else input.onPresence(next.presence)
    })
    socket.addEventListener("close", () => {
      if (ws === socket) ws = undefined
      retry()
    })
    socket.addEventListener("error", () => {
      if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close()
      retry()
    })
  }

  connect()

  return {
    sendOp: (op) => push({ type: "op", op }),
    sendPresence: (entry) => push({ type: "presence", entry }),
    close: () => {
      closed = true
      if (timer) clearTimeout(timer)
      if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close(1000)
    },
  }
}

export function connectSubmit(input: SocketInput) {
  const url = path(input, `/session/${input.sessionID}/prompt-doc/submit/connect`)
  url.searchParams.set("docID", input.docID)
  url.searchParams.set("actorID", input.actorID)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"

  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let ws: WebSocket | undefined

  const retry = () => {
    if (closed || timer) return
    timer = setTimeout(() => {
      timer = undefined
      connect()
    }, 500)
  }

  const connect = () => {
    if (closed) return
    const socket = new WebSocket(url)
    ws = socket
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return
      const next = parse(event.data)
      if (next) input.event(next)
    })
    socket.addEventListener("close", () => {
      if (ws === socket) ws = undefined
      retry()
    })
    socket.addEventListener("error", () => {
      if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close()
      retry()
    })
  }

  connect()

  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close(1000)
  }
}
