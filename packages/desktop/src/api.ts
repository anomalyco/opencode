export type SessionInfo = {
  id: string
  title?: string
  updated?: number
  created?: number
  [key: string]: unknown
}

export type MessagePart = {
  id?: string
  type?: string
  text?: string
  [key: string]: unknown
}

export type Message = {
  id: string
  role?: string
  parts?: MessagePart[]
  [key: string]: unknown
}

function serverBase(): string {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem("argus.serverUrl") : null
  if (stored) return stored.replace(/\/$/, "")
  return (import.meta.env.VITE_ARGUS_SERVER_URL as string | undefined) ?? ""
}

export function getServerUrl(): string {
  return serverBase()
}

export function setServerUrl(url: string) {
  localStorage.setItem("argus.serverUrl", url.replace(/\/$/, ""))
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${serverBase()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}`)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  listSessions: () => req<{ data: SessionInfo[] }>(`/api/session`).then((r) => r.data),
  createSession: (title?: string) =>
    req<SessionInfo>(`/api/session`, { method: "POST", body: JSON.stringify(title ? { title } : {}) }),
  getMessages: (sessionID: string) =>
    req<{ data: Message[] } | Message[]>(`/api/session/${sessionID}/message`).then((r) =>
      Array.isArray(r) ? r : r.data,
    ),
  prompt: (sessionID: string, text: string) =>
    req<unknown>(`/api/session/${sessionID}/prompt`, {
      method: "POST",
      body: JSON.stringify({ prompt: text }),
    }),
  subscribeEvents: (onEvent: (ev: unknown) => void): (() => void) => {
    const base = serverBase()
    const source = new EventSource(`${base}/api/event`)
    source.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data))
      } catch {
        onEvent(msg.data)
      }
    }
    return () => source.close()
  },
}
