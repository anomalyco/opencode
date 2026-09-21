import { readdir, rm } from "node:fs/promises"
import path from "node:path"
import executionPlugin, { pluginVersion } from "@bearmanser/opencode-superpowers-execution/plugin"
import type {
  StoragePort,
  StorageScanOptions,
  StorageScanResult,
  StorageValue,
} from "@bearmanser/opencode-superpowers-execution/repository"
import { Tool } from "@opencode/schema/tool"
import { createMockServerHandler } from "../utils/mock-server"

type HostSession = {
  readonly id: string
  readonly parentID?: string
  readonly directory: string
  readonly title?: string
  readonly running?: boolean
}

type ExecutionErrorData = { readonly code: string; readonly detail: string } & Record<string, unknown>

type ToolResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ExecutionErrorData }

type RpcFailure = { readonly type: string; readonly message: string; readonly data?: ExecutionErrorData }

type HandlerContext = {
  readonly signal: AbortSignal
  readonly error: (type: string, message: string, data?: ExecutionErrorData) => RpcFailure
}

type CapturedTool = {
  readonly id: string
  readonly name: string
  readonly input: unknown
  readonly execute: (input: unknown, context: unknown) => Promise<{ readonly output: unknown }>
}

type RpcDefinition = { readonly id: string; readonly methods: Record<string, unknown>; readonly events: Record<string, unknown> }

type RpcHandlers = Record<string, (input: unknown, context: HandlerContext) => Promise<unknown>>

const configuration = (() => {
  const directory = process.env.EXECUTION_HOST_DIRECTORY
  const dataDirectory = process.env.EXECUTION_HOST_DATA
  const port = Number(process.env.EXECUTION_HOST_PORT)
  const password = process.env.EXECUTION_HOST_PASSWORD
  if (!directory || !dataDirectory || !Number.isInteger(port) || port <= 0) {
    throw new Error(
      "disposable host requires EXECUTION_HOST_DIRECTORY, EXECUTION_HOST_DATA, and EXECUTION_HOST_PORT",
    )
  }
  return { directory, dataDirectory, port, password }
})()

const directory = configuration.directory
const dataDirectory = configuration.dataDirectory
const port = configuration.port
const password = configuration.password

const baseSessions: HostSession[] = JSON.parse(process.env.EXECUTION_HOST_SESSIONS ?? "[]")
const sessions = new Map<string, HostSession>(baseSessions.map((session) => [session.id, session]))
const subscribers = new Set<(event: unknown) => void>()
let eventSequence = 0
let capabilityVersion = 1
let suppressEvents = false
let definition: RpcDefinition | undefined
let handlers: RpcHandlers | undefined
let tools: CapturedTool[] = []
let cleanup: (() => Promise<void> | void) | undefined
let loaded = false

function project() {
  return { id: "project", directory, canonical: directory }
}

