import type { Page } from "@playwright/test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import { Permission } from "@opencode/schema/permission"
import { Worktree } from "@opencode/schema/worktree"
import { Duration, Effect, Layer, Option, Predicate, Schema } from "effect"
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { SERVER } from "./app"
import {
  MockApi,
  MockBadRequest,
  MockInternal,
  MockNotFound,
  MockPtyNotFound,
  MockShellNotFound,
  MockUnauthorized,
  MockUnsupported,
} from "./mock-api"
import { installSseTransport } from "./sse-transport"

type Resolvable<T> = T | (() => T)

// A hook's replacement response.
export type MockAnswer = { status: number; body: unknown }

// The legacy `/provider` catalog: `all` lists providers with `id`, `name` and `models` keyed by model ID.
export type MockProviderCatalog = {
  all?: readonly unknown[]
  connected?: readonly string[]
  default?: { providerID?: string; modelID?: string }
}

// A session in any shape a scenario seeds, current or legacy (`directory`, `path`); `currentSession` reads it.
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- scenarios seed arbitrary session fields
export type MockSession = { id: string } & Record<string, unknown>

export type MockMcpStatus = { status: string; error?: string }

export type MockFileContent =
  | string
  | { type?: string; content: string; encoding?: string; mimeType?: string }
  | undefined

