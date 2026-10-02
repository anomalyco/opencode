import type { Page } from "@playwright/test"
import type { JsonValue, OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import { Duration, Effect, Layer } from "effect"
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { SERVER } from "./app"
import { MockApi, MockBadRequest, MockInternal, MockNotFound, MockShellNotFound, MockUnsupported } from "./mock-api"
import { installSseTransport } from "./sse-transport"

type Resolvable<T> = T | (() => T)

// A hook's replacement response.
export type MockAnswer = { status: number; body: unknown }

export interface MockServerConfig {
  server?: string
  provider: unknown | (() => unknown)
  integrations?: unknown[]
  onConnectKey?: (input: { integrationID: string; body: unknown }) => void
  // Terminal shells the settings offer (`/api/config/shell`).
  shells?: unknown[]
  // Background shell commands (`GET /api/shell`).
  shellCommands?: Resolvable<unknown[]>
  // All output a shell command has captured so far in `directory`, or undefined for an unknown command (404
  // ShellNotFoundError). The mock pages it like the server: from the request's byte `cursor`, at most `limit` bytes
  // (default 65,536).
  shellOutput?: (input: { id: string; directory: string }) => string | undefined
  // Records `POST /api/experimental/fs/write` (attachment uploads), which answers the requested path.
  // Without it, writes answer 501 MockUnsupported.
  onFileWrite?: (input: { path: string; directory: string; body: string }) => void
  configEntries?: unknown[]
  directory: string
  project: unknown
  // Replaces the `/api/project` inventory, which defaults to `[project]`.
  projects?: Resolvable<unknown[]>
  sessions: ({ id: string } & Record<string, unknown>)[]
  pageMessages: (
    sessionId: string,
    limit: number,
    before?: string,
  ) => {
    items: SessionMessageInfo[]
    cursor?: string
  }
  vcs?: { current: string; default: string }
  // Initializes the mock project's VCS; without a handler this mutation answers 501.
  onVcsInit?: (input: { directory: string; provider?: string }) => void
  vcsDiff?: unknown[] | ((input: { mode?: string }) => unknown[])
  // Benchmark latency only. Tests hold message pages with `beforeMessagesResponse`.
  messageDelay?: number
  beforeMessagesResponse?: (input: { sessionID: string; before?: string }) => Promise<void>
  onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void
  message?: (sessionID: string, messageID: string) => SessionMessageInfo | undefined
  onMessage?: (input: { sessionID: string; messageID: string }) => void
  onRevertStage?: (input: { sessionID: string; messageID: string }) => void
  onSession?: (sessionID: string) => void
  events?: () => OpenCodeEvent[]
  eventRetry?: number
  // Idle event streams send a comment every 15 s like the real server. Set false only to test the client's stall watchdog.
  keepalive?: boolean
  permissions?: unknown[] | (() => unknown[])
  // Requests only listed by `/api/session/:id/permission`, keyed by session ID.
  sessionPermissions?: Record<string, unknown[]>
  // Returning true fails the next `/api/permission/request` listing with a 500.
  permissionListFailures?: () => boolean
  // Without it, permission replies answer 501 MockUnsupported.
  onPermissionReply?: (input: { sessionID: string; permissionID: string; body: unknown }) => void
  forms?: unknown[] | (() => unknown[])
  // MCP servers. A list serves every workspace; a function receives the requested directory.
  mcp?: unknown[] | ((directory: string) => unknown[])
  // Connect/disconnect record the server's new status in that workspace (`connected`/`disabled`); the hook may return
  // another status (for example `{ status: "failed", error }`). Unknown servers answer 404.
  onMcpAction?: (input: {
    server: string
    action: "connect" | "disconnect"
    directory: string
  }) => void | Record<string, unknown>
  // Starts an OAuth attempt (POST .../connect/oauth) and returns its authorization URL; the attempt then stays pending.
  // Without it, OAuth connects answer 501 MockUnsupported.
  onIntegrationOAuth?: (input: { integrationID: string; directory: string; body: unknown }) => { url: string }
  plugins?: Resolvable<unknown[]>
  skills?: Resolvable<unknown[]>
  // Replaces the `/api/worktree` inventory, which defaults to the directory plus project sandboxes.
  worktrees?: Resolvable<unknown[]>
  // Without them, creating or removing a worktree answers 501 MockUnsupported. `onWorktreeCreate` may hold the request
  // and return the answer; by default it creates `<directory>/<name>`. A created directory joins the project's sandboxes.
  onWorktreeCreate?: (input: unknown) => void | MockAnswer | Promise<void | MockAnswer>
  onWorktreeRemove?: (input: unknown) => void | Promise<void>
  // POST /api/session keeps the client-reserved `id` and `location`. Return an answer to fail the attempt (1-based).
  onSessionCreate?: (body: Record<string, unknown>, attempt: number) => void | MockAnswer
  // Title of created sessions (default: the request's title, else "New session").
  createdSessionTitle?: string
  // Slash commands served by `/api/command`.
  commands?: Resolvable<unknown[]>
  // Records POST /api/session/:id/command (204). Without it, commands answer 501 MockUnsupported.
  onCommand?: (input: { sessionID: string; body: unknown }) => void
  fileList?: (path: string) => unknown | Promise<unknown>
  fileContent?: (path: string) => unknown | Promise<unknown>
  findFiles?: (input: { query: string; dirs?: string; limit?: number }) => unknown
  sessionStatus?: Record<string, unknown> | (() => Record<string, unknown>)
  inbox?: unknown[] | (() => unknown[])
  onPrompt?: (input: { sessionID: string; body: Record<string, unknown> }) => void
  generate?: (input: { sessionID: string; prompt: string }) => { text: string } | Promise<{ text: string }>
  onInboxChange?: (input: { sessionID: string; inboxID: string; action: "cancel" | "steer" | "queue" }) => void
  // Serves `/api/pty*` and mock PTY WebSockets. Created IDs are the first unused `${prefix}<n>` (prefix must start with "pty").
  // `directory` is the owning workspace (Location); `cwd` is the reported working directory (default: `directory`).
  pty?: { prefix?: string; initial?: { id: string; title: string; directory?: string; cwd?: string }[] }
  // Answers 500 InvalidDirectory when a request names a directory this server does not own.
  strictDirectory?: boolean
  // Answers 401 UnauthorizedError unless a request carries this password; a function may change it mid-test.
  password?: Resolvable<string>
}

export type MockPtyInfo = {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  pid: number
}

export type MockPtySocket = { id: string; url: URL; input: string[]; closed: boolean; send(data: string): void }

export type MockPty = {
  list: MockPtyInfo[]
  created: MockPtyInfo[]
  removed: string[]
  updates: { id: string; body: unknown }[]
  tokens: { id: string; headers: Record<string, string>; ticket: string }[]
  sockets: MockPtySocket[]
  // WebSockets closed with 1008 because the PTY, its workspace, or an unused issued ticket did not match.
  rejected: { id: string; url: URL; reason: string }[]
  // Writes output to the newest open socket, optionally for one PTY.
  send(data: string, id?: string): void
}

type MockStream = { push: (payloads: unknown[]) => void }

type MockStreamWindow = Window & {
  // Set to any value by benchmarks that bring their own event stream.
  __testSseTransport?: unknown
  // `installSseTransport` registrations; `command` takes its browser command shape.
  __testSseTransports?: Record<string, { command: (input: unknown) => unknown }>
  // Per-origin mock event streams; in-page benchmark probes push through them directly.
  __mockServerStreams?: Record<string, MockStream>
}

export async function mockOpenCodeServer(page: Page, config: MockServerConfig) {
  const server = config.server ?? SERVER

  mockedOrigins(page).add(server)

  await page.addInitScript(
    ({ server, retry, keepalive: idle }) => {
      const host = window as MockStreamWindow
      if (host.__testSseTransport || host.__testSseTransports?.[server] || host.__mockServerStreams?.[server]) return
      const originalFetch = window.fetch.bind(window)
      const encoder = new TextEncoder()
      const state: {
        controller?: ReadableStreamDefaultController<Uint8Array>
        buffer: string[]
        connections: number
      } = { buffer: [], connections: 0 }
      const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
      const stream = {
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
      host.__mockServerStreams = { ...host.__mockServerStreams, [server]: stream }
      const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        if (url.origin !== server || url.pathname !== "/api/event") return originalFetch(request)
        state.connections += 1
        const id = state.connections
        let ended = false
        let own: ReadableStreamDefaultController<Uint8Array> | undefined
        let keepalive: ReturnType<typeof setInterval> | undefined
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            own = controller
            state.controller = controller
            if (retry !== undefined) controller.enqueue(encoder.encode(`retry: ${retry}\n\n`))
            controller.enqueue(
              encoder.encode(frame({ id: `evt_mock_connected_${id}`, type: "server.connected", data: {} })),
            )
            state.buffer.splice(0).forEach((item) => controller.enqueue(encoder.encode(item)))
            // Match the real server's idle stream so long scenarios do not
            // trigger the client's 45-second stall watchdog and reload history.
            if (idle) keepalive = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 15_000)
            request.signal.addEventListener(
              "abort",
              () => {
                if (ended) return
                ended = true
                clearInterval(keepalive)
                if (state.controller === controller) state.controller = undefined
                controller.error(request.signal.reason ?? new DOMException("The operation was aborted", "AbortError"))
              },
              { once: true },
            )
          },
          cancel() {
            if (ended) return
            ended = true
            clearInterval(keepalive)
            if (state.controller === own) state.controller = undefined
          },
        })
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "cache-control": "no-cache", "content-type": "text/event-stream" },
          }),
        )
      }
      Object.defineProperty(window, "fetch", { configurable: true, writable: true, value: fetch })
    },
    { server, retry: config.eventRetry, keepalive: config.keepalive !== false },
  )

  // Delivers events on this server's mock stream; buffered until the app connects.
  // An origin served by an SSE transport receives the events as one burst on its active connection.
  const push = (payloads: readonly OpenCodeEvent[]) =>
    page.evaluate(
      ({ server, payloads }) => {
        const host = window as MockStreamWindow
        const stream = host.__mockServerStreams?.[server]
        if (stream) return stream.push(payloads)
        const transport = host.__testSseTransports?.[server]
        if (!transport) throw new Error(`No mock event stream for ${server}`)
        transport.command({ type: "send", deliveries: payloads.map((payload) => ({ payload })), burst: true })
      },
      { server, payloads: payloads as unknown[] },
    )
  // Server-side events the mock publishes itself; delivery failures other than a missing document fail the test.
  const emit = (events: OpenCodeEvent[]) =>
    void push(events).catch((error: unknown) => {
      if (page.isClosed() || retryableDelivery(error)) return
      throw error
    })

  if (config.events) {
    // Batches stay queued until the page accepts them; failures other than a missing document fail the test.
    const pump = { busy: false, pending: [] as OpenCodeEvent[] }
    const timer = setInterval(() => {
      if (pump.busy) return
      pump.pending.push(...(config.events?.() ?? []))
      if (pump.pending.length === 0) return
      pump.busy = true
      const batch = pump.pending.slice()
      void push(batch)
        .then(
          () => {
            pump.pending.splice(0, batch.length)
          },
          (error: unknown) => {
            if (page.isClosed()) return clearInterval(timer)
            if (retryableDelivery(error)) return
            clearInterval(timer)
            throw error
          },
        )
        .finally(() => {
          pump.busy = false
        })
    }, 50)
    page.on("close", () => clearInterval(timer))
  }
  const transport = createMockServerHandler(config, emit)
  page.on("close", () => void transport.dispose())

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    if (!answers(page, server, url)) return route.fallback()
    // Production serves the UI and API from one origin; leave app assets to Vite.
    if (!url.pathname.startsWith("/api/")) return route.fallback()
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders })
    }
    const password = config.password === undefined ? undefined : resolve(config.password)
    if (
      password !== undefined &&
      (await route.request().headerValue("authorization")) !== `Basic ${btoa(`opencode:${password}`)}`
    ) {
      return route.fulfill({
        status: 401,
        headers: corsHeaders,
        json: { _tag: "UnauthorizedError", message: "Authentication required" },
      })
    }
    const directory = url.searchParams.get("directory") ?? url.searchParams.get("location[directory]")
    if (config.strictDirectory && directory && !ownedDirectories(config).has(directory)) {
      return route.fulfill({ status: 500, headers: corsHeaders, json: { name: "InvalidDirectory" } })
    }

    const body = route.request().postDataBuffer()
    const response = await transport.handler(
      new Request(url, {
        method: route.request().method(),
        headers: route.request().headers(),
        body: body ? Uint8Array.from(body) : undefined,
      }),
    )
    const payload = Buffer.from(await response.arrayBuffer())
    // A handler's 404 carries a tagged error; a route the mock does not define must not reach the app server, whose
    // SPA fallback would answer HTML 200. Answer 501 and fail the test from the route handler.
    if (response.status === 404 && !payload.toString().includes('"_tag"')) {
      const request = `${route.request().method()} ${url.pathname}`
      await route.fulfill({
        status: 501,
        headers: corsHeaders,
        json: { name: "MockUnsupported", message: `The mock server has no route for ${request}` },
      })
      throw new Error(`Unmocked API request: ${request} (add it to e2e/utils/mock-server.ts)`)
    }
    return route.fulfill({
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      body: payload,
    })
  })

  if (config.pty) {
    const host = new URL(server).host
    await page.routeWebSocket(
      (url) => url.host === host && /^\/api\/pty\/[^/]+\/connect$/.test(url.pathname),
      (ws) => {
        const url = new URL(ws.url())
        const id = decodeURIComponent(url.pathname.split("/")[3]!)
        const reason = transport.pty.admit(id, url)
        if (reason) {
          transport.pty.rejected.push({ id, url, reason })
          return ws.close({ code: 1008, reason })
        }
        const socket: MockPtySocket = {
          id,
          url,
          input: [],
          closed: false,
          send: (data) => ws.send(data),
        }
        ws.onMessage((message) => socket.input.push(message.toString()))
        ws.onClose(() => {
          socket.closed = true
        })
        transport.pty.sockets.push(socket)
      },
    )
  }

  return { server, pty: transport.pty, push }
}