function fileStorage(root: string): StoragePort {
  const encode = (key: string) =>
    key.replace(/[^A-Za-z0-9._-]/g, (character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`)
  const decode = (name: string) =>
    name.replace(/%([0-9a-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
  const fileFor = (key: string) => path.join(root, `${encode(key)}.json`)
  return {
    async get(key) {
      const file = Bun.file(fileFor(key))
      if (!(await file.exists())) return undefined
      return (await file.json()) as StorageValue
    },
    async set(key, value) {
      await Bun.write(fileFor(key), JSON.stringify(value))
    },
    async scan(options: StorageScanOptions): Promise<StorageScanResult> {
      const names = await readdir(root)
      const keys = names
        .filter((name) => name.endsWith(".json"))
        .map((name) => decode(name.slice(0, -5)))
        .filter((key) => key.startsWith(options.prefix))
        .sort()
      const remaining = options.after === undefined ? keys : keys.filter((key) => key > options.after!)
      const page = options.limit === undefined ? remaining : remaining.slice(0, options.limit)
      const entries = await Promise.all(
        page.map(async (key) => ({ key, value: (await Bun.file(fileFor(key)).json()) as StorageValue })),
      )
      return {
        entries,
        ...(page.length < remaining.length && page.length > 0 ? { next: page[page.length - 1] } : {}),
      }
    },
  }
}

function emitChanged(name: string, data: unknown) {
  if (name !== "changed" || suppressEvents) return
  const event = {
    id: `evt_host_${(eventSequence += 1)}`,
    created: Date.now(),
    type: "rpc.superpowers.execution.v1.changed",
    location: { directory, project: project() },
    data,
  }
  for (const subscriber of subscribers) subscriber(event)
}

function createContext() {
  const storage = fileStorage(dataDirectory)
  const domains: Record<string, unknown> = {
    app: { name: "opencode", version: "2.0.11", channel: "test" },
    location: { directory, project: project() },
    options: {},
    storage,
    session: {
      get: async (input: { readonly sessionID: string }) => {
        const session = sessions.get(input.sessionID)
        if (session === undefined) throw new Error(`unknown session ${input.sessionID}`)
        return {
          id: session.id,
          ...(session.parentID === undefined ? {} : { parentID: session.parentID }),
          location: { directory: session.directory },
        }
      },
      synthetic: async () => {},
      hook: async () => ({ dispose: async () => {} }),
    },
    rpc: {
      register: async (nextDefinition: RpcDefinition, nextHandlers: RpcHandlers) => {
        definition = nextDefinition
        handlers = nextHandlers
        let disposed = false
        return {
          events: { emit: async (name: string, data: unknown) => emitChanged(name, data) },
          dispose: async () => {
            if (disposed) return
            disposed = true
            definition = undefined
            handlers = undefined
          },
        }
      },
    },
    tool: {
      transform: async (callback: (editor: unknown) => void) => {
        const editor = {
          list: () => tools,
          get: (id: string) => tools.find((tool) => tool.id === id),
          namespace: () => undefined,
          add: (tool: CapturedTool) => {
            const entry = { ...tool, id: tool.name }
            tools.push(entry)
          },
          update: () => {},
          remove: () => {},
        }
        callback(editor)
        let disposed = false
        return {
          dispose: async () => {
            if (disposed) return
            disposed = true
            tools = []
          },
        }
      },
    },
    skill: {
      list: async () => [],
      reload: async () => {},
      transform: async (callback: (editor: unknown) => void) => {
        const skills = new Map<string, unknown>()
        callback({
          list: () => [...skills.values()],
          get: (id: string) => skills.get(id),
          add: (skill: { id: string }) => skills.set(skill.id, skill),
          update: () => {},
          remove: (id: string) => skills.delete(id),
        })
        return { dispose: async () => skills.clear() }
      },
    },
  }
  return new Proxy(domains, {
    get(target, property) {
      if (typeof property !== "string") return undefined
      if (!Object.hasOwn(target, property)) throw new Error(`unavailable host domain: ${property}`)
      return target[property]
    },
  }) as unknown as Parameters<typeof executionPlugin.setup>[0]
}

async function loadPlugin() {
  if (loaded) return
  tools = []
  const result = await executionPlugin.setup(createContext())
  cleanup = typeof result === "function" ? result : undefined
  loaded = true
}

async function unloadPlugin() {
  if (!loaded) return
  const previous = cleanup
  loaded = false
  cleanup = undefined
  tools = []
  await previous?.()
}

async function invokeTool<T>(name: string, input: unknown, sessionID: string): Promise<ToolResult<T>> {
  if (!loaded) return { ok: false, error: { code: "storage_unavailable", detail: "plugin is not loaded" } }
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) return { ok: false, error: { code: "not_found", detail: `tool not registered: ${name}` } }
  const decoded = await decodeInput(tool.input, input)
  if (!decoded.ok) return decoded
  try {
    const result = await tool.execute(decoded.value, {
      sessionID,
      agent: "agent",
      messageID: "message",
      id: "call",
      signal: new AbortController().signal,
      progress: async () => {},
    })
    return { ok: true, value: result.output as T }
  } catch (error) {
    if (error instanceof Tool.Error) return { ok: false, error: toolErrorData(error) }
    throw error
  }
}

async function callRpc(method: string, input: unknown) {
  const current = handlers
  if (!loaded || current === undefined) {
    return { status: 400, body: { _tag: "RpcError", type: "rpc.unavailable", message: `RPC is unavailable: superpowers.execution.v1` } }
  }
  const handler = current[method]
  if (handler === undefined) {
    return { status: 400, body: { _tag: "RpcError", type: "rpc.method_not_found", message: `Unknown RPC method: superpowers.execution.v1.${method}` } }
  }
  const failures: RpcFailure[] = []
  const context: HandlerContext = {
    signal: new AbortController().signal,
    error: (type, message, data) => {
      const failure = data === undefined ? { type, message } : { type, message, data }
      failures.push(failure)
      return failure
    },
  }
  const output = await handler(input, context)
  if (failures.length > 0) {
    const failure = failures[0]
    return {
      status: 400,
      body: {
        _tag: "RpcError",
        type: failure.type,
        message: failure.message,
        ...(failure.data === undefined ? {} : { data: failure.data }),
      },
    }
  }
  if (method === "capabilities" && capabilityVersion !== 1 && typeof output === "object" && output !== null) {
    return { status: 200, body: { output: { ...output, schemaVersion: capabilityVersion } } }
  }
  return { status: 200, body: { output } }
}

const mockSessions = baseSessions.map((session) => ({
  id: session.id,
  parentID: session.parentID,
  directory: session.directory,
  location: { directory: session.directory },
  title: session.title ?? session.id,
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 + session.id.length },
  projectID: "project",
}))

const native = createMockServerHandler({
  directory,
  project: {
    id: "project",
    worktree: directory,
    canonical: directory,
    name: "execution-e2e",
    vcs: "git",
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    sandboxes: baseSessions.filter((session) => session.directory !== directory).map((session) => session.directory),
  },
  provider: { all: [], connected: [], default: {} },
  sessions: mockSessions,
  pageMessages: () => ({ items: [] }),
  sessionStatus: () =>
    Object.fromEntries(
      baseSessions.filter((session) => session.running).map((session) => [session.id, { type: "running" }]),
    ),
})

function applySessions(next: readonly HostSession[]) {
  sessions.clear()
  for (const session of next) sessions.set(session.id, session)
  baseSessions.splice(0, baseSessions.length, ...next)
  mockSessions.splice(
    0,
    mockSessions.length,
    ...next.map((session) => ({
      id: session.id,
      parentID: session.parentID,
      directory: session.directory,
      location: { directory: session.directory },
      title: session.title ?? session.id,
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 + session.id.length },
      projectID: "project",
    })),
  )
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "x-next-cursor",
}

function authorized(request: Request) {
  if (password === undefined || password === "") return true
  return request.headers.get("authorization") === `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...cors },
  })
}

