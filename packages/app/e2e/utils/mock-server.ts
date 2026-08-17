import type { Page, Route } from "@playwright/test"
import type { JsonValue, OpenCodeEvent, SessionMessageInfo } from "@opencode-ai/client/promise"

export interface MockServerConfig {
  provider: unknown | (() => unknown)
  integrationMethods?: Record<string, unknown[]>
  onConnectKey?: (input: { integrationID: string; body: unknown }) => void
  directory: string
  project: unknown
  sessions: ({ id: string } & Record<string, unknown>)[]
  pageMessages: (
    sessionId: string,
    limit: number,
    before?: string,
  ) => {
    items: SessionMessageInfo[]
    cursor?: string
  }
  vcsDiff?: unknown[]
  messageDelay?: number
  beforeMessagesResponse?: (input: { sessionID: string; before?: string }) => Promise<void>
  onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void
  message?: (sessionID: string, messageID: string) => SessionMessageInfo | undefined
  onMessage?: (input: { sessionID: string; messageID: string }) => void
  events?: () => OpenCodeEvent[]
  eventRetry?: number
  permissions?: unknown[] | (() => unknown[])
  forms?: unknown[] | (() => unknown[])
  fileList?: (path: string) => unknown | Promise<unknown>
  fileContent?: (path: string) => unknown | Promise<unknown>
  findFiles?: (input: { query: string; dirs?: string; limit?: number }) => unknown
  sessionStatus?: Record<string, unknown> | (() => Record<string, unknown>)
}

type MockStreamWindow = Window & {
  __testSseTransport?: unknown
  __mockServerStream?: { push: (payloads: unknown[]) => void }
}