// Mocks several servers on one page. Each origin gets its own handler and its own SSE transport for events.
export async function mockServers(page: Page, servers: Record<string, Omit<MockServerConfig, "server" | "events">>) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(servers).map(async ([origin, config]) => {
        const transport = await installSseTransport(page, {
          server: origin,
          retry: config.eventRetry,
          keepalive: config.keepalive,
        })
        const mock = await mockOpenCodeServer(page, { ...config, server: origin })
        return [origin, { transport, pty: mock.pty }] as const
      }),
    ),
  )
}

// `emit` publishes the events a real server sends after a mutation (without a page, nothing is published).
export function createMockServerHandler(config: MockServerConfig, emit: (events: OpenCodeEvent[]) => void = () => {}) {
  const pty = createPty(config)
  const web = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(MockApi).pipe(
      Layer.provide(
        mockHandlers(config, {
          cursors: new Map<string, string>(),
          nextCursor: 0,
          sessionCreates: 0,
          pty,
          emit,
          mcp: new Map<string, Record<string, unknown>>(),
          attempts: new Map<string, number>(),
        }),
      ),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  )
  return { ...web, pty }
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "x-next-cursor",
}

const APP_ORIGIN = new URL(
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
).origin
const registeredOrigins = new WeakMap<Page, Set<string>>()