async function control(action: string, payload: Record<string, unknown>) {
  switch (action) {
    case "health":
      return json({ ok: true, pid: process.pid, port, pluginLoaded: loaded, location: directory })
    case "report":
      return json(await invokeTool("execution_report", payload.command, String(payload.sessionID ?? "")))
    case "read":
      return json(await invokeTool("execution_read", payload.input ?? {}, String(payload.sessionID ?? "")))
    case "sessions":
      applySessions((payload.sessions ?? []) as HostSession[])
      return json({ ok: true })
    case "reset": {
      const names = await readdir(dataDirectory)
      await Promise.all(names.map((name) => rm(path.join(dataDirectory, name), { recursive: true, force: true })))
      suppressEvents = false
      capabilityVersion = 1
      await loadPlugin()
      return json({ ok: true })
    }
    case "unload":
      await unloadPlugin()
      return json({ ok: true, pluginLoaded: loaded })
    case "reload":
      await loadPlugin()
      return json({ ok: true, pluginLoaded: loaded })
    case "events":
      suppressEvents = payload.suppress === true
      return json({ ok: true, suppressEvents })
    case "capabilities":
      capabilityVersion = Number(payload.schemaVersion ?? 1)
      return json({ ok: true, capabilityVersion })
    case "shutdown":
      setTimeout(() => process.exit(0), 0)
      return json({ ok: true })
    default:
      return json({ ok: false, error: `unknown control action: ${action}` }, 400)
  }
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
    if (!authorized(request)) return json({ error: "unauthorized" }, 401)
    if (url.pathname === "/api/event" && request.method === "GET") {
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            const subscriber = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
            subscribers.add(subscriber)
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ id: "evt_host_connected", type: "server.connected", data: {} })}\n\n`,
              ),
            )
            const keepalive = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 15_000)
            request.signal.addEventListener(
              "abort",
              () => {
                clearInterval(keepalive)
                subscribers.delete(subscriber)
                controller.close()
              },
              { once: true },
            )
          },
        }),
        { headers: { "content-type": "text/event-stream", "cache-control": "no-store", ...cors } },
      )
    }
    if (url.pathname.startsWith("/__test/")) {
      const body =
        request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {}
      return control(url.pathname.slice("/__test/".length), body)
    }
    if (url.pathname.startsWith("/api/rpc/")) {
      const [, , , rpcID, method] = url.pathname.split("/")
      if (rpcID !== definition?.id && rpcID !== "superpowers.execution.v1") {
        return json({ _tag: "RpcError", type: "rpc.unavailable", message: `RPC is unavailable: ${rpcID}` }, 400)
      }
      const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as { input?: unknown }) : {}
      const result = await callRpc(method ?? "", body.input)
      return json(result.body, result.status)
    }
    if (url.pathname.startsWith("/api/")) {
      const response = await native.handler(request)
      for (const [key, value] of Object.entries(cors)) response.headers.set(key, value)
      response.headers.set("cache-control", "no-store")
      return response
    }
    return json({ error: "not found" }, 404)
  },
})

await loadPlugin()

process.stdout.write(`EXECUTION_HOST_READY port=${server.port} pid=${process.pid} version=${pluginVersion}\n`)

const shutdown = async () => {
  await unloadPlugin().catch(() => undefined)
  await native.dispose().catch(() => undefined)
  await server.stop(true).catch(() => undefined)
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
process.on("message", (message) => {
  if (message === "shutdown") void shutdown()
})

type SchemaValidationResult =
  | { readonly value: unknown }
  | { readonly issues: readonly { readonly message?: string }[] }

async function decodeInput(schema: unknown, input: unknown): Promise<ToolResult<unknown>> {
  if (!isStandardSchema(schema)) return { ok: true, value: input }
  const result = await schema["~standard"].validate(input)
  if ("issues" in result) {
    const detail = result.issues.map((issue) => issue.message ?? "invalid input").join("; ")
    return { ok: false, error: { code: "invalid_input", detail } }
  }
  return { ok: true, value: result.value }
}

function isStandardSchema(
  value: unknown,
): value is { readonly "~standard": { validate: (input: unknown) => SchemaValidationResult | Promise<SchemaValidationResult> } } {
  return typeof value === "object" && value !== null && "~standard" in value
}

function toolErrorData(error: Tool.Error): ExecutionErrorData {
  const candidate = error.metadata?.execution ?? error.error
  if (isExecutionError(candidate)) return candidate
  return { code: "storage_unavailable", detail: error.message }
}

function isExecutionError(value: unknown): value is ExecutionErrorData {
  return typeof value === "object" && value !== null && "code" in value && typeof value.code === "string"
}