export async function mockOpenCodeServer(page: Page, config: MockServerConfig) {
  const cursors = new Map<string, string>()
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  let nextCursor = 0

  await page.addInitScript(
    ({ server, retry }) => {
      const host = window as MockStreamWindow
      if (host.__testSseTransport || host.__mockServerStream) return
      const originalFetch = window.fetch.bind(window)
      const encoder = new TextEncoder()
      const state: {
        controller?: ReadableStreamDefaultController<Uint8Array>
        buffer: string[]
        connections: number
      } = { buffer: [], connections: 0 }
      const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
      host.__mockServerStream = {
        push(payloads: unknown[]) {
          const frames = payloads.map(frame)
          const controller = state.controller
          if (!controller) {
            state.buffer.push(...frames)
            return
          }
          frames.forEach((item) => controller.enqueue(encoder.encode(item)))
        },
      }
      const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        if (url.origin !== server || url.pathname !== "/api/event") return originalFetch(request)
        state.connections += 1
        const id = state.connections
        let ended = false
        let own: ReadableStreamDefaultController<Uint8Array> | undefined
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            own = controller
            state.controller = controller
            if (retry !== undefined) controller.enqueue(encoder.encode(`retry: ${retry}\n\n`))
            controller.enqueue(
              encoder.encode(frame({ id: `evt_mock_connected_${id}`, type: "server.connected", data: {} })),
            )
            state.buffer.splice(0).forEach((item) => controller.enqueue(encoder.encode(item)))
            request.signal.addEventListener(
              "abort",
              () => {
                if (ended) return
                ended = true
                if (state.controller === controller) state.controller = undefined
                controller.error(request.signal.reason ?? new DOMException("The operation was aborted", "AbortError"))
              },
              { once: true },
            )
          },
          cancel() {
            if (ended) return
            ended = true
            if (state.controller === own) state.controller = undefined
          },
        })
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "cache-control": "no-cache", "content-type": "text/event-stream" },
          }),
        )
      }
      Object.defineProperty(window, "fetch", { configurable: true, writable: true, value: fetch })
    },
    { server, retry: config.eventRetry },
  )

  if (config.events) {
    const pump = { busy: false }
    const timer = setInterval(() => {
      if (pump.busy) return
      const batch = config.events?.() ?? []
      if (batch.length === 0) return
      pump.busy = true
      void page
        .evaluate((payloads) => (window as MockStreamWindow).__mockServerStream?.push(payloads), batch as unknown[])
        .catch(() => {})
        .finally(() => {
          pump.busy = false
        })
    }, 50)
    page.on("close", () => clearInterval(timer))
  }
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const targetPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
    const appPort = new URL(
      process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
    ).port
    if (url.origin !== server && url.port !== appPort) return route.fallback()

    const path = url.pathname
    if (path === "/api/event") {
      const events = config.events?.()
      return sse(
        route,
        [{ id: "evt_mock_connected", type: "server.connected", data: {} }, ...(events ?? [])],
        config.eventRetry,
      )
    }
    if (path === "/api/health") return json(route, { healthy: true, version: "2.0.0", pid: 1 })
    if (path === "/api/reference")
      return json(route, {
        location: {
          directory: config.directory,
          project: {
            id: (config.project as { id?: string }).id,
            directory: config.directory,
            canonical: config.directory,
          },
        },
        data: [],
      })
    if (path === "/api/agent")
      return json(route, {
        location: location(config),
        data: [
          {
            id: "build",
            name: "Build",
            mode: "primary",
            hidden: false,
            request: { settings: {}, headers: {}, body: {} },
            permissions: [],
          },
        ],
      })
    if (path === "/api/provider")
      return json(route, {
        location: location(config),
        data: currentProviders(providerConfig(config)),
      })
    if (path === "/api/model")
      return json(route, { location: location(config), data: currentModels(providerConfig(config)) })
    if (path === "/api/model/default")
      return json(route, { location: location(config), data: currentDefaultModel(providerConfig(config)) })
    if (path === "/api/integration") return json(route, { location: location(config), data: [] })
    if (path === "/api/command") return json(route, { location: location(config), data: [] })
    if (path === "/api/plugin") return json(route, { location: location(config), data: [] })
    if (path === "/api/mcp") return json(route, { location: location(config), data: [] })
    if (path === "/api/mcp/resource")
      return json(route, { location: location(config), data: { resources: [], templates: [] } })
    const integration = path.match(/^\/api\/integration\/([^/]+)$/)?.[1]
    if (integration && route.request().method() === "GET")
      return json(route, {
        location: location(config),
        data: {
          id: integration,
          name: integration,
          methods: config.integrationMethods?.[integration] ?? [{ type: "key", label: "API key" }],
          connections: [],
        },
      })
    const integrationConnect = path.match(/^\/api\/integration\/([^/]+)\/connect\/key$/)?.[1]
    if (integrationConnect && route.request().method() === "POST") {
      config.onConnectKey?.({ integrationID: integrationConnect, body: route.request().postDataJSON() })
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    if (/^\/api\/credential\/[^/]+$/.test(path) && route.request().method() === "DELETE")
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    if (path === "/api/project") {
      const project = config.project as typeof config.project & { canonical?: string; worktree?: string }
      return json(route, [
        {
          ...project,
          canonical: project.canonical ?? project.worktree ?? config.directory,
        },
      ])
    }
    if (path === "/api/project/current")
      return json(route, {
        id: (config.project as { id?: string }).id,
        directory: config.directory,
        canonical: config.directory,
      })
    const worktree = path.match(/^\/api\/worktree\/([^/]+)$/)?.[1]
    if (worktree && route.request().method() === "GET")
      return json(route, [
        { directory: config.directory },
        ...((config.project as { sandboxes?: string[] }).sandboxes ?? []).map((directory) => ({
          directory,
          strategy: "git",
        })),
      ])
    if (path === "/api/location") return json(route, location(config))
    if (worktree && route.request().method() === "POST") {
      const input = route.request().postDataJSON() as { directory: string; name?: string }
      return json(route, { directory: `${input.directory}/${input.name ?? "copy"}` })
    }
    if (worktree && route.request().method() === "DELETE")
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    if (/^\/api\/worktree\/[^/]+\/refresh$/.test(path))
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    if (path === "/api/permission/request")
      return json(route, {
        location: location(config),
        data: (typeof config.permissions === "function" ? config.permissions() : (config.permissions ?? [])).map(
          currentPermission,
        ),
      })
    if (path === "/api/form/request")
      return json(route, {
        location: location(config),
        data: typeof config.forms === "function" ? config.forms() : (config.forms ?? []),
      })
    if (path === "/api/vcs")
      return json(route, { location: location(config), data: { branch: { current: "main", default: "main" } } })
    if (path === "/api/vcs/status") return json(route, { location: location(config), data: [] })
    if (path === "/api/vcs/diff") return json(route, { location: location(config), data: config.vcsDiff ?? [] })
    if (path === "/api/fs/list" && config.fileList)
      return json(route, {
        location: location(config),
        data: await config.fileList(url.searchParams.get("path") ?? ""),
      })
    const fileRead = path.match(/^\/api\/fs\/read\/(.+)$/)?.[1]
    if (fileRead && config.fileContent) {
      const value = await config.fileContent(decodeURIComponent(fileRead))
      const content =
        value && typeof value === "object" && "content" in value ? String(value.content) : String(value ?? "")
      return route.fulfill({ status: 200, body: content, headers: { "content-type": "application/octet-stream" } })
    }
    if (path === "/api/fs/find" && config.findFiles) {
      const entries = await config.findFiles({
        query: url.searchParams.get("query") ?? "",
        dirs: url.searchParams.get("type") ?? undefined,
        limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
      })
      return json(route, {
        location: location(config),
        data: Array.isArray(entries)
          ? entries.map((entry) =>
              typeof entry === "string"
                ? {
                    name: entry.split(/[\\/]/).at(-1) ?? entry,
                    path: entry,
                    absolute: `${config.directory}/${entry}`,
                    type: "directory",
                    ignored: false,
                  }
                : entry,
            )
          : entries,
      })
    }
    if (path === "/api/shell" && route.request().method() === "GET")
      return json(route, { location: location(config), data: [] })
    if (/^\/api\/pty\/[^/]+\/connect-token$/.test(path))
      return json(route, { location: location(config), data: { ticket: "e2e-ticket", expires_in: 60 } })
    if (path === "/api/session") {
      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON() as Record<string, unknown>
        const created = currentSession(
          {
            id: "ses_mock_created",
            projectID: (config.project as { id?: string }).id,
            title: typeof payload.title === "string" ? payload.title : "New session",
            parentID: typeof payload.parentID === "string" ? payload.parentID : undefined,
          },
          config.directory,
        )
        config.sessions.push(created)
        return json(route, { data: created })
      }
      if (route.request().method() !== "GET") return route.fallback()
      const directory = url.searchParams.get("directory")
      const parentID = url.searchParams.get("parentID")
      const limit = Number(url.searchParams.get("limit") ?? 50)
      const offset = Number(url.searchParams.get("cursor") ?? 0)
      const sessions = config.sessions
        .filter((session) => {
          const location = session.location as { directory?: string } | undefined
          return !directory || location?.directory === directory || session.directory === directory
        })
        .filter((session) => {
          if (parentID === null) return true
          if (parentID === "null") return session.parentID === undefined
          return session.parentID === parentID
        })
        .filter((session) => {
          const search = url.searchParams.get("search")?.toLowerCase()
          return (
            !search ||
            String(session.title ?? "")
              .toLowerCase()
              .includes(search)
          )
        })
      const ordered = url.searchParams.get("order") === "asc" ? sessions : sessions.toReversed()
      const data = ordered.slice(offset, offset + limit)
      const next = offset + limit < ordered.length ? String(offset + limit) : undefined
      return json(route, {
        data: data.map((session) => currentSession(session, config.directory)),
        cursor: { next },
      })
    }
    if (path === "/api/session/active") {
      const statuses = (
        typeof config.sessionStatus === "function" ? config.sessionStatus() : (config.sessionStatus ?? {})
      ) as Record<string, { type?: string }>
      return json(route, {
        data: Object.fromEntries(
          Object.entries(statuses).flatMap(([id, status]) =>
            status.type === "idle" ? [] : [[id, { type: "running" }]],
          ),
        ),
      })
    }
    if (/^\/api\/session\/[^/]+\/shell$/.test(path) && route.request().method() === "POST") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    const sessionForm = path.match(/^\/api\/session\/([^/]+)\/form$/)?.[1]
    if (sessionForm && route.request().method() === "GET") {
      const forms = typeof config.forms === "function" ? config.forms() : (config.forms ?? [])
      return json(route, { data: forms.filter((form) => (form as { sessionID?: string }).sessionID === sessionForm) })
    }
    if (/^\/api\/session\/[^/]+\/form\/[^/]+\/(reply|cancel)$/.test(path) && route.request().method() === "POST") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    if (/^\/api\/session\/[^/]+\/background$/.test(path) && route.request().method() === "POST")
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    if (/^\/api\/session\/[^/]+\/inbox$/.test(path) && route.request().method() === "GET")
      return json(route, { data: [] })
    if (/^\/api\/session\/[^/]+\/permission\/[^/]+\/reply$/.test(path) && route.request().method() === "POST") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    if (
      /^\/api\/session\/[^/]+\/(rename|interrupt|revert\/clear|revert\/commit)$/.test(path) &&
      route.request().method() === "POST"
    ) {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    if (/^\/api\/session\/[^/]+$/.test(path) && route.request().method() === "DELETE") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    const currentSessionMatch = path.match(/^\/api\/session\/([^/]+)$/)
    if (currentSessionMatch) {
      const session = config.sessions.find((item) => item.id === currentSessionMatch[1])
      if (!session) return json(route, { error: "Session not found" }, undefined, 404)
      return json(route, {
        data: currentSession(session, config.directory),
      })
    }

    const messageMatch = path.match(/^\/api\/session\/([^/]+)\/message\/([^/]+)$/)
    if (messageMatch) {
      config.onMessage?.({ sessionID: messageMatch[1]!, messageID: messageMatch[2]! })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const message =
        config.message?.(messageMatch[1]!, messageMatch[2]!) ??
        config.pageMessages(messageMatch[1]!, Number.MAX_SAFE_INTEGER).items.find((item) => item.id === messageMatch[2])
      if (message === undefined) return json(route, { error: "Message not found" }, undefined, 404)
      return json(route, { data: message })
    }

    const messagesMatch = path.match(/^\/api\/session\/([^/]+)\/message$/)
    if (messagesMatch) {
      const token = url.searchParams.get("cursor") ?? undefined
      const before = token ? cursors.get(token) : undefined
      if (token && !before) return json(route, { error: "Invalid cursor" }, undefined, 400)
      config.onMessages?.({ sessionID: messagesMatch[1], before, phase: "start" })
      await config.beforeMessagesResponse?.({ sessionID: messagesMatch[1]!, before })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const pageData = config.pageMessages(messagesMatch[1], Number(url.searchParams.get("limit") ?? 50), before)
      config.onMessages?.({ sessionID: messagesMatch[1], before, phase: "end" })
      const cursor = pageData.cursor ? `cursor_${++nextCursor}` : undefined
      if (cursor) cursors.set(cursor, pageData.cursor!)
      return json(route, {
        data: url.searchParams.get("order") === "asc" ? pageData.items : pageData.items.toReversed(),
        cursor: { next: cursor },
      })
    }

    if (url.port === targetPort && targetPort !== appPort)
      return json(route, { error: `Unhandled mock route: ${path}` }, undefined, 404)
    return route.fallback()
  })
}

