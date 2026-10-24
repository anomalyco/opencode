import type { App, BrowserWindow, ContinueActivityDetails, Event } from "electron"
import os from "node:os"
import type { UserActivity } from "../../shared/ipc-contract"

export const HANDOFF_ACTIVITY_TYPE = "ai.opencode.view-session"
export const BROWSING_WEB_ACTIVITY_TYPE = "NSUserActivityTypeBrowsingWeb"
export const HANDOFF_SCHEMA_VERSION = 1

export type BuiltHandoffActivity = {
  readonly type: typeof HANDOFF_ACTIVITY_TYPE
  readonly userInfo: {
    readonly v: typeof HANDOFF_SCHEMA_VERSION
    readonly sessionID: string
    readonly directory?: string
    readonly projectID?: string
    readonly serverKey?: string
    readonly serverURLs: string[]
    readonly machineHost?: string
  }
  readonly webpageURL?: string
}

export function isValidSessionID(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("ses") &&
    value.length >= 4 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f/\s]/.test(value)
  )
}

function isLoopbackHost(hostname: string) {
  const lower = hostname.toLowerCase()
  return (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower === "127.0.0.1" ||
    lower.startsWith("127.") ||
    lower === "::1" ||
    lower === "[::1]" ||
    lower === "0.0.0.0" ||
    lower === "::" ||
    lower === "[::]"
  )
}

function externalIPv4Addresses(interfaces = os.networkInterfaces()): string[] {
  const seen = new Set<string>()
  const addresses: string[] = []
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4" || !entry.address) continue
      if (isLoopbackHost(entry.address) || seen.has(entry.address)) continue
      seen.add(entry.address)
      addresses.push(entry.address)
    }
  }
  return addresses
}

export function sanitizeReachableOrigins(
  rawURLs: readonly string[],
  interfaces?: ReturnType<typeof os.networkInterfaces>,
): string[] {
  const seen = new Set<string>()
  const origins: string[] = []
  const add = (origin: string) => {
    const key = origin.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    origins.push(origin)
  }

  for (const raw of rawURLs) {
    let parsed: URL
    try {
      parsed = new URL(raw.trim())
    } catch {
      continue
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue
    if (isLoopbackHost(parsed.hostname)) {
      for (const ip of externalIPv4Addresses(interfaces)) {
        add(`${parsed.protocol}//${ip}${parsed.port ? `:${parsed.port}` : ""}`)
      }
      continue
    }
    add(parsed.origin)
  }

  return origins
}

function sanitizeWebpageURL(raw: string | undefined, fallbackOrigin: string | undefined, sessionID: string) {
  if (raw) {
    try {
      const parsed = new URL(raw.trim())
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !isLoopbackHost(parsed.hostname)) {
        parsed.username = ""
        parsed.password = ""
        return parsed.toString()
      }
    } catch {}
  }
  if (!fallbackOrigin) return undefined
  const encodedOrigin = Buffer.from(fallbackOrigin).toString("base64url")
  return `${fallbackOrigin}/server/${encodedOrigin}/session/${encodeURIComponent(sessionID)}`
}

export function buildHandoffActivity(
  input: UserActivity | null | undefined,
  options?: {
    readonly hostname?: string
    readonly interfaces?: ReturnType<typeof os.networkInterfaces>
  },
): BuiltHandoffActivity | undefined {
  if (!input || !isValidSessionID(input.sessionID)) return undefined
  const serverURLs = sanitizeReachableOrigins(input.serverURLs, options?.interfaces)
  const rawHost = (options?.hostname ?? os.hostname()).trim()
  const machineHost = rawHost && !isLoopbackHost(rawHost) ? rawHost : undefined
  const directory = input.directory?.trim() || undefined
  const projectID = input.projectID?.trim() || undefined
  const serverKey = input.serverKey && !input.serverKey.includes("@") ? input.serverKey.trim() || undefined : undefined
  const webpageURL = sanitizeWebpageURL(input.webpageURL, serverURLs[0], input.sessionID)

  return {
    type: HANDOFF_ACTIVITY_TYPE,
    userInfo: {
      v: HANDOFF_SCHEMA_VERSION,
      sessionID: input.sessionID,
      ...(directory ? { directory } : {}),
      ...(projectID ? { projectID } : {}),
      ...(serverKey ? { serverKey } : {}),
      serverURLs,
      ...(machineHost ? { machineHost } : {}),
    },
    ...(webpageURL ? { webpageURL } : {}),
  }
}

