import { ServerConnection } from "@/runtime/server/registry"
import { openNotificationSession } from "@/shell/notifications/notification"
import { findSessionTab, type Tab, type useTabs } from "@/shell/tabs/tabs"

export type AppDeepLink =
  | {
      readonly type: "session"
      readonly sessionID: string
      readonly directory?: string
      readonly projectID?: string
      readonly serverKey?: string
      readonly machineHost?: string
      readonly serverURLs: string[]
    }
  | {
      readonly type: "draft"
      readonly directory?: string
      readonly projectID?: string
      readonly serverKey?: string
    }
  | {
      readonly type: "last-session"
      readonly serverKey?: string
    }

function isValidSessionID(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("ses") &&
    value.length >= 4 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f/\s]/.test(value)
  )
}

function originOf(raw: string): string | undefined {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return url.origin.toLowerCase()
  } catch {
    return undefined
  }
}

export function parseAppDeepLink(raw: string): AppDeepLink | undefined {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return undefined
  }
  if (url.protocol !== "opencode:") return undefined

  const segments = [url.hostname, ...url.pathname.split("/").filter(Boolean)]
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })

  const head = segments[0]
  const directory = url.searchParams.get("dir")?.trim() || undefined
  const projectID = url.searchParams.get("project")?.trim() || undefined
  const serverKey = url.searchParams.get("server")?.trim() || undefined
  const machineHost = url.searchParams.get("host")?.trim() || undefined

  if (head === "session") {
    const sessionID = segments[1]
    if (!isValidSessionID(sessionID)) return undefined
    const serverURLs: string[] = []
    for (const candidate of url.searchParams.getAll("url")) {
      const origin = originOf(candidate)
      if (origin && !serverURLs.includes(origin)) serverURLs.push(origin)
    }
    const web = url.searchParams.get("web")
    if (web) {
      const webOrigin = originOf(web)
      if (webOrigin && !serverURLs.includes(webOrigin)) serverURLs.push(webOrigin)
    }
    return {
      type: "session",
      sessionID,
      directory,
      projectID,
      serverKey,
      machineHost,
      serverURLs,
    }
  }

  if (head === "new-session") {
    return {
      type: "draft",
      directory,
      projectID,
      serverKey,
    }
  }

  if (head === "last-session") {
    return {
      type: "last-session",
      serverKey,
    }
  }

  return undefined
}

export function resolveDeepLinkServer(
  link: AppDeepLink,
  servers: ReadonlyArray<ServerConnection.Any>,
  tabs: ReadonlyArray<Tab>,
): ServerConnection.Key | undefined {
  if (link.serverKey) {
    const byKey = servers.find((conn) => ServerConnection.key(conn) === link.serverKey)
    if (byKey) return ServerConnection.key(byKey)
  }

  if (link.type === "session" && link.serverURLs.length > 0) {
    const wanted = new Set(link.serverURLs.map((item) => item.toLowerCase()))
    const byOrigin = servers.find((conn) => {
      const origin = originOf(conn.http.url)
      return origin !== undefined && wanted.has(origin)
    })
    if (byOrigin) return ServerConnection.key(byOrigin)
  }

  if (link.type === "session") {
    for (const conn of servers) {
      const key = ServerConnection.key(conn)
      if (findSessionTab([...tabs], key, link.sessionID)) return key
    }
  }

  const fallback = servers.find(ServerConnection.builtin) ?? servers.find(ServerConnection.local) ?? servers[0]
  return fallback ? ServerConnection.key(fallback) : undefined
}

type DeepLinkProjectStore = {
  list(): ReadonlyArray<{ worktree: string }>
  open(directory: string): void
  last(): string | undefined
  touch(directory: string): void
}

type DeepLinkRouteContext = {
  readonly servers: {
    readonly list: ReadonlyArray<ServerConnection.Any>
    readonly projects: {
      forServer(key: ServerConnection.Key): DeepLinkProjectStore
    }
  }
  readonly tabs: Pick<
    ReturnType<typeof useTabs>,
    "store" | "addSessionTab" | "rememberSessionRoute" | "select" | "newDraft"
  >
}

export function routeAppDeepLink(raw: string, ctx: DeepLinkRouteContext): boolean {
  const parsed = parseAppDeepLink(raw)
  if (!parsed) return false

  const serverKey = resolveDeepLinkServer(parsed, ctx.servers.list, ctx.tabs.store)
  if (!serverKey) return false

  if (parsed.type === "session") {
    if (parsed.directory) {
      const projects = ctx.servers.projects.forServer(serverKey)
      projects.open(parsed.directory)
      projects.touch(parsed.directory)
    }
    openNotificationSession(ctx.tabs, serverKey, parsed.sessionID)
    return true
  }

  if (parsed.type === "draft") {
    const projects = ctx.servers.projects.forServer(serverKey)
    const directory = parsed.directory ?? projects.last() ?? projects.list()[0]?.worktree
    if (!directory) return false
    projects.open(directory)
    projects.touch(directory)
    void ctx.tabs.newDraft({ server: serverKey, directory })
    return true
  }

  if (parsed.type === "last-session") {
    const tab = ctx.tabs.store.find((item) => item.type === "session" && (!parsed.serverKey || item.server === serverKey))
    if (!tab) return false
    ctx.tabs.select(tab)
    return true
  }

  return false
}