function mockedOrigins(page: Page) {
  const found = registeredOrigins.get(page)
  if (found) return found
  const created = new Set<string>()
  registeredOrigins.set(page, created)
  return created
}

// A server answers its own origin. Production builds call the API on the app origin, which the default server also
// answers unless a server was configured for the app origin explicitly.
function answers(page: Page, server: string, url: URL) {
  if (url.origin === server) return true
  return server === SERVER && url.origin === APP_ORIGIN && !mockedOrigins(page).has(APP_ORIGIN)
}

// The document is not loaded yet or is being replaced; the pump retries on its next tick.
function retryableDelivery(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return [
    "No mock event stream",
    "Execution context was destroyed",
    "Target page, context or browser has been closed",
  ].some((text) => message.includes(text))
}

const PTY_TICKET = "e2e-ticket"

function createPty(config: MockServerConfig) {
  const info = (id: string, title: string, cwd = config.directory): MockPtyInfo => ({
    id,
    title,
    command: "cmd.exe",
    args: [],
    cwd,
    status: "running",
    pid: 1,
  })
  // Core scopes PTYs by Location, which can differ from the process cwd, so ownership is kept apart from `cwd`.
  const owners = new Map((config.pty?.initial ?? []).map((item) => [item.id, item.directory ?? config.directory]))
  // Issued, not yet used connect tickets, each bound to one PTY and workspace.
  const tickets: { id: string; directory: string; ticket: string }[] = []
  const issued = { count: 0 }
  const owns = (item: MockPtyInfo, directory: string) => owners.get(item.id) === directory
  const pty: MockPty = {
    list: (config.pty?.initial ?? []).map((item) => info(item.id, item.title, item.cwd ?? item.directory)),
    created: [],
    removed: [],
    updates: [],
    tokens: [],
    sockets: [],
    rejected: [],
    send(data, id) {
      const socket = pty.sockets.findLast((item) => !item.closed && (id === undefined || item.id === id))
      if (!socket) throw new Error(`No open PTY socket${id ? ` for ${id}` : ""}`)
      socket.send(data)
    },
  }
  return Object.assign(pty, {
    info,
    // The first `${prefix}<n>` no initial, created, or removed PTY has used.
    allocate() {
      const prefix = config.pty?.prefix ?? "pty_"
      const used = new Set([...pty.list, ...pty.created].map((item) => item.id).concat(pty.removed))
      const number = Array.from({ length: used.size + 1 }, (_, index) => index + 1).find(
        (value) => !used.has(`${prefix}${value}`),
      )!
      return { id: `${prefix}${number}`, number }
    },
    add(created: MockPtyInfo, directory: string) {
      owners.set(created.id, directory)
      pty.created.push(created)
      pty.list.push(created)
    },
    find: (id: string, directory: string) => pty.list.find((item) => item.id === id && owns(item, directory)),
    owned: (directory: string) => pty.list.filter((item) => owns(item, directory)),
    // Unique per server; the first stays `e2e-ticket` so single-terminal specs can assert a fixed value.
    issue(id: string, directory: string) {
      issued.count += 1
      const ticket = issued.count === 1 ? PTY_TICKET : `${PTY_TICKET}-${issued.count}`
      tickets.push({ id, directory, ticket })
      return ticket
    },
    // Returns why a connect URL is refused: the PTY must exist, belong to the requested workspace, and carry the exact
    // unused ticket issued for that PTY and workspace. Admission consumes the ticket.
    admit(id: string, url: URL) {
      const found = pty.list.find((item) => item.id === id)
      if (!found) return "PTY not found"
      const directory = url.searchParams.get("location[directory]") || config.directory
      if (!owns(found, directory)) return "PTY belongs to another workspace"
      const ticket = url.searchParams.get("ticket")
      const index = tickets.findIndex(
        (item) => item.id === id && item.directory === directory && item.ticket === ticket,
      )
      if (index < 0) return "No unused ticket was issued for this PTY"
      tickets.splice(index, 1)
    },
  })
}

