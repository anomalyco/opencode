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
  docID: string
  actorID: string
  status: "pending" | "sent" | "cancelled" | "expired"
  actors: DocSubmitActor[]
  cancelledBy?: DocSubmitActor
  timeoutMs: number
  expiresAt: number
}

export type DocSubmitEvent = {
  type: "created" | "updated" | "sent" | "cancelled" | "expired"
  state: DocSubmitState
}

type StartInput = {
  baseUrl: string
  directory: string
  sessionID: string
  docID: string
  actorID: string
  actorIDs: string[]
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
  if (item.status !== "pending" && item.status !== "sent" && item.status !== "cancelled" && item.status !== "expired")
    return
  if (!Array.isArray(item.actors)) return
  return value as DocSubmitState
}

const parse = (data: string) => {
  try {
    const value = JSON.parse(data) as unknown
    if (!value || typeof value !== "object") return
    const type = (value as { type?: unknown }).type
    if (type !== "created" && type !== "updated" && type !== "sent" && type !== "cancelled" && type !== "expired")
      return
    const next = state((value as { state?: unknown }).state)
    if (!next) return
    return { type, state: next } satisfies DocSubmitEvent
  } catch {
    return
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
