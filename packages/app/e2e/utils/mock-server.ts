import type { Page, Route } from "@playwright/test"

const emptyList = new Set(["/skill", "/command", "/lsp", "/formatter", "/vcs/status", "/vcs/diff"])
const emptyObject = new Set(["/global/config", "/config", "/provider/auth", "/mcp", "/experimental/resource"])

export interface MockServerConfig {
  provider: unknown
  directory: string
  project: unknown
  sessions: ({ id: string } & Record<string, unknown>)[]
  pageMessages: (sessionId: string, limit: number, before?: string) => { items: unknown[]; cursor?: string }
  vcsDiff?: unknown[]
  messageDelay?: number
  beforeMessagesResponse?: (input: { sessionID: string; before?: string }) => Promise<void>
  onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void
  message?: (sessionID: string, messageID: string) => unknown
  onMessage?: (input: { sessionID: string; messageID: string }) => void
  events?: () => unknown[]
  eventRetry?: number
  todos?: (sessionID: string) => unknown[]
  permissions?: unknown[] | (() => unknown[])
  questions?: unknown[] | (() => unknown[])
  fileList?: (path: string) => unknown | Promise<unknown>
  fileContent?: (path: string) => unknown | Promise<unknown>
  findFiles?: (input: { query: string; dirs?: string; limit?: number }) => unknown
  sessionStatus?: unknown
}

export async function mockOpenCodeServer(page: Page, config: MockServerConfig) {
  const cursors = new Map<string, string>()
  let nextCursor = 0
  const staticRoutes: Record<string, unknown> = {
    "/provider": config.provider,
    "/path": {
      state: config.directory,
      config: config.directory,
      worktree: config.directory,
      directory: config.directory,
      home: "C:/OpenCode",
    },
    "/project": [config.project],
    "/project/current": config.project,
    "/agent": [{ name: "build", mode: "primary" }],
    "/vcs": { branch: "main", default_branch: "main" },
    "/session": config.sessions,
  }

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const targetPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
    const appPort = new URL(
      process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
    ).port
    if (url.port !== targetPort && url.port !== appPort) return route.fallback()

    const path = url.pathname
    if (path === "/global/event" || path === "/event") return sse(route, config.events?.(), config.eventRetry)
    if (path === "/global/health") return json(route, { healthy: true })
    if (path === "/experimental/capabilities") return json(route, { backgroundSubagents: false })
    if (path === "/permission")
      return json(route, typeof config.permissions === "function" ? config.permissions() : (config.permissions ?? []))
    if (path === "/question")
      return json(route, typeof config.questions === "function" ? config.questions() : (config.questions ?? []))
    if (path === "/session/status") return json(route, config.sessionStatus ?? {})
    if (path === "/vcs/diff" && config.vcsDiff) return json(route, config.vcsDiff)
    if (path === "/file" && config.fileList)
      return json(route, await config.fileList(url.searchParams.get("path") ?? ""))
    if (path === "/file/content" && config.fileContent)
      return json(route, await config.fileContent(url.searchParams.get("path") ?? ""))
    if (path === "/find/file" && config.findFiles)
      return json(
        route,
        await config.findFiles({
          query: url.searchParams.get("query") ?? "",
          dirs: url.searchParams.get("dirs") ?? undefined,
          limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
        }),
      )
    if (path === "/api/reference")
      return json(route, {
        location: {
          directory: config.directory,
          project: { id: (config.project as { id?: string }).id, directory: config.directory },
        },
        data: [],
      })
    if (emptyObject.has(path)) return json(route, {})
    if (emptyList.has(path)) return json(route, [])
    if (path in staticRoutes) return json(route, staticRoutes[path])

    const sessionMatch = path.match(/^\/session\/([^/]+)$/)
    if (sessionMatch) {
      const session = config.sessions.find((s) => s.id === sessionMatch[1])
      return json(route, session ?? {})
    }

    const projectMatch = path.match(/^\/project\/([^/]+)$/)
    if (projectMatch) return json(route, config.project)

    const messageMatch = path.match(/^\/session\/([^/]+)\/message\/([^/]+)$/)
    if (messageMatch) {
      config.onMessage?.({ sessionID: messageMatch[1]!, messageID: messageMatch[2]! })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const message = config.message?.(messageMatch[1]!, messageMatch[2]!)
      if (message === undefined) return json(route, { error: "Message not found" }, undefined, 404)
      return json(route, message)
    }

    const todoMatch = path.match(/^\/session\/([^/]+)\/todo$/)
    if (todoMatch) return json(route, config.todos?.(todoMatch[1]!) ?? [])
    if (/^\/session\/[^/]+\/(children|diff)$/.test(path)) return json(route, [])

    const messagesMatch = path.match(/^\/session\/([^/]+)\/message$/)
    if (messagesMatch) {
      const token = url.searchParams.get("before") ?? undefined
      const before = token ? cursors.get(token) : undefined
      if (token && !before) return json(route, { error: "Invalid cursor" }, undefined, 400)
      config.onMessages?.({ sessionID: messagesMatch[1], before, phase: "start" })
      await config.beforeMessagesResponse?.({ sessionID: messagesMatch[1]!, before })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const limit = Number(url.searchParams.get("limit") ?? 80)
      const pageData = config.pageMessages(messagesMatch[1], limit, before)
      config.onMessages?.({ sessionID: messagesMatch[1], before, phase: "end" })
      if (!pageData.cursor) return json(route, pageData.items)
      const cursor = `cursor_${++nextCursor}`
      cursors.set(cursor, pageData.cursor)
      return json(route, pageData.items, { "x-next-cursor": cursor })
    }

    if (url.port === targetPort && targetPort !== appPort) return json(route, {})
    return route.fallback()
  })
}

function json(route: Route, body: unknown, headers?: Record<string, string>, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "x-next-cursor",
      ...headers,
    },
    body: JSON.stringify(body ?? null),
  })
}

function sse(route: Route, events?: unknown[], retry?: number) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `${retry === undefined ? "" : `retry: ${retry}\n\n`}${events?.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") || ": ok\n\n"}`,
  })
}