// Every directory this server's configuration names: its own, project and inventory worktrees, and session locations.
function ownedDirectories(config: MockServerConfig) {
  const projects = [config.project, ...(config.projects ? resolve(config.projects) : [])].filter(record)
  return new Set(
    [
      config.directory,
      ...projects.flatMap((item) => [
        item.worktree,
        item.canonical,
        ...(Array.isArray(item.sandboxes) ? item.sandboxes : []),
      ]),
      ...(config.worktrees ? resolve(config.worktrees) : []).filter(record).map((item) => item.directory),
      ...config.sessions.map((session) => (record(session.location) ? session.location.directory : session.directory)),
    ].filter((item): item is string => typeof item === "string"),
  )
}

function addSandbox(config: MockServerConfig, directory: string) {
  const project = config.project as { sandboxes?: string[] }
  if (project.sandboxes?.includes(directory)) return
  project.sandboxes = [...(project.sandboxes ?? []), directory]
}

// The requested `location[directory]`; absent or empty (a server-level read) means the server directory.
function requestDirectory(config: MockServerConfig, request: { url: string }) {
  return new URL(request.url, "http://localhost").searchParams.get("location[directory]") || config.directory
}

function resolve<T>(value: Resolvable<T>) {
  return typeof value === "function" ? (value as () => T)() : value
}

