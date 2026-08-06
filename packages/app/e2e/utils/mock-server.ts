import type { Page, Route } from "@playwright/test"
import type {
  JsonValue,
  PromptAgentAttachment,
  PromptFileAttachment,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionStructuredError,
} from "@opencode-ai/client/promise"

const emptyList = new Set(["/skill", "/command", "/lsp", "/formatter", "/vcs/status", "/vcs/diff"])
const emptyObject = new Set(["/global/config", "/config", "/provider/auth", "/mcp", "/experimental/resource"])

export interface MockServerConfig {
  protocol?: "v1" | "v2"
  provider: unknown | (() => unknown)
  integrationMethods?: Record<string, unknown[]>
  onConnectKey?: (input: { integrationID: string; body: unknown }) => void
  onInstanceDispose?: () => void
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
  sessionStatus?: Record<string, unknown> | (() => Record<string, unknown>)
}

export async function mockOpenCodeServer(page: Page, config: MockServerConfig) {
  const cursors = new Map<string, string>()
  let nextCursor = 0
  const staticRoutes: Record<string, unknown> = {
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
    if (path === "/global/event" || path === "/event" || path === "/api/event") {
      const events = config.events?.()
      return sse(
        route,
        path === "/api/event"
          ? [{ id: "evt_mock_connected", type: "server.connected", data: {} }, ...(events?.map(currentEvent) ?? [])]
          : [
              ...(path === "/global/event"
                ? [{ payload: { id: "evt_mock_connected", type: "server.connected", properties: {} } }]
                : []),
              ...(events ?? []),
            ],
        config.eventRetry,
      )
    }
    if (path === "/global/health")
      return config.protocol === "v2" ? json(route, {}, undefined, 404) : json(route, { healthy: true })
    if (path === "/api/health") return json(route, { healthy: true, version: "2.0.0", pid: 1 })
    if (path === "/experimental/capabilities") return json(route, { backgroundSubagents: true })
    if (path === "/provider") return json(route, providerConfig(config))
    if (path === "/provider/auth") return json(route, config.integrationMethods ?? {})
    const legacyAuth = path.match(/^\/auth\/([^/]+)$/)?.[1]
    if (legacyAuth && route.request().method() === "PUT") {
      config.onConnectKey?.({ integrationID: legacyAuth, body: route.request().postDataJSON() })
      return json(route, true)
    }
    if (path === "/instance/dispose" && route.request().method() === "POST") {
      config.onInstanceDispose?.()
      return json(route, true)
    }
    if (path === "/permission")
      return json(route, typeof config.permissions === "function" ? config.permissions() : (config.permissions ?? []))
    if (path === "/question")
      return json(route, typeof config.questions === "function" ? config.questions() : (config.questions ?? []))
    if (path === "/session/status")
      return json(
        route,
        typeof config.sessionStatus === "function" ? config.sessionStatus() : (config.sessionStatus ?? {}),
      )
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
    if (path === "/api/model") return json(route, { location: location(config), data: currentModels(providerConfig(config)) })
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
    if (path === "/api/project") return json(route, [config.project])
    if (path === "/api/project/current")
      return json(route, { id: (config.project as { id?: string }).id, directory: config.directory })
    if (path === "/api/location") return json(route, location(config))
    const projectCopy = path.match(/^\/experimental\/project\/([^/]+)\/copy$/)?.[1]
    if (projectCopy && route.request().method() === "POST") {
      const input = route.request().postDataJSON() as { directory: string; name?: string }
      return json(route, { directory: `${input.directory}/${input.name ?? "copy"}` })
    }
    if (projectCopy && route.request().method() === "DELETE")
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    if (path === "/api/permission/request")
      return json(route, {
        location: location(config),
        data: (typeof config.permissions === "function" ? config.permissions() : (config.permissions ?? [])).map(
          currentPermission,
        ),
      })
    if (path === "/api/question/request")
      return json(route, {
        location: location(config),
        data: typeof config.questions === "function" ? config.questions() : (config.questions ?? []),
      })
    if (path === "/api/vcs")
      return json(route, { location: location(config), data: { branch: "main", defaultBranch: "main" } })
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
      const content = value && typeof value === "object" && "content" in value ? String(value.content) : String(value ?? "")
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
    if (path === "/api/pty/shells") return json(route, { location: location(config), data: [] })
    if (/^\/api\/pty\/[^/]+\/connect-token$/.test(path))
      return json(route, { location: location(config), data: { ticket: "e2e-ticket", expires_in: 60 } })
    if (path === "/api/session") {
      const directory = url.searchParams.get("directory")
      const parentID = url.searchParams.get("parentID")
      const limit = Number(url.searchParams.get("limit") ?? 50)
      const offset = Number(url.searchParams.get("cursor") ?? 0)
      const sessions = config.sessions
        .filter((session) => !directory || session.directory === directory)
        .filter((session) => parentID !== "null" || session.parentID === undefined)
        .filter((session) => {
          const search = url.searchParams.get("search")?.toLowerCase()
          return (
            !search ||
            String(session.title ?? "")
              .toLowerCase()
              .includes(search)
          )
        })
      const ordered = url.searchParams.get("order") === "asc" ? sessions.toReversed() : sessions
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
    if (/^\/api\/session\/[^/]+\/question\/[^/]+\/(reply|reject)$/.test(path) && route.request().method() === "POST") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    if (/^\/api\/session\/[^/]+\/permission\/[^/]+\/reply$/.test(path) && route.request().method() === "POST") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    if (/^\/question\/[^/]+\/(reply|reject)$/.test(path) && route.request().method() === "POST") return json(route, true)
    if (/^\/session\/[^/]+\/permissions\/[^/]+$/.test(path) && route.request().method() === "POST")
      return json(route, true)
    if (
      /^\/api\/session\/[^/]+\/(archive|rename|interrupt|revert\/clear|revert\/commit)$/.test(path) &&
      route.request().method() === "POST"
    ) {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    if (/^\/api\/session\/[^/]+$/.test(path) && route.request().method() === "DELETE") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    if (emptyObject.has(path)) return json(route, {})
    if (emptyList.has(path)) return json(route, [])
    if (path in staticRoutes) return json(route, staticRoutes[path])

    const currentSessionMatch = path.match(/^\/api\/session\/([^/]+)$/)
    if (currentSessionMatch) {
      const session = config.sessions.find((item) => item.id === currentSessionMatch[1])
      if (!session) return json(route, { error: "Session not found" }, undefined, 404)
      return json(route, {
        data: currentSession(session, config.directory),
      })
    }

    const currentMessageMatch = path.match(/^\/api\/session\/([^/]+)\/message\/([^/]+)$/)
    if (currentMessageMatch) {
      config.onMessage?.({ sessionID: currentMessageMatch[1]!, messageID: currentMessageMatch[2]! })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const message = config.message?.(currentMessageMatch[1]!, currentMessageMatch[2]!)
      if (message === undefined) return json(route, { error: "Message not found" }, undefined, 404)
      return json(route, { data: currentMessage(message) })
    }

    const sessionMatch = path.match(/^\/session\/([^/]+)$/)
    if (sessionMatch) return json(route, config.sessions.find((session) => session.id === sessionMatch[1]) ?? {})

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

    const currentMessagesMatch = path.match(/^\/api\/session\/([^/]+)\/message$/)
    if (currentMessagesMatch) {
      const token = url.searchParams.get("cursor") ?? undefined
      const before = token ? cursors.get(token) : undefined
      if (token && !before) return json(route, { error: "Invalid cursor" }, undefined, 400)
      config.onMessages?.({ sessionID: currentMessagesMatch[1], before, phase: "start" })
      await config.beforeMessagesResponse?.({ sessionID: currentMessagesMatch[1]!, before })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const pageData = config.pageMessages(currentMessagesMatch[1], Number(url.searchParams.get("limit") ?? 50), before)
      config.onMessages?.({ sessionID: currentMessagesMatch[1], before, phase: "end" })
      const cursor = pageData.cursor ? `cursor_${++nextCursor}` : undefined
      if (cursor) cursors.set(cursor, pageData.cursor!)
      return json(route, {
        data: pageData.items.map(currentMessage).reverse(),
        cursor: { next: cursor },
      })
    }

    const messagesMatch = path.match(/^\/session\/([^/]+)\/message$/)
    if (messagesMatch) {
      const token = url.searchParams.get("before") ?? undefined
      const before = token ? cursors.get(token) : undefined
      if (token && !before) return json(route, { error: "Invalid cursor" }, undefined, 400)
      config.onMessages?.({ sessionID: messagesMatch[1], before, phase: "start" })
      await config.beforeMessagesResponse?.({ sessionID: messagesMatch[1]!, before })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const pageData = config.pageMessages(messagesMatch[1], Number(url.searchParams.get("limit") ?? 80), before)
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
  return value.all.filter(record).flatMap((provider) =>
    typeof provider.id === "string" && typeof provider.name === "string"
      ? [{ id: provider.id, name: provider.name, package: provider.id }]
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
  return models.find(
    (model) => model.providerID === selected.providerID && model.id === selected.modelID,
  ) ?? null
}

function currentPermission(value: unknown) {
  const permission = value as Record<string, unknown>
  if (permission.action) return permission
  const tool = permission.tool as { messageID?: string; callID?: string } | undefined
  return {
    id: permission.id,
    sessionID: permission.sessionID,
    action: permission.permission,
    resources: permission.patterns ?? [],
    save: permission.always,
    metadata: permission.metadata,
    source:
      tool?.messageID && tool.callID ? { type: "tool", messageID: tool.messageID, callID: tool.callID } : undefined,
  }
}

export function currentSession(session: { id: string } & Record<string, unknown>, fallbackDirectory?: string) {
  const time = session.time && typeof session.time === "object" ? session.time : {}
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
      directory: typeof session.directory === "string" ? session.directory : fallbackDirectory,
      ...(typeof session.workspaceID === "string" ? { workspaceID: session.workspaceID } : {}),
    },
    subpath: session.path,
    revert: session.revert,
  }
}

export function currentMessage(value: unknown): SessionMessageInfo {
  if (isCurrentMessage(value)) return value
  if (!record(value) || !record(value.info) || !Array.isArray(value.parts)) throw new Error("Invalid message fixture")

  const info = value.info
  const parts = value.parts.filter(record)
  if (typeof info.id !== "string" || !record(info.time) || typeof info.time.created !== "number")
    throw new Error("Invalid legacy message fixture")

  const time = {
    created: info.time.created,
    ...(typeof info.time.completed === "number" ? { completed: info.time.completed } : {}),
  }
  if (info.role === "user") {
    return {
      id: info.id,
      type: "user",
      time: { created: time.created },
      text: parts
        .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
        .join("\n"),
      files: parts.flatMap((part) => (part.type === "file" ? legacyFile(part) : [])),
      agents: parts.flatMap((part) => (part.type === "agent" ? legacyAgent(part) : [])),
    }
  }
  if (info.role !== "assistant") throw new Error("Invalid legacy message role")

  return {
    id: info.id,
    type: "assistant",
    time,
    agent: typeof info.agent === "string" ? info.agent : typeof info.mode === "string" ? info.mode : "build",
    model: {
      id: typeof info.modelID === "string" ? info.modelID : "model",
      providerID: typeof info.providerID === "string" ? info.providerID : "provider",
      ...(typeof info.variant === "string" ? { variant: info.variant } : {}),
    },
    content: parts.flatMap((part) => legacyAssistantContent(part, time.created)),
    ...(typeof info.cost === "number" ? { cost: info.cost } : {}),
    ...(tokens(info.tokens) ? { tokens: tokens(info.tokens) } : {}),
    ...(structuredError(info.error) ? { error: structuredError(info.error) } : {}),
    ...(finish(info.finish) ? { finish: finish(info.finish) } : {}),
  }
}

function isCurrentMessage(value: unknown): value is SessionMessageInfo {
  return record(value) && typeof value.id === "string" && typeof value.type === "string" && !record(value.info)
}

function legacyFile(part: Record<string, unknown>): PromptFileAttachment[] {
  if (typeof part.mime !== "string" || typeof part.url !== "string") return []
  const data = part.url.match(/^data:[^,]*;base64,(.*)$/)?.[1] ?? ""
  const source = record(part.source) ? part.source : undefined
  const sourceText = source && record(source.text) ? source.text : undefined
  const mention = mentionFrom(sourceText)
  const uri = source?.type === "resource" && typeof source.uri === "string" ? source.uri : part.url
  return [
    {
      data,
      mime: part.mime,
      source: part.url.startsWith("data:") ? { type: "inline" } : { type: "uri", uri },
      ...(typeof part.filename === "string" ? { name: part.filename } : {}),
      ...(mention ? { mention } : {}),
    },
  ]
}

function legacyAgent(part: Record<string, unknown>): PromptAgentAttachment[] {
  if (typeof part.name !== "string") return []
  const mention = mentionFrom(record(part.source) ? part.source : undefined)
  return [{ name: part.name, ...(mention ? { mention } : {}) }]
}

function mentionFrom(value: Record<string, unknown> | undefined) {
  if (
    !value ||
    typeof value.value !== "string" ||
    typeof value.start !== "number" ||
    typeof value.end !== "number"
  )
    return
  return { text: value.value, start: value.start, end: value.end }
}

function legacyAssistantContent(
  part: Record<string, unknown>,
  created: number,
): SessionMessageAssistant["content"] {
  if (part.type === "text" && typeof part.text === "string")
    return [{ type: "text", text: part.text, ...(jsonRecord(part.metadata) ? { state: jsonRecord(part.metadata) } : {}) }]
  if (part.type === "reasoning" && typeof part.text === "string") {
    const time = record(part.time) ? part.time : undefined
    return [
      {
        type: "reasoning",
        text: part.text,
        ...(jsonRecord(part.metadata) ? { state: jsonRecord(part.metadata) } : {}),
        ...(time && typeof time.start === "number"
          ? {
              time: {
                created: time.start,
                ...(typeof time.end === "number" ? { completed: time.end } : {}),
              },
            }
          : {}),
      },
    ]
  }
  if (part.type !== "tool" || typeof part.id !== "string" || typeof part.tool !== "string" || !record(part.state))
    return []

  const state = part.state
  const time = record(state.time) ? state.time : undefined
  const toolTime = {
    created: time && typeof time.start === "number" ? time.start : created,
    ...(time && typeof time.start === "number" ? { ran: time.start } : {}),
    ...(time && typeof time.end === "number" ? { completed: time.end } : {}),
  }
  const input = jsonRecord(state.input) ?? {}
  const metadata = jsonRecord(state.metadata)
  const base = {
    type: "tool" as const,
    id: typeof part.callID === "string" ? part.callID : part.id,
    name: part.tool,
    time: toolTime,
    ...(typeof part.executed === "boolean" ? { executed: part.executed } : {}),
    ...(jsonRecord(part.providerState) ? { providerState: jsonRecord(part.providerState) } : {}),
    ...(jsonRecord(part.providerResultState) ? { providerResultState: jsonRecord(part.providerResultState) } : {}),
  }
  if (state.status === "pending")
    return [{ ...base, state: { status: "streaming", input: typeof state.raw === "string" ? state.raw : JSON.stringify(input) } }]
  if (state.status === "completed")
    return [
      {
        ...base,
        state: {
          status: "completed",
          input,
          content: [{ type: "text", text: typeof state.output === "string" ? state.output : "" }],
          ...(metadata ? { metadata } : {}),
        },
      },
    ]
  if (state.status === "error")
    return [
      {
        ...base,
        state: {
          status: "error",
          input,
          error: structuredError(state.error) ?? { type: "ToolError", message: "Tool failed" },
          ...(metadata ? { metadata } : {}),
        },
      },
    ]
  return [{ ...base, state: { status: "running", input, metadata: metadata ?? {} } }]
}

function structuredError(value: unknown): SessionStructuredError | undefined {
  if (typeof value === "string") return { type: "Error", message: value }
  if (!record(value)) return
  if (typeof value.type === "string" && typeof value.message === "string")
    return { type: value.type, message: value.message }
  if (typeof value.name !== "string" || !record(value.data) || typeof value.data.message !== "string") return
  return { type: value.name, message: value.data.message }
}

function tokens(value: unknown): SessionMessageAssistant["tokens"] | undefined {
  if (!record(value) || !record(value.cache)) return
  if (
    typeof value.input !== "number" ||
    typeof value.output !== "number" ||
    typeof value.reasoning !== "number" ||
    typeof value.cache.read !== "number" ||
    typeof value.cache.write !== "number"
  )
    return
  return {
    input: value.input,
    output: value.output,
    reasoning: value.reasoning,
    cache: { read: value.cache.read, write: value.cache.write },
  }
}

function finish(value: unknown): SessionMessageAssistant["finish"] | undefined {
  if (
    value === "stop" ||
    value === "length" ||
    value === "tool-calls" ||
    value === "content-filter" ||
    value === "error" ||
    value === "unknown"
  )
    return value
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

function currentEvent(input: unknown) {
  if (!input || typeof input !== "object" || !("payload" in input)) return input
  const envelope = input as { directory?: string; payload?: unknown }
  if (!envelope.payload || typeof envelope.payload !== "object") return input
  const payload = envelope.payload as { id?: string; type?: string; properties?: unknown }
  if (!payload.type) return input
  return {
    id: payload.id ?? `evt_mock_${Date.now()}`,
    created: Date.now(),
    type: payload.type,
    data: payload.properties ?? {},
    location: envelope.directory && envelope.directory !== "global" ? { directory: envelope.directory } : undefined,
  }
}