export interface MockServerConfig {
  server?: string
  provider: Resolvable<MockProviderCatalog>
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
  sessions: MockSession[]
  pageMessages: (
    sessionId: string,
    limit: number,
    before?: string,
  ) => {
    items: SessionMessageInfo[]
    cursor?: string
  }
  // The session's whole transcript for type-filtered message lists; without it they list nothing.
  messageIndex?: (sessionID: string) => SessionMessageInfo[]
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
  onMcpAction?: (input: { server: string; action: "connect" | "disconnect"; directory: string }) => void | MockMcpStatus
  // Starts an OAuth attempt (POST .../connect/oauth) and returns its authorization URL; the attempt then stays pending.
  // Without it, OAuth connects answer 501 MockUnsupported.
  onIntegrationOAuth?: (input: { integrationID: string; directory: string; body: unknown }) => { url: string }
  plugins?: Resolvable<unknown[]>
  skills?: Resolvable<unknown[]>
  // Replaces the `/api/worktree` inventory, which defaults to the directory plus project sandboxes.
  worktrees?: Resolvable<unknown[]>
  // Without them, creating or removing a worktree answers 501 MockUnsupported. `onWorktreeCreate` may hold the request
  // and return the answer; by default it creates `<directory>/<name>`. A created directory joins the project's sandboxes.
  onWorktreeCreate?: (input: Schema.Json) => void | MockAnswer | Promise<void | MockAnswer>
  onWorktreeRemove?: (input: Worktree.RemoveInput) => void | Promise<void>
  // POST /api/session keeps the client-reserved `id` and `location`. Return an answer to fail the attempt (1-based).
  onSessionCreate?: (body: Schema.JsonObject, attempt: number) => void | MockAnswer
  // Title of created sessions (default: the request's title, else "New session").
  createdSessionTitle?: string
  // Slash commands served by `/api/command`.
  commands?: Resolvable<unknown[]>
  // Records POST /api/session/:id/command (204). Without it, commands answer 501 MockUnsupported.
  onCommand?: (input: { sessionID: string; body: unknown }) => void
  fileList?: (path: string) => unknown[] | Promise<unknown[]>
  fileContent?: (path: string) => MockFileContent | Promise<MockFileContent>
  // Paths become directory entries.
  findFiles?: (input: { query: string; dirs?: string; limit?: number }) => unknown[]
  sessionStatus?: Resolvable<Record<string, { type: string }>>
  inbox?: unknown[] | (() => unknown[])
  onPrompt?: (input: { sessionID: string; body: Schema.JsonObject }) => void
  onCompact?: (input: { sessionID: string; body: Schema.JsonObject }) => void
  generate?: (input: { sessionID: string; prompt: string }) => { text: string } | Promise<{ text: string }>
  onInboxChange?: (input: { sessionID: string; inboxID: string; action: "cancel" | "steer" | "queue" }) => void
  // Serves `/api/pty*` and mock PTY WebSockets. Created IDs are the first unused `${prefix}<n>` (prefix must start with "pty").
  // `directory` is the owning workspace (Location); `cwd` is the reported working directory (default: `directory`).
  pty?: { prefix?: string; initial?: { id: string; title: string; directory?: string; cwd?: string }[] }
  // Answers 500 InvalidDirectory when a request names a directory this server does not own.
  strictDirectory?: boolean
  // Answers 401 UnauthorizedError unless a request carries this password; a function may change it mid-test.
  password?: Resolvable<string>
  // Serves GET /auth/connect/:code: `code` redeems once for `token` (send it as the password); others answer 401.
  pairing?: { code: string; token: string }
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

export type MockPtySocket = {
  id: string
  url: URL
  input: string[]
  closed: boolean
  send(data: string): void
  close(code: number, reason: string): Promise<void>
}

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

// The page relays events as opaque values; benchmarks also push their own payloads.
type MockStream = { push: (payloads: readonly unknown[]) => void }

type MockStreamState = {
  controller?: ReadableStreamDefaultController<Uint8Array>
  buffer: string[]
  connections: number
}

// The `installSseTransport` command that delivers events.
type MockSendCommand = { type: "send"; deliveries: { payload: unknown }[]; burst: boolean }

type MockStreamWindow = Window & {
  // Set to any value by benchmarks that bring their own event stream.
  __testSseTransport?: unknown
  // `installSseTransport` registrations.
  __testSseTransports?: Record<string, { command: (input: MockSendCommand) => void }>
  // Per-origin mock event streams; in-page benchmark probes push through them directly.
  __mockServerStreams?: Record<string, MockStream>
}

export async function mockOpenCodeServer(page: Page, config: MockServerConfig) {
  const server = config.server ?? SERVER

  mockedOrigins(page).add(server)

  await page.addInitScript(
    ({ server, retry, keepalive: idle }) => {
      // SAFETY: only this script, `installSseTransport`, and benchmarks write these globals, in the declared shapes.
      const host = window as MockStreamWindow

      if (host.__testSseTransport || host.__testSseTransports?.[server] || host.__mockServerStreams?.[server]) return
      const originalFetch = window.fetch.bind(window)
      const encoder = new TextEncoder()
      const state: MockStreamState = { buffer: [], connections: 0 }
      const frame = (data: string) => `data: ${data}\n\n`

      const stream: MockStream = {
        push(payloads) {
          const frames = payloads.map((payload) => frame(JSON.stringify(payload)))
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
              encoder.encode(
                frame(JSON.stringify({ id: `evt_mock_connected_${id}`, type: "server.connected", data: {} })),
              ),
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
    page.evaluate<void, { server: string; payloads: readonly unknown[] }>(
      ({ server, payloads }) => {
        // SAFETY: only the init script, `installSseTransport`, and benchmarks write these globals, in the declared shapes.
        const host = window as MockStreamWindow
        const stream = host.__mockServerStreams?.[server]

        if (stream) return stream.push(payloads)
        const transport = host.__testSseTransports?.[server]

        if (!transport) throw new Error(`No mock event stream for ${server}`)
        transport.command({ type: "send", deliveries: payloads.map((payload) => ({ payload })), burst: true })
      },
      { server, payloads },
    )

  // Server-side events the mock publishes itself; delivery failures other than a missing document fail the test.
  const emit = (events: OpenCodeEvent[]) =>
    void push(events).catch((cause: unknown) => {
      if (page.isClosed() || retryableDelivery(cause)) return
      throw cause
    })

  if (config.events) {
    // Batches stay queued until the page accepts them; failures other than a missing document fail the test.
    const pending: OpenCodeEvent[] = []
    const pump = { busy: false, pending }

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
          (cause: unknown) => {
            if (page.isClosed()) return clearInterval(timer)

            if (retryableDelivery(cause)) return
            clearInterval(timer)
            throw cause
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
        json: Schema.encodeSync(MockUnauthorized)(new MockUnauthorized({ message: "Authentication required" })),
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

  if (config.pairing) {
    const pairing = { ...config.pairing, redeemed: false }

    await page.route(`${server}/auth/connect/*`, (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders })
      const code = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "")

      if (code !== pairing.code || pairing.redeemed) {
        return route.fulfill({
          status: 401,
          headers: corsHeaders,
          json: Schema.encodeSync(MockUnauthorized)(
            new MockUnauthorized({ message: "Pairing link expired or already used" }),
          ),
        })
      }

      pairing.redeemed = true

      return route.fulfill({ headers: corsHeaders, json: { token: pairing.token } })
    })
  }

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
          close: (code, reason) => ws.close({ code, reason }),
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
          mcp: new Map<string, MockMcpStatus>(),
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
function retryableDelivery(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)

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
  const projects = [config.project, ...(config.projects ? resolve(config.projects) : [])].flatMap((item) =>
    Option.toArray(decodeProject(item)),
  )

  return new Set(
    [
      config.directory,
      ...projects.flatMap((item) => [item.worktree, item.canonical, ...(item.sandboxes ?? [])]),
      ...(config.worktrees ? resolve(config.worktrees) : []).filter(Predicate.isObject).map((item) => item.directory),
      ...config.sessions.map((session) =>
        Predicate.isObject(session.location) ? session.location.directory : session.directory,
      ),
    ].filter(Predicate.isString),
  )
}

function addSandbox(config: MockServerConfig, directory: string) {
  // SAFETY: a scenario that creates worktrees seeds its project as an object whose `sandboxes` lists directories.
  const project = config.project as { sandboxes?: string[] }

  if (project.sandboxes?.includes(directory)) return
  project.sandboxes = [...(project.sandboxes ?? []), directory]
}

// The requested `location[directory]`; absent or empty (a server-level read) means the server directory.
function requestDirectory(config: MockServerConfig, request: { url: string }) {
  return new URL(request.url, "http://localhost").searchParams.get("location[directory]") || config.directory
}

function resolve<T>(value: Resolvable<T>) {
  // SAFETY: no resolvable scenario value is itself a function, so a function is the value's resolver.
  return Predicate.isFunction(value) ? (value as () => T)() : value
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
    mcp: Map<string, MockMcpStatus>
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

          return found
            ? Effect.succeed(found)
            : Effect.fail(new MockPtyNotFound({ ptyID: id, message: `PTY not found: ${id}` }))
        }),
      ),
    )

