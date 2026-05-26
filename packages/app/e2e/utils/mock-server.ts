import type { Page, Route } from "@playwright/test"

const emptyList = new Set([
  "/skill",
  "/command",
  "/lsp",
  "/formatter",
  "/permission",
  "/question",
  "/vcs/status",
  "/vcs/diff",
])
const emptyObject = new Set(["/global/config", "/config", "/provider/auth", "/mcp", "/session/status"])

export interface MockServerConfig {
  provider: unknown
  directory: string
  project: unknown
  sessions: ({ id: string } & Record<string, unknown>)[]
  permissions?: ({ id: string; sessionID: string } & Record<string, unknown>)[]
  onPermissionReply?: (input: { requestID: string; body: unknown }) => void
  onDeprecatedPermissionRespond?: (input: { sessionID: string; permissionID: string; body: unknown }) => void
  pageMessages: (sessionId: string, limit: number, before?: string) => { items: unknown[]; cursor?: string }
}

export async function mockOpenCodeServer(page: Page, config: MockServerConfig) {
  const staticRoutes: Record<string, unknown> = {
    "/global/health": { healthy: true, version: "dev" },
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
    if (!isMockApiPath(url.pathname)) {
      return route.fallback()
    }

    const path = url.pathname
    if (path === "/global/event" || path === "/event") return sse(route)
    if (path === "/permission") return json(route, config.permissions ?? [])
    if (emptyObject.has(path)) return json(route, {})
    if (emptyList.has(path)) return json(route, [])
    if (path in staticRoutes) return json(route, staticRoutes[path])

    const permissionReplyMatch = path.match(/^\/permission\/([^/]+)\/reply$/)
    if (permissionReplyMatch) {
      config.onPermissionReply?.({ requestID: permissionReplyMatch[1], body: postBody(route) })
      return json(route, true)
    }

    const deprecatedPermissionMatch = path.match(/^\/session\/([^/]+)\/permissions\/([^/]+)$/)
    if (deprecatedPermissionMatch) {
      config.onDeprecatedPermissionRespond?.({
        sessionID: deprecatedPermissionMatch[1],
        permissionID: deprecatedPermissionMatch[2],
        body: postBody(route),
      })
      return json(route, true)
    }

    const sessionMatch = path.match(/^\/session\/([^/]+)$/)
    if (sessionMatch) {
      const session = config.sessions.find((s) => s.id === sessionMatch[1])
      return json(route, session ?? {})
    }

    if (/^\/session\/[^/]+\/(children|todo|diff)$/.test(path)) return json(route, [])

    const messagesMatch = path.match(/^\/session\/([^/]+)\/message$/)
    if (messagesMatch) {
      const limit = Number(url.searchParams.get("limit") ?? 80)
      const before = url.searchParams.get("before") ?? undefined
      const pageData = config.pageMessages(messagesMatch[1], limit, before)
      return json(route, pageData.items, pageData.cursor ? { "x-next-cursor": pageData.cursor } : undefined)
    }

    return json(route, {})
  })
}

function isMockApiPath(path: string) {
  return (
    path === "/global/event" ||
    path === "/global/health" ||
    path === "/event" ||
    path === "/global/config" ||
    path === "/config" ||
    path === "/provider/auth" ||
    path === "/mcp" ||
    path === "/session/status" ||
    path === "/permission" ||
    path === "/question" ||
    path === "/provider" ||
    path === "/path" ||
    path === "/project" ||
    path === "/project/current" ||
    path === "/agent" ||
    path === "/vcs" ||
    path === "/vcs/status" ||
    path === "/vcs/diff" ||
    path === "/skill" ||
    path === "/command" ||
    path === "/lsp" ||
    path === "/formatter" ||
    path === "/session" ||
    path.startsWith("/session/") ||
    path.startsWith("/permission/")
  )
}

function json(route: Route, body: unknown, headers?: Record<string, string>) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "x-next-cursor",
      ...headers,
    },
    body: JSON.stringify(body ?? null),
  })
}

function postBody(route: Route) {
  const text = route.request().postData()
  if (!text) return undefined
  return JSON.parse(text) as unknown
}

function sse(route: Route) {
  return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ok\n\n" })
}