function mockHandlers(
  config: MockServerConfig,
  state: {
    cursors: Map<string, string>
    nextCursor: number
    sessionCreates: number
    pty: ReturnType<typeof createPty>
    emit: (events: OpenCodeEvent[]) => void
    // MCP status overrides by `<directory>\n<server>`, and OAuth attempt creation times by attempt ID.
    mcp: Map<string, Record<string, unknown>>
    attempts: Map<string, number>
  },
) {
  const noContent = Effect.succeed(HttpApiSchema.NoContent.make())
  const delay = config.messageDelay === undefined ? Effect.void : Effect.sleep(Duration.millis(config.messageDelay))
  const configEntries = config.configEntries ?? []
  const ptyEnabled = Effect.suspend(() =>
    config.pty ? Effect.void : Effect.fail(new MockNotFound({ message: "PTY is not enabled for this mock server" })),
  )
  // PTYs are scoped to the workspace (`location[directory]`) they were created in, like the real server.
  const findPty = (id: string, request: { url: string }) =>
    ptyEnabled.pipe(
      Effect.andThen(() =>
        Effect.suspend(() => {
          const directory = requestDirectory(config, request)
          const found = state.pty.find(id, directory)
          return found ? Effect.succeed(found) : Effect.fail(new MockNotFound({ message: "PTY not found" }))
        }),
      ),
    )
  const mcpServers = (directory: string) =>
    (typeof config.mcp === "function" ? config.mcp(directory) : (config.mcp ?? [])).map((server) => {
      const status = record(server) ? state.mcp.get(`${directory}\n${String(server.name)}`) : undefined
      return status && record(server) ? { ...server, status } : server
    })
  const mcpAction = (server: string, action: "connect" | "disconnect", request: { url: string }) =>
    Effect.suspend(() => {
      const directory = requestDirectory(config, request)
      if (!mcpServers(directory).some((item) => record(item) && item.name === server))
        return Effect.fail(new MockNotFound({ message: `MCP server ${server} not found` }))
      const status = config.onMcpAction?.({ server, action, directory }) ?? {
        status: action === "connect" ? "connected" : "disabled",
      }
      state.mcp.set(`${directory}\n${server}`, status)
      return noContent
    })
  const unsupported = (operation: string, handler: string) =>
    Effect.fail(
      new MockUnsupported({ message: `The mock server does not ${operation}; configure ${handler} for this scenario` }),
    )
  return HttpApiBuilder.group(MockApi, "mock", (handlers) =>
    handlers
      .handleRaw("event", () => {
        const events = config.events?.()
        const retry = config.eventRetry === undefined ? "" : `retry: ${config.eventRetry}\n\n`
        const body = [{ id: "evt_mock_connected", type: "server.connected", data: {} }, ...(events ?? [])]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join("")
        return Effect.succeed(HttpServerResponse.text(retry + body, { contentType: "text/event-stream" }))
      })
      .handleRaw("fsRead", (ctx) =>
        Effect.gen(function* () {
          const path = decodeURIComponent(new URL(ctx.request.url, "http://localhost").pathname.slice(13))
          const value = yield* Effect.promise(() => Promise.resolve(config.fileContent?.(path)))
          const content =
            value && typeof value === "object" && "content" in value ? String(value.content) : String(value ?? "")
          return HttpServerResponse.uint8Array(new TextEncoder().encode(content))
        }),
      )
      // Raw, so a hook's answer can replace the status and body.
      .handleRaw("worktreeCreate", (ctx) =>
        Effect.gen(function* () {
          const create = config.onWorktreeCreate
          if (!create) return yield* unsupported("create worktrees", "onWorktreeCreate")
          const input = yield* Effect.orDie(ctx.request.json)
          const payload = record(input) ? input : {}
          const answer = (yield* Effect.promise(async () => create(input))) || {
            status: 200,
            body: {
              directory: `${typeof payload.directory === "string" ? payload.directory : config.directory}/${
                typeof payload.name === "string" ? payload.name : "copy"
              }`,
            },
          }
          if (answer.status === 200 && record(answer.body) && typeof answer.body.directory === "string")
            addSandbox(config, answer.body.directory)
          return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status })
        }),
      )
      .handleRaw("sessionCreate", (ctx) =>
        Effect.gen(function* () {
          const input = yield* Effect.orDie(ctx.request.json)
          const payload = record(input) ? input : {}
          state.sessionCreates += 1
          const answer = config.onSessionCreate?.(payload, state.sessionCreates)
          if (answer) return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status })
          const created = currentSession(
            {
              ...payload,
              id: typeof payload.id === "string" ? payload.id : "ses_mock_created",
              projectID: (config.project as { id?: string }).id,
              title: config.createdSessionTitle ?? (typeof payload.title === "string" ? payload.title : "New session"),
              parentID: typeof payload.parentID === "string" ? payload.parentID : undefined,
            },
            config.directory,
          )
          config.sessions.push(created)
          return HttpServerResponse.jsonUnsafe({ data: created })
        }),
      )
      .handleAll({
        info: () =>
          Effect.succeed({
            version: "2.0.0",
            pid: 1,
            urls: config.server ? [config.server] : [],
            paths: { tmp: "/tmp/opencode" },
          }),
        config: () => Effect.succeed(configEntries),
        reference: () =>
          Effect.succeed({
            location: {
              directory: config.directory,
              project: {
                id: (config.project as { id?: string }).id,
                directory: config.directory,
                canonical: config.directory,
              },
            },
            data: [],
          }),
        agent: (ctx) =>
          Effect.succeed({
            location: location(config, requestDirectory(config, ctx.request)),
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
          }),
        provider: () => Effect.succeed({ location: location(config), data: currentProviders(providerConfig(config)) }),
        model: () => Effect.succeed({ location: location(config), data: currentModels(providerConfig(config)) }),
        modelDefault: () =>
          Effect.succeed({ location: location(config), data: currentDefaultModel(providerConfig(config)) }),
        integrationList: () => Effect.succeed({ location: location(config), data: config.integrations ?? [] }),
        integrationGet: (ctx) =>
          Effect.succeed({
            location: location(config),
            data: config.integrations
              ?.filter(record)
              .find((integration) => integration.id === ctx.params.integrationID) ?? {
              id: ctx.params.integrationID,
              name: ctx.params.integrationID,
              methods: [{ type: "key", label: "API key" }],
              connections: [],
            },
          }),
        integrationConnect: (ctx) =>
          Effect.sync(() => config.onConnectKey?.({ integrationID: ctx.params.integrationID, body: ctx.payload })).pipe(
            Effect.andThen(noContent),
          ),
        integrationOAuthConnect: (ctx) => {
          const start = config.onIntegrationOAuth
          if (!start) return unsupported("start OAuth connections", "onIntegrationOAuth")
          return Effect.sync(() => {
            const directory = requestDirectory(config, ctx.request)
            const created = Date.now()
            const attemptID = `con_mock_${state.attempts.size + 1}`
            state.attempts.set(attemptID, created)
            const started = start({ integrationID: ctx.params.integrationID, directory, body: ctx.payload })
            return {
              location: location(config, directory),
              data: {
                attemptID,
                url: started.url,
                instructions: "",
                mode: "auto",
                time: { created, expires: created + 600_000 },
              },
            }
          })
        },
        integrationOAuthStatus: (ctx) =>
          Effect.suspend(() => {
            const created = state.attempts.get(ctx.params.attemptID)
            if (created === undefined) return Effect.fail(new MockNotFound({ message: "OAuth attempt not found" }))
            return Effect.succeed({
              location: location(config, requestDirectory(config, ctx.request)),
              data: { status: "pending", time: { created, expires: created + 600_000 } },
            })
          }),
        credentialRemove: () => noContent,
        command: (ctx) =>
          Effect.sync(() => ({
            location: location(config, requestDirectory(config, ctx.request)),
            data: resolve(config.commands ?? []),
          })),
        skill: () => Effect.sync(() => ({ location: location(config), data: resolve(config.skills ?? []) })),
        plugin: () => Effect.sync(() => ({ location: location(config), data: resolve(config.plugins ?? []) })),
        mcp: (ctx) =>
          Effect.sync(() => {
            const directory = requestDirectory(config, ctx.request)
            return { location: location(config, directory), data: mcpServers(directory) }
          }),
        mcpConnect: (ctx) => mcpAction(ctx.params.server, "connect", ctx.request),
        mcpDisconnect: (ctx) => mcpAction(ctx.params.server, "disconnect", ctx.request),
        mcpResource: (ctx) =>
          Effect.succeed({
            location: location(config, requestDirectory(config, ctx.request)),
            data: { resources: [], templates: [] },
          }),
        projectList: () =>
          Effect.sync(() => {
            if (config.projects) return resolve(config.projects)
            const project = config.project as typeof config.project & { canonical?: string; worktree?: string }
            return [{ ...project, canonical: project.canonical ?? project.worktree ?? config.directory }]
          }),
        projectUpdate: (ctx) => {
          const project = config.project as { canonical?: string }
          return Effect.succeed({
            ...project,
            ...ctx.payload,
            id: ctx.params.projectID,
            canonical: project.canonical ?? config.directory,
          })
        },
        configShells: () => Effect.succeed(config.shells ?? []),
        configUpdate: () => noContent,
        websearchProviders: () => Effect.succeed({ location: location(config), data: [] }),
        worktreeList: () =>
          Effect.sync(() => {
            if (config.worktrees) return resolve(config.worktrees)
            return [
              { directory: config.directory },
              ...((config.project as { sandboxes?: string[] }).sandboxes ?? []).map((directory) => ({
                directory,
                strategy: "git",
              })),
            ]
          }),
        worktreeRemove: (ctx) => {
          const remove = config.onWorktreeRemove
          if (!remove) return unsupported("remove worktrees", "onWorktreeRemove")
          return Effect.promise(async () => remove(ctx.payload)).pipe(Effect.andThen(noContent))
        },
        // Discovery against a static inventory changes nothing, and the app refreshes whenever worktree settings open.
        worktreeRefresh: () => noContent,
        location: (ctx) => Effect.sync(() => location(config, requestDirectory(config, ctx.request))),
        permissionRequests: () =>
          Effect.suspend(() =>
            config.permissionListFailures?.()
              ? Effect.fail(new MockInternal({ message: "Permission list failed" }))
              : Effect.succeed({
                  location: location(config),
                  data: (typeof config.permissions === "function"
                    ? config.permissions()
                    : (config.permissions ?? [])
                  ).map(currentPermission),
                }),
          ),
        formRequests: () =>
          Effect.succeed({
            location: location(config),
            data: typeof config.forms === "function" ? config.forms() : (config.forms ?? []),
          }),
        vcs: () =>
          Effect.succeed({
            location: location(config),
            data: { branch: config.vcs ?? { current: "main", default: "main" } },
          }),
        vcsInit: (ctx) => {
          if (!config.onVcsInit) return unsupported("initialize VCS", "onVcsInit")
          return Effect.sync(() => {
            const url = new URL(ctx.request.url, "http://localhost")
            const provider = url.searchParams.get("provider") ?? undefined
            config.onVcsInit?.({ directory: requestDirectory(config, ctx.request), provider })
            const project = config.project as { id: string; vcs?: string }
            project.vcs = provider ?? "git"
            state.emit([
              {
                id: "evt_vcs_initialized",
                type: "worktree.updated",
                created: Date.now(),
                data: { projectID: project.id },
              },
            ])
          }).pipe(Effect.andThen(noContent))
        },
        vcsStatus: () => Effect.succeed({ location: location(config), data: [] }),
        vcsBranches: () => Effect.succeed({ location: location(config), data: ["main"] }),
        vcsDiff: (ctx) =>
          Effect.sync(() => ({
            location: location(config),
            data:
              typeof config.vcsDiff === "function" ? config.vcsDiff({ mode: ctx.query.mode }) : (config.vcsDiff ?? []),
          })),
        fsList: (ctx) =>
          Effect.promise(() => Promise.resolve(config.fileList?.(ctx.query.path ?? ""))).pipe(
            Effect.map((data) => ({ location: location(config), data })),
          ),
        fsFind: (ctx) =>
          Effect.promise(() =>
            Promise.resolve(
              config.findFiles?.({ query: ctx.query.query ?? "", dirs: ctx.query.type, limit: ctx.query.limit }),
            ),
          ).pipe(
            Effect.map((entries) => ({
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
            })),
          ),
        fsWrite: (ctx) => {
          const write = config.onFileWrite
          if (!write) return unsupported("write files", "onFileWrite")
          return Effect.sync(() => {
            const directory = requestDirectory(config, ctx.request)
            const path = new URL(ctx.request.url, "http://localhost").searchParams.get("path") ?? ""
            write({ path, directory, body: new TextDecoder().decode(ctx.payload) })
            return { location: location(config, directory), data: { path } }
          })
        },
        shell: (ctx) =>
          Effect.sync(() => ({
            location: location(config, requestDirectory(config, ctx.request)),
            data: resolve(config.shellCommands ?? []),
          })),
        shellOutput: (ctx) =>
          Effect.suspend(() => {
            const directory = requestDirectory(config, ctx.request)
            const output = config.shellOutput?.({ id: ctx.params.id, directory })
            if (output === undefined)
              return Effect.fail(
                new MockShellNotFound({ id: ctx.params.id, message: `Shell command not found: ${ctx.params.id}` }),
              )
            const bytes = new TextEncoder().encode(output)
            const query = new URL(ctx.request.url, "http://localhost").searchParams
            const cursor = Math.min(Number(query.get("cursor") ?? 0), bytes.length)
            // The server answers at most one page (`Shell.output` defaults `limit` to 65,536 bytes).
            const end = Math.min(bytes.length, cursor + Number(query.get("limit") ?? 65_536))
            return Effect.succeed({
              location: location(config, directory),
              data: {
                output: new TextDecoder().decode(bytes.subarray(cursor, end)),
                cursor: end,
                size: bytes.length,
                truncated: false,
              },
            })
          }),
        ptyList: (ctx) =>
          ptyEnabled.pipe(
            Effect.map(() => {
              const directory = requestDirectory(config, ctx.request)
              return { location: location(config, directory), data: state.pty.owned(directory) }
            }),
          ),
        ptyCreate: (ctx) =>
          ptyEnabled.pipe(
            Effect.map(() => {
              const next = state.pty.allocate()
              const directory = requestDirectory(config, ctx.request)
              const created = state.pty.info(
                next.id,
                ctx.payload.title ?? `Terminal ${next.number}`,
                ctx.payload.cwd ?? directory,
              )
              state.pty.add(created, directory)
              return { location: location(config, directory), data: created }
            }),
          ),
        ptyGet: (ctx) =>
          findPty(ctx.params.ptyID, ctx.request).pipe(
            Effect.map((data) => ({ location: location(config, requestDirectory(config, ctx.request)), data })),
          ),
        ptyUpdate: (ctx) =>
          findPty(ctx.params.ptyID, ctx.request).pipe(
            Effect.map((found) => {
              state.pty.updates.push({ id: found.id, body: ctx.payload })
              if (ctx.payload.title) found.title = ctx.payload.title
              return { location: location(config, requestDirectory(config, ctx.request)), data: found }
            }),
          ),
        ptyRemove: (ctx) =>
          findPty(ctx.params.ptyID, ctx.request).pipe(
            Effect.map((found) => {
              state.pty.removed.push(found.id)
              state.pty.list.splice(state.pty.list.indexOf(found), 1)
              return HttpApiSchema.NoContent.make()
            }),
          ),
        ptyConnectToken: (ctx) =>
          findPty(ctx.params.ptyID, ctx.request).pipe(
            Effect.map((found) => {
              const directory = requestDirectory(config, ctx.request)
              const ticket = state.pty.issue(found.id, directory)
              state.pty.tokens.push({
                id: found.id,
                headers: Object.fromEntries(Object.entries(ctx.request.headers)),
                ticket,
              })
              return { location: location(config, directory), data: { ticket, expires_in: 60 } }
            }),
          ),
        sessionList: (ctx) => {
          const sessions = config.sessions
            .filter((session) => {
              const location = session.location as { directory?: string } | undefined
              return (
                !ctx.query.directory ||
                location?.directory === ctx.query.directory ||
                session.directory === ctx.query.directory
              )
            })
            .filter((session) => {
              if (ctx.query.parentID === undefined) return true
              if (ctx.query.parentID === "null") return session.parentID === undefined
              return session.parentID === ctx.query.parentID
            })
            .filter((session) =>
              ctx.query.search === undefined
                ? true
                : String(session.title ?? "")
                    .toLowerCase()
                    .includes(ctx.query.search.toLowerCase()),
            )
          const ordered = ctx.query.order === "asc" ? sessions : sessions.toReversed()
          const offset = Number(ctx.query.cursor ?? 0)
          const limit = ctx.query.limit ?? 50
          const data = ordered.slice(offset, offset + limit)
          return Effect.succeed({
            data: data.map((session) => currentSession(session, config.directory)),
            cursor: { next: offset + limit < ordered.length ? String(offset + limit) : undefined },
          })
        },
        sessionActive: () => {
          const statuses = (
            typeof config.sessionStatus === "function" ? config.sessionStatus() : (config.sessionStatus ?? {})
          ) as Record<string, { type?: string }>
          return Effect.succeed({
            data: Object.fromEntries(
              Object.entries(statuses).flatMap(([id, status]) =>
                status.type === "idle" ? [] : [[id, { type: "running" }]],
              ),
            ),
          })
        },
        sessionGet: (ctx) =>
          Effect.suspend(() => {
            config.onSession?.(ctx.params.sessionID)
            const session = config.sessions.find((item) => item.id === ctx.params.sessionID)
            return session
              ? Effect.succeed({ data: currentSession(session, config.directory) })
              : Effect.fail(new MockNotFound({ message: "Session not found" }))
          }),
        sessionRemove: () => noContent,
        sessionShell: () => noContent,
        sessionForm: (ctx) => {
          const forms = typeof config.forms === "function" ? config.forms() : (config.forms ?? [])
          return Effect.succeed({
            data: forms.filter((form) => (form as { sessionID?: string }).sessionID === ctx.params.sessionID),
          })
        },
        sessionFormReply: () => noContent,
        sessionFormCancel: () => noContent,
        sessionBackground: () => noContent,
        sessionInbox: () =>
          Effect.sync(() => ({ data: typeof config.inbox === "function" ? config.inbox() : (config.inbox ?? []) })),
        sessionPrompt: (ctx) =>
          Effect.sync(() => {
            const body = record(ctx.payload) ? ctx.payload : {}
            config.onPrompt?.({ sessionID: ctx.params.sessionID, body })
            return {
              data: {
                id: typeof body.id === "string" ? body.id : `inb_mock_${Date.now()}`,
                sessionID: ctx.params.sessionID,
                time: { created: Date.now() },
                type: "user",
                payload: {
                  text: typeof body.text === "string" ? body.text : "",
                  ...(body.files === undefined ? {} : { files: body.files }),
                  ...(body.agents === undefined ? {} : { agents: body.agents }),
                  ...(body.skills === undefined ? {} : { skills: body.skills }),
                  ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
                },
                delivery: body.delivery === "queue" ? "queue" : "steer",
              },
            }
          }),
        sessionGenerate: (ctx) =>
          Effect.promise(async () => ({
            data: (await config.generate?.({ sessionID: ctx.params.sessionID, prompt: ctx.payload.prompt })) ?? {
              text: "Side-question answer",
            },
          })),
        sessionInboxCancel: (ctx) =>
          Effect.sync(() =>
            config.onInboxChange?.({ sessionID: ctx.params.sessionID, inboxID: ctx.params.inboxID, action: "cancel" }),
          ).pipe(Effect.andThen(noContent)),
        sessionInboxUpdate: (ctx) =>
          Effect.sync(() =>
            config.onInboxChange?.({
              sessionID: ctx.params.sessionID,
              inboxID: ctx.params.inboxID,
              action: ctx.payload.delivery,
            }),
          ).pipe(Effect.andThen(noContent)),
        sessionSwitchAgent: () => noContent,
        sessionSwitchModel: () => noContent,
        // Only the session's own list; location requests (`permissions`) come from `/api/permission/request`.
        sessionPermission: (ctx) =>
          Effect.sync(() => ({
            data: (config.sessionPermissions?.[ctx.params.sessionID] ?? [])
              .map(currentPermission)
              .filter((permission) => permission.sessionID === ctx.params.sessionID),
          })),
        // Like the server, a reply publishes `permission.replied`, and later reads no longer list the request.
        sessionPermissionReply: (ctx) => {
          const reply = config.onPermissionReply
          if (!reply) return unsupported("record permission replies", "onPermissionReply")
          return Effect.sync(() => {
            const sessionID = ctx.params.sessionID
            const permissionID = ctx.params.permissionID
            reply({ sessionID, permissionID, body: ctx.payload })
            const pending = [
              config.sessionPermissions?.[sessionID] ?? [],
              typeof config.permissions === "function" ? config.permissions() : (config.permissions ?? []),
            ]
            pending.forEach((list) => {
              const index = list.findIndex((item) => record(item) && item.id === permissionID)
              if (index >= 0) list.splice(index, 1)
            })
            state.emit([
              {
                id: `evt_permission_replied_${permissionID}`,
                created: Date.now(),
                type: "permission.replied",
                location: { directory: requestDirectory(config, ctx.request) },
                data: {
                  sessionID,
                  requestID: permissionID,
                  reply:
                    record(ctx.payload) && typeof ctx.payload.decision === "string" ? ctx.payload.decision : "once",
                },
              } as OpenCodeEvent,
            ])
          }).pipe(Effect.andThen(noContent))
        },
        sessionRename: (ctx) =>
          Effect.sync(() => {
            const title = record(ctx.payload) ? ctx.payload.title : undefined
            const session = config.sessions.find((item) => item.id === ctx.params.sessionID)
            if (session && typeof title === "string") session.title = title
          }).pipe(Effect.andThen(noContent)),
        sessionCommand: (ctx) => {
          const recordCommand = config.onCommand
          if (!recordCommand) return unsupported("run session commands", "onCommand")
          return Effect.sync(() => recordCommand({ sessionID: ctx.params.sessionID, body: ctx.payload })).pipe(
            Effect.andThen(noContent),
          )
        },
        sessionInterrupt: () => noContent,
        sessionRevertStage: (ctx) => {
          const payload = record(ctx.payload) ? ctx.payload : {}
          const messageID = payload.messageID
          if (typeof messageID !== "string") {
            return Effect.fail(new MockBadRequest({ message: "Invalid revert request" }))
          }
          return Effect.sync(() => config.onRevertStage?.({ sessionID: ctx.params.sessionID, messageID })).pipe(
            Effect.as({ data: { messageID } }),
          )
        },
        sessionRevertClear: () => noContent,
        sessionRevertCommit: () => noContent,
        messageGet: (ctx) =>
          Effect.gen(function* () {
            config.onMessage?.({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID })
            yield* delay
            const message =
              config.message?.(ctx.params.sessionID, ctx.params.messageID) ??
              config
                .pageMessages(ctx.params.sessionID, Number.MAX_SAFE_INTEGER)
                .items.find((item) => item.id === ctx.params.messageID)
            if (!message) return yield* new MockNotFound({ message: "Message not found" })
            return { data: message }
          }),
        messageList: (ctx) => {
          const token = ctx.query.cursor
          const before = token ? state.cursors.get(token) : undefined
          if (token && !before) return Effect.fail(new MockBadRequest({ message: "Invalid cursor" }))
          return Effect.gen(function* () {
            config.onMessages?.({ sessionID: ctx.params.sessionID, before, phase: "start" })
            if (config.beforeMessagesResponse) {
              yield* Effect.promise(() => config.beforeMessagesResponse!({ sessionID: ctx.params.sessionID, before }))
            }
            yield* delay
            const pageData = config.pageMessages(ctx.params.sessionID, ctx.query.limit ?? 50, before)
            config.onMessages?.({ sessionID: ctx.params.sessionID, before, phase: "end" })
            const cursor = pageData.cursor ? `cursor_${++state.nextCursor}` : undefined
            if (cursor) state.cursors.set(cursor, pageData.cursor!)
            return {
              data: ctx.query.order === "asc" ? pageData.items : pageData.items.toReversed(),
              cursor: { next: cursor },
            }
          })
        },
      }),
  )
}

// The requested workspace (directory) inside the configured project.
function location(config: MockServerConfig, directory = config.directory) {
  return {
    directory,
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
            modelID: record(model.api) && typeof model.api.id === "string" ? model.api.id : model.id,
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
    ...(typeof session.outcome === "string" ? { outcome: session.outcome } : {}),
    time: {
      created: "created" in time && typeof time.created === "number" ? time.created : 0,
      updated: "updated" in time && typeof time.updated === "number" ? time.updated : 0,
      ...("idle" in time && typeof time.idle === "number" ? { idle: time.idle } : {}),
      ...("viewed" in time && typeof time.viewed === "number" ? { viewed: time.viewed } : {}),
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