  const mcpServers = (directory: string) =>
    (Predicate.isFunction(config.mcp) ? config.mcp(directory) : (config.mcp ?? [])).map((server) => {
      if (!Predicate.isObject(server)) return server
      const status = state.mcp.get(`${directory}\n${String(server.name)}`)

      return status ? { ...server, status } : server
    })

  const mcpAction = (server: string, action: "connect" | "disconnect", request: { url: string }) =>
    Effect.suspend(() => {
      const directory = requestDirectory(config, request)

      if (!mcpServers(directory).some((item) => Predicate.isObject(item) && item.name === server))
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
          const content = Predicate.isString(value) ? value : (value?.content ?? "")

          return HttpServerResponse.uint8Array(new TextEncoder().encode(content))
        }),
      )
      // Raw, so a hook's answer can replace the status and body.
      .handleRaw("worktreeCreate", (ctx) =>
        Effect.gen(function* () {
          const create = config.onWorktreeCreate

          if (!create) return yield* unsupported("create worktrees", "onWorktreeCreate")

          const input = yield* Effect.orDie(
            ctx.request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json))),
          )

          const payload = Option.getOrUndefined(decodeWorktreeRequest(input))

          const answer = (yield* Effect.promise(async () => create(input))) || {
            status: 200,
            body: { directory: `${payload?.directory ?? config.directory}/${payload?.name ?? "copy"}` },
          }

          const created = answer.status === 200 ? decodeWorktreeAnswer(answer.body) : Option.none()

          if (Option.isSome(created)) addSandbox(config, created.value.directory)

          return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status })
        }),
      )
      .handleRaw("sessionCreate", (ctx) =>
        Effect.gen(function* () {
          const input = yield* Effect.orDie(ctx.request.json)
          const payload = Option.getOrElse(decodeJsonObject(input), () => ({}))
          const fields = Option.getOrUndefined(decodeSessionCreate(payload))
          state.sessionCreates += 1
          const answer = config.onSessionCreate?.(payload, state.sessionCreates)

          if (answer) return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status })

          const created = currentSession(
            {
              ...payload,
              id: fields?.id ?? "ses_mock_created",
              projectID: projectSeed(config)?.id,
              title: config.createdSessionTitle ?? fields?.title ?? "New session",
              parentID: fields?.parentID,
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
        reference: () => Effect.succeed({ location: location(config), data: [] }),
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
        provider: () =>
          Effect.succeed({ location: location(config), data: currentProviders(resolve(config.provider)) }),
        model: () => Effect.succeed({ location: location(config), data: currentModels(resolve(config.provider)) }),
        modelDefault: () =>
          Effect.succeed({ location: location(config), data: currentDefaultModel(resolve(config.provider)) }),
        integrationList: () => Effect.succeed({ location: location(config), data: config.integrations ?? [] }),
        integrationGet: (ctx) =>
          Effect.succeed({
            location: location(config),
            data: config.integrations
              ?.filter(Predicate.isObject)
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
            const seed = projectSeed(config)

            return [{ ...projectFields(config), canonical: seed?.canonical ?? seed?.worktree ?? config.directory }]
          }),
        projectUpdate: (ctx) =>
          Effect.succeed({
            ...projectFields(config),
            ...ctx.payload,
            id: ctx.params.projectID,
            canonical: projectSeed(config)?.canonical ?? config.directory,
          }),
        configShells: () => Effect.succeed(config.shells ?? []),
        configUpdate: () => noContent,
        websearchProviders: () => Effect.succeed({ location: location(config), data: [] }),
        worktreeList: () =>
          Effect.sync(() => {
            if (config.worktrees) return resolve(config.worktrees)

            return [
              { directory: config.directory },
              ...(projectSeed(config)?.sandboxes ?? []).map((directory) => ({
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
                  data: currentPermissions(resolve(config.permissions ?? [])),
                }),
          ),
        formRequests: () => Effect.succeed({ location: location(config), data: resolve(config.forms ?? []) }),
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
            // SAFETY: a scenario that initializes VCS seeds its project as an object with an ID.
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
            data: Predicate.isFunction(config.vcsDiff)
              ? config.vcsDiff({ mode: ctx.query.mode })
              : (config.vcsDiff ?? []),
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
                    Predicate.isString(entry)
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
        // Like the server, which also answers 204 for a shell that already ended.
        shellRemove: () => noContent,
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
            .filter(
              (session) =>
                !ctx.query.directory ||
                (Predicate.isObject(session.location) && session.location.directory === ctx.query.directory) ||
                session.directory === ctx.query.directory,
            )
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
        sessionActive: () =>
          Effect.succeed({
            data: Object.fromEntries(
              Object.entries(resolve(config.sessionStatus ?? {})).flatMap(([id, status]) =>
                status.type === "idle" ? [] : [[id, { type: "running" }]],
              ),
            ),
          }),
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
        sessionForm: (ctx) =>
          Effect.succeed({
            data: resolve(config.forms ?? []).filter(
              (form) => Predicate.isObject(form) && form.sessionID === ctx.params.sessionID,
            ),
          }),
        sessionFormReply: () => noContent,
        sessionFormCancel: () => noContent,
        sessionBackground: () => noContent,
        sessionInbox: (ctx) =>
          Effect.sync(() => ({
            data: resolve(config.inbox ?? []).filter(
              (item) => Predicate.isObject(item) && item.sessionID === ctx.params.sessionID,
            ),
          })),
        sessionPrompt: (ctx) =>
          Effect.sync(() => {
            const body = Option.getOrElse(decodeJsonObject(ctx.payload), () => ({}))
            config.onPrompt?.({ sessionID: ctx.params.sessionID, body })
            const prompt = Option.getOrUndefined(decodePromptRequest(body))

            return {
              data: {
                id: prompt?.id ?? `inb_mock_${Date.now()}`,
                sessionID: ctx.params.sessionID,
                time: { created: Date.now() },
                type: "user",
                // Keys the request omits stay omitted.
                payload: { text: "", ...Option.getOrUndefined(decodePromptPayload(body)) },
                delivery: prompt?.delivery ?? "steer",
              },
            }
          }),
        // Like the server, a compaction is admitted as a steered inbox item under the proposed ID.
        sessionCompact: (ctx) =>
          Effect.sync(() => {
            const body = Option.getOrElse(decodeJsonObject(ctx.payload), (): Schema.JsonObject => ({}))
            config.onCompact?.({ sessionID: ctx.params.sessionID, body })

            return {
              data: {
                id: Predicate.isString(body.id) ? body.id : `inb_mock_${Date.now()}`,
                sessionID: ctx.params.sessionID,
                time: { created: Date.now() },
                type: "compaction",
                payload: {},
                delivery: "steer",
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
            data: currentPermissions(config.sessionPermissions?.[ctx.params.sessionID] ?? []).filter(
              (permission) => permission.sessionID === ctx.params.sessionID,
            ),
          })),
        // Like the server, a reply publishes `permission.replied`, and later reads no longer list the request.
        sessionPermissionReply: (ctx) => {
          const reply = config.onPermissionReply

          if (!reply) return unsupported("record permission replies", "onPermissionReply")

          return Effect.sync(() => {
            const sessionID = ctx.params.sessionID
            const permissionID = ctx.params.permissionID
            reply({ sessionID, permissionID, body: ctx.payload })

            const pending = [config.sessionPermissions?.[sessionID] ?? [], resolve(config.permissions ?? [])]

            pending.forEach((list) => {
              const index = list.findIndex((item) => Predicate.isObject(item) && item.id === permissionID)

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
                  reply: Option.getOrUndefined(decodePermissionReply(ctx.payload))?.decision ?? "once",
                },
              },
            ])
          }).pipe(Effect.andThen(noContent))
        },
        sessionRename: (ctx) =>
          Effect.sync(() => {
            const title = Option.getOrUndefined(decodeSessionRename(ctx.payload))?.title
            const session = config.sessions.find((item) => item.id === ctx.params.sessionID)

            if (session && title !== undefined) session.title = title
          }).pipe(Effect.andThen(noContent)),
        sessionCommand: (ctx) => {
          const recordCommand = config.onCommand

          if (!recordCommand) return unsupported("run session commands", "onCommand")

          return Effect.sync(() => recordCommand({ sessionID: ctx.params.sessionID, body: ctx.payload })).pipe(
            Effect.andThen(noContent),
          )
        },
        // Like the server for an idle session: nothing was running to interrupt.
        sessionInterrupt: () => Effect.succeed({ interrupted: false }),
        // The mock runs no agent loop, so every session is already idle.
        sessionWait: () => noContent,
        sessionRevertStage: (ctx) => {
          const request = decodeRevertStage(ctx.payload)

          if (Option.isNone(request)) return Effect.fail(new MockBadRequest({ message: "Invalid revert request" }))
          const messageID = request.value.messageID

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
          const type = ctx.query.type

          // A type filter pages the session's matching messages in their own order, like the server's index;
          // `before` keeps only messages preceding that one.
          if (type) {
            const [order, offset] = token?.startsWith("typed:")
              ? [token.split(":")[1], Number(token.split(":")[2])]
              : [ctx.query.order ?? "desc", 0]
            const transcript = config.messageIndex?.(ctx.params.sessionID) ?? []
            const end = ctx.query.before
              ? Math.max(
                  0,
                  transcript.findIndex((item) => item.id === ctx.query.before),
                )
              : transcript.length
            const typed = transcript.slice(0, end).filter((item) => item.type === type)
            const ordered = order === "asc" ? typed : typed.toReversed()
            const limit = ctx.query.limit ?? 50

            return Effect.succeed({
              data: ordered.slice(offset, offset + limit),
              cursor: { next: offset + limit < ordered.length ? `typed:${order}:${offset + limit}` : undefined },
            })
          }

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
    project: { id: projectSeed(config)?.id, directory: config.directory, canonical: config.directory },
  }
}

// The project fields the mock reads.
function projectSeed(config: MockServerConfig) {
  return Option.getOrUndefined(decodeProject(config.project))
}

// Every field of the configured project, for answers that echo it.
function projectFields(config: MockServerConfig) {
  return Predicate.isObject(config.project) ? config.project : undefined
}

function currentProviders(catalog: MockProviderCatalog) {
  const connected = new Set(catalog.connected ?? [])

  return (catalog.all ?? [])
    .flatMap((item) => Option.toArray(decodeProvider(item)))
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      package: provider.id,
      activation: connected.has(provider.id) ? "enabled" : "auto",
    }))
}

function currentModels(catalog: MockProviderCatalog) {
  return (catalog.all ?? [])
    .flatMap((item) => Option.toArray(decodeModelProvider(item)))
    .flatMap((provider) =>
      Object.values(provider.models)
        .flatMap((item) => Option.toArray(decodeModel(item)))
        .map((model) => ({
          id: model.id,
          modelID: model.api?.id ?? model.id,
          providerID: provider.id,
          name: model.name,
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          variants: Object.entries(model.variants ?? {}).map(([id, settings]) =>
            Predicate.isObject(settings) ? { id, settings } : { id },
          ),
          time: { released: Date.now() },
          cost: [{ input: model.cost?.input ?? 0, output: model.cost?.output ?? 0, cache: { read: 0, write: 0 } }],
          status: "active",
          enabled: true,
          limit: { context: model.limit?.context ?? 200_000, output: model.limit?.output ?? 32_000 },
        })),
    )
}

function currentDefaultModel(catalog: MockProviderCatalog) {
  const selected = catalog.default

  if (!selected) return null

  return (
    currentModels(catalog).find((model) => model.providerID === selected.providerID && model.id === selected.modelID) ??
    null
  )
}

// Legacy requests (`permission`, `patterns`, `always`, `tool`) become current ones; current ones (`action`) pass as is.
function currentPermissions(values: readonly unknown[]) {
  return values.flatMap((permission) => {
    if (!Predicate.isObject(permission)) return []

    if (permission.action) return [permission]
    const tool = Predicate.isObject(permission.tool) ? permission.tool : undefined

    return [
      {
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
      },
    ]
  })
}

export function currentSession(session: MockSession, fallbackDirectory?: string) {
  const seed = decodeSession(session)

  return {
    id: session.id,
    parentID: session.parentID,
    projectID: session.projectID ?? "project",
    agent: session.agent ?? "build",
    model: session.model ?? { id: "mock-model", providerID: "mock-provider" },
    cost: session.cost ?? 0,
    tokens: session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...decodeSessionOutcome(session),
    time: { created: seed.time?.created ?? 0, updated: seed.time?.updated ?? 0, ...seed.time },
    title: session.title ?? session.id,
    location: { directory: seed.location?.directory ?? seed.directory ?? fallbackDirectory },
    subpath: session.subpath ?? session.path,
    revert: session.revert,
  }
}

// An optional field that decodes as absent when its value is invalid, so one bad field does not discard the rest.
function lenient<S extends Schema.Top>(schema: S) {
  return Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeedNone)))
}