export function handoffDeepLink(type: string, userInfo: unknown, webpageURL?: string): string | undefined {
  if (type === HANDOFF_ACTIVITY_TYPE) {
    if (typeof userInfo !== "object" || userInfo === null) return undefined
    const info = userInfo as Record<string, unknown>
    if (info.v !== undefined && info.v !== HANDOFF_SCHEMA_VERSION) return undefined
    if (!isValidSessionID(info.sessionID)) return undefined

    const params = new URLSearchParams()
    if (typeof info.directory === "string" && info.directory.trim()) params.set("dir", info.directory.trim())
    if (typeof info.projectID === "string" && info.projectID.trim()) params.set("project", info.projectID.trim())
    if (typeof info.serverKey === "string" && info.serverKey.trim()) params.set("server", info.serverKey.trim())
    if (typeof info.machineHost === "string" && info.machineHost.trim()) params.set("host", info.machineHost.trim())
    if (Array.isArray(info.serverURLs)) {
      const urls = info.serverURLs.filter((item): item is string => typeof item === "string")
      for (const origin of sanitizeReachableOrigins(urls, {})) {
        params.append("url", origin)
      }
    }
    if (typeof webpageURL === "string" && webpageURL.trim()) {
      try {
        const parsed = new URL(webpageURL.trim())
        if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !isLoopbackHost(parsed.hostname)) {
          parsed.username = ""
          parsed.password = ""
          params.set("web", parsed.toString())
        }
      } catch {}
    }
    const query = params.size ? `?${params.toString()}` : ""
    return `opencode://session/${encodeURIComponent(info.sessionID)}${query}`
  }

  if (type === BROWSING_WEB_ACTIVITY_TYPE && typeof webpageURL === "string") {
    return universalLinkToDeepLink(webpageURL)
  }

  return undefined
}

export function universalLinkToDeepLink(raw: string): string | undefined {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return undefined
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  if (isLoopbackHost(url.hostname)) return undefined

  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })

  let sessionID: string | undefined
  if (parts.length === 4 && parts[0] === "server" && parts[2] === "session") {
    sessionID = parts[3]
  } else if (parts.length === 2 && parts[0] === "session") {
    sessionID = parts[1]
  }

  if (!isValidSessionID(sessionID)) return undefined
  const params = new URLSearchParams()
  params.append("url", url.origin)
  const dir = url.searchParams.get("dir")?.trim()
  if (dir) params.set("dir", dir)
  return `opencode://session/${encodeURIComponent(sessionID)}?${params.toString()}`
}

type HandoffHost = Pick<App, "setUserActivity" | "invalidateCurrentActivity" | "on" | "off">

const windowActivities = new WeakMap<BrowserWindow, UserActivity | null>()
let activeHost: HandoffHost | null = null
let advertisedKey: string | null = null

export function setWindowUserActivity(
  win: BrowserWindow,
  activity: UserActivity | null,
  lastFocusedID?: number,
) {
  windowActivities.set(win, activity)
  if (!win.isDestroyed() && (win.isFocused() || lastFocusedID === win.id)) {
    advertiseSessionActivity(activity)
  }
}

export function syncWindowUserActivity(win: BrowserWindow) {
  if (win.isDestroyed()) return
  advertiseSessionActivity(windowActivities.get(win) ?? null)
}

export function advertiseSessionActivity(input: UserActivity | null, host: HandoffHost | null = activeHost) {
  if (process.platform !== "darwin" || !host) return
  const built = buildHandoffActivity(input)
  if (!built) {
    if (advertisedKey !== null) {
      advertisedKey = null
      host.invalidateCurrentActivity()
    }
    return
  }
  const nextKey = JSON.stringify(built)
  if (advertisedKey === nextKey) return
  advertisedKey = nextKey
  host.setUserActivity(built.type, built.userInfo, built.webpageURL)
}

export function registerHandoffListeners(host: HandoffHost, onDeepLink: (url: string) => void) {
  if (process.platform !== "darwin") return () => {}
  activeHost = host

  const willContinue = (event: Event, type: string) => {
    if (type === HANDOFF_ACTIVITY_TYPE || type === BROWSING_WEB_ACTIVITY_TYPE) {
      event.preventDefault()
    }
  }

  const continueActivity = (event: Event, type: string, userInfo: unknown, details: ContinueActivityDetails) => {
    const deepLink = handoffDeepLink(type, userInfo, details?.webpageURL)
    if (!deepLink) return
    event.preventDefault()
    onDeepLink(deepLink)
  }

  const windowFocus = (_event: Event, win: BrowserWindow) => {
    syncWindowUserActivity(win)
  }

  host.on("will-continue-activity", willContinue)
  host.on("continue-activity", continueActivity)
  host.on("browser-window-focus", windowFocus)

  return () => {
    host.off("will-continue-activity", willContinue)
    host.off("continue-activity", continueActivity)
    host.off("browser-window-focus", windowFocus)
    advertiseSessionActivity(null, host)
    if (activeHost === host) activeHost = null
  }
}
