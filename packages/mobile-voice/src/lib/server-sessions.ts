import * as FileSystem from "expo-file-system/legacy"

export const DEFAULT_RELAY_URL = "https://apn.dev.opencode.ai"

const SERVER_STATE_FILE = `${FileSystem.documentDirectory}mobile-voice-servers.json`

export type SessionItem = {
  id: string
  title: string
  updated: number
  directory?: string
  workspaceID?: string
  projectID?: string
}

type ServerSessionPayload = {
  id?: unknown
  title?: unknown
  directory?: unknown
  workspaceID?: unknown
  projectID?: unknown
  time?: {
    updated?: unknown
  }
}

export type ServerItem = {
  id: string
  name: string
  url: string
  serverID: string | null
  relayURL: string
  relaySecret: string
  status: "checking" | "online" | "offline"
  sessions: SessionItem[]
  sessionsLoading: boolean
}

type SavedServer = {
  id: string
  name: string
  url: string
  serverID: string | null
  relayURL: string
  relaySecret: string
}

type SavedState = {
  servers: SavedServer[]
  activeServerId: string | null
  activeSessionId: string | null
}

export function parseSessionItems(payload: unknown): SessionItem[] {
  if (!Array.isArray(payload)) return []

  return payload
    .filter((item): item is ServerSessionPayload => !!item && typeof item === "object")
    .map((item) => {
      const directory = typeof item.directory === "string" && item.directory.length > 0 ? item.directory : undefined
      const workspaceID =
        typeof item.workspaceID === "string" && item.workspaceID.length > 0 ? item.workspaceID : undefined
      const projectID = typeof item.projectID === "string" && item.projectID.length > 0 ? item.projectID : undefined

      return {
        id: String(item.id ?? ""),
        title: String(item.title ?? item.id ?? "Untitled session"),
        updated: Number(item.time?.updated ?? 0),
        directory,
        workspaceID,
        projectID,
      }
    })
    .filter((item) => item.id.length > 0)
    .sort((a, b) => b.updated - a.updated)
}

function isCarrierGradeNat(hostname: string): boolean {
  const match = /^100\.(\d{1,3})\./.exec(hostname)
  if (!match) return false
  const octet = Number(match[1])
  return octet >= 64 && octet <= 127
}

export function looksLikeLocalHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    isCarrierGradeNat(hostname)
  )
}

export function serverBases(input: string): string[] {
  const base = input.replace(/\/+$/, "")
  const list = [base]
  try {
    const url = new URL(base)
    const local = looksLikeLocalHost(url.hostname)
    const tailnet = url.hostname.endsWith(".ts.net")
    const secure = `https://${url.host}`
    const insecure = `http://${url.host}`
    if (url.protocol === "http:" && !local) {
      list.push(secure)
    } else if (url.protocol === "https:" && tailnet) {
      list.push(insecure)
    }
  } catch {
    // Keep original base only.
  }
  return [...new Set(list)]
}

function toSaved(servers: ServerItem[], activeServerId: string | null, activeSessionId: string | null): SavedState {
  return {
    servers: servers.map((item) => ({
      id: item.id,
      name: item.name,
      url: item.url,
      serverID: item.serverID,
      relayURL: item.relayURL,
      relaySecret: item.relaySecret,
    })),
    activeServerId,
    activeSessionId,
  }
}

function fromSaved(input: SavedState): {
  servers: ServerItem[]
  activeServerId: string | null
  activeSessionId: string | null
} {
  const servers = input.servers.map((item) => ({
    id: item.id,
    name: item.name,
    url: item.url,
    serverID: item.serverID ?? null,
    relayURL: item.relayURL,
    relaySecret: item.relaySecret,
    status: "checking" as const,
    sessions: [] as SessionItem[],
    sessionsLoading: false,
  }))
  const hasActive = input.activeServerId && servers.some((item) => item.id === input.activeServerId)
  const activeServerId = hasActive ? input.activeServerId : (servers[0]?.id ?? null)
  return {
    servers,
    activeServerId,
    activeSessionId: hasActive ? input.activeSessionId : null,
  }
}

export async function restoreServerState(): Promise<{
  servers: ServerItem[]
  activeServerId: string | null
  activeSessionId: string | null
} | null> {
  try {
    const data = await FileSystem.readAsStringAsync(SERVER_STATE_FILE)
    if (!data) {
      return null
    }
    return fromSaved(JSON.parse(data) as SavedState)
  } catch {
    return null
  }
}

export function persistServerState(
  servers: ServerItem[],
  activeServerId: string | null,
  activeSessionId: string | null,
): Promise<void> {
  const payload = toSaved(servers, activeServerId, activeSessionId)
  return FileSystem.writeAsStringAsync(SERVER_STATE_FILE, JSON.stringify(payload))
}