const decodeJsonObject = Schema.decodeUnknownOption(Schema.JsonObject)

const decodeProject = Schema.decodeUnknownOption(
  Schema.Struct({
    id: lenient(Schema.String),
    worktree: lenient(Schema.String),
    canonical: lenient(Schema.String),
    sandboxes: lenient(Schema.Array(Schema.String)),
  }),
)

const decodeWorktreeRequest = Schema.decodeUnknownOption(
  Schema.Struct({ directory: lenient(Schema.String), name: lenient(Schema.String) }),
)

const decodeWorktreeAnswer = Schema.decodeUnknownOption(Schema.Struct({ directory: Schema.String }))

const decodeSessionCreate = Schema.decodeUnknownOption(
  Schema.Struct({ id: lenient(Schema.String), title: lenient(Schema.String), parentID: lenient(Schema.String) }),
)

const decodeSessionRename = Schema.decodeUnknownOption(Schema.Struct({ title: Schema.String }))

const decodeRevertStage = Schema.decodeUnknownOption(Schema.Struct({ messageID: Schema.String }))

const decodePermissionReply = Schema.decodeUnknownOption(Schema.Struct({ decision: Permission.Reply }))

const decodePromptRequest = Schema.decodeUnknownOption(
  Schema.Struct({ id: lenient(Schema.String), delivery: lenient(Schema.Literal("queue")) }),
)