function location(config: MockServerConfig) {
  return {
    directory: config.directory,
    project: { id: (config.project as { id?: string }).id, directory: config.directory, canonical: config.directory },
  }
}

function providerConfig(config: MockServerConfig) {
  return typeof config.provider === "function" ? config.provider() : config.provider
}

function currentProviders(value: unknown) {
  if (!record(value) || !Array.isArray(value.all)) return Array.isArray(value) ? value : []
  const connected = new Set(
    Array.isArray(value.connected) ? value.connected.filter((id) => typeof id === "string") : [],
  )
  return value.all.filter(record).flatMap((provider) =>
    typeof provider.id === "string" && typeof provider.name === "string"
      ? [
          {
            id: provider.id,
            name: provider.name,
            package: provider.id,
            activation: connected.has(provider.id) ? "enabled" : "auto",
          },
        ]
      : [],
  )
}

function currentModels(value: unknown) {
  if (!record(value) || !Array.isArray(value.all)) return []
  return value.all.filter(record).flatMap((provider) => {
    if (typeof provider.id !== "string" || !record(provider.models)) return []
    return Object.values(provider.models)
      .filter(record)
      .flatMap((model) => {
        if (typeof model.id !== "string" || typeof model.name !== "string") return []
        const limit = record(model.limit) ? model.limit : {}
        const cost = record(model.cost) ? model.cost : {}
        return [
          {
            id: model.id,
            modelID: model.id,
            providerID: provider.id,
            name: model.name,
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            variants: record(model.variants)
              ? Object.entries(model.variants).map(([id, settings]) => ({
                  id,
                  ...(jsonRecord(settings) ? { settings: jsonRecord(settings) } : {}),
                }))
              : [],
            time: { released: Date.now() },
            cost: [
              {
                input: typeof cost.input === "number" ? cost.input : 0,
                output: typeof cost.output === "number" ? cost.output : 0,
                cache: { read: 0, write: 0 },
              },
            ],
            status: "active",
            enabled: true,
            limit: {
              context: typeof limit.context === "number" ? limit.context : 200_000,
              output: typeof limit.output === "number" ? limit.output : 32_000,
            },
          },
        ]
      })
  })
}