const decodePromptPayload = Schema.decodeUnknownOption(
  Schema.Struct({
    text: lenient(Schema.String),
    files: Schema.optionalKey(Schema.Json),
    agents: Schema.optionalKey(Schema.Json),
    skills: Schema.optionalKey(Schema.Json),
    metadata: Schema.optionalKey(Schema.Json),
  }),
)

const decodeProvider = Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String, name: Schema.String }))

const decodeModelProvider = Schema.decodeUnknownOption(
  Schema.Struct({ id: Schema.String, models: Schema.Record(Schema.String, Schema.Unknown) }),
)

const decodeModel = Schema.decodeUnknownOption(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    api: lenient(Schema.Struct({ id: Schema.String })),
    limit: lenient(Schema.Struct({ context: lenient(Schema.Number), output: lenient(Schema.Number) })),
    cost: lenient(Schema.Struct({ input: lenient(Schema.Number), output: lenient(Schema.Number) })),
    variants: lenient(Schema.Record(Schema.String, Schema.Unknown)),
  }),
)

// Every field is lenient, so any session object decodes.
const decodeSession = Schema.decodeUnknownSync(
  Schema.Struct({
    time: lenient(
      Schema.Struct({
        created: lenient(Schema.Number),
        updated: lenient(Schema.Number),
        idle: lenient(Schema.Number),
        viewed: lenient(Schema.Number),
        archived: Schema.optionalKey(Schema.Unknown),
      }),
    ),
    location: lenient(Schema.Struct({ directory: lenient(Schema.String) })),
    directory: lenient(Schema.String),
  }),
)

const decodeSessionOutcome = Schema.decodeUnknownSync(Schema.Struct({ outcome: lenient(Schema.String) }))