function currentDefaultModel(value: unknown) {
  if (!record(value) || !record(value.default)) return null
  const selected = value.default
  const models = currentModels(value)
  return models.find((model) => model.providerID === selected.providerID && model.id === selected.modelID) ?? null
}

function currentPermission(value: unknown) {
  const permission = value as Record<string, unknown>
  if (permission.action) return permission
  const tool = permission.tool as { messageID?: string; callID?: string; id?: string } | undefined
  return {
    id: permission.id,
    sessionID: permission.sessionID,
    action: permission.permission,
    resources: permission.patterns ?? [],
    save: permission.always,
    metadata: permission.metadata,
    source:
      tool?.messageID && (tool.id || tool.callID)
        ? { type: "tool", messageID: tool.messageID, id: tool.id ?? tool.callID }
        : undefined,
  }
}

export function currentSession(session: { id: string } & Record<string, unknown>, fallbackDirectory?: string) {
  const time = session.time && typeof session.time === "object" ? session.time : {}
  const location = session.location && typeof session.location === "object" ? session.location : {}
  return {
    id: session.id,
    parentID: session.parentID,
    projectID: session.projectID ?? "project",
    agent: session.agent ?? "build",
    model: session.model ?? { id: "mock-model", providerID: "mock-provider" },
    cost: session.cost ?? 0,
    tokens: session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created: "created" in time && typeof time.created === "number" ? time.created : 0,
      updated: "updated" in time && typeof time.updated === "number" ? time.updated : 0,
      ...(session.time && typeof session.time === "object" && "archived" in session.time
        ? { archived: session.time.archived }
        : {}),
    },
    title: session.title ?? session.id,
    location: {
      directory:
        "directory" in location && typeof location.directory === "string"
          ? location.directory
          : typeof session.directory === "string"
            ? session.directory
            : fallbackDirectory,
      ...(typeof session.workspaceID === "string"
        ? { workspaceID: session.workspaceID }
        : "workspaceID" in location && typeof location.workspaceID === "string"
          ? { workspaceID: location.workspaceID }
          : {}),
    },
    subpath: session.subpath ?? session.path,
    revert: session.revert,
  }
}

function jsonRecord(value: unknown): Record<string, JsonValue> | undefined {
  if (!record(value)) return
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const next = jsonValue(item)
      return next === undefined ? [] : [[key, next]]
    }),
  )
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map((item) => jsonValue(item) ?? null)
  return jsonRecord(value)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
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
