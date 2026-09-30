import {
  client,
  ndJsonStream,
  RequestError,
  type AgentNotificationMethod,
  type AgentNotificationParamsByMethod,
  type AgentRequestMethod,
  type AgentRequestParamsByMethod,
  type AgentRequestResponsesByMethod,
  type AnyMessage,
  type ContentBlock,
  type McpServer,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
  type WriteTextFileRequest,
} from "@agentclientprotocol/sdk"
import {
  OpenCode,
  type AgentInfo,
  type CommandInfo,
  type ModelInfo,
  type ModelRef,
  type OpenCodeEvent,
  type SessionInfo,
  type SessionMessageInfo,
  type TokenUsageInfo,
} from "@opencode/client/promise"
import { ACP } from "../../src/acp/agent"

type DurableEvent = Extract<OpenCodeEvent, { durable: unknown }>
type EphemeralEvent = Exclude<OpenCodeEvent, DurableEvent>
type EventData<Type extends OpenCodeEvent["type"]> = Extract<OpenCodeEvent, { type: Type }>["data"]

export type ServerRequest = {
  readonly method: string
  readonly path: string
  readonly query: Record<string, string>
  readonly body: unknown
}

export type FakeServer = {
  readonly requests: ServerRequest[]
  readonly sessions: Map<string, SessionInfo>
  readonly messages: Map<string, SessionMessageInfo[]>
  send(event: unknown): void
}

type Send = (event: unknown) => void

export type WireOptions = {
  readonly fetch?: (request: ServerRequest, server: FakeServer) => Response | undefined | Promise<Response | undefined>
  readonly models?: readonly ModelInfo[]
  readonly defaultModel?: ModelInfo
  readonly agents?: readonly AgentInfo[]
  readonly commands?: readonly CommandInfo[]
  readonly onPrompt?: (input: {
    readonly sessionID: string
    readonly id: string
    readonly body: unknown
    readonly signal: AbortSignal
    readonly send: Send
  }) => void | Promise<void>
  readonly onInterrupt?: (input: { readonly sessionID: string; readonly send: Send }) => unknown
  readonly onPermissionReply?: (input: {
    readonly sessionID: string
    readonly requestID: string
    readonly decision: string
    readonly send: Send
  }) => void | Promise<void>
  readonly onFormCancel?: (input: {
    readonly sessionID: string
    readonly formID: string
    readonly send: Send
  }) => void | Promise<void>
  readonly permission?: (
    request: RequestPermissionRequest,
    signal: AbortSignal,
  ) => RequestPermissionResponse | Promise<RequestPermissionResponse>
}

export type ClientCapabilities = {
  readonly writeTextFile?: boolean
  readonly childSessionUpdates?: boolean
  readonly terminalAuth?: boolean
}

export const ChildSessionUpdateMethod = "opencode/session/child_update"

export const testModel = {
  id: "test-model",
  modelID: "test-model",
  providerID: "test",
  name: "Test Model",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [{ id: "default" }, { id: "high" }],
  time: { released: 0 },
  cost: [],
  status: "active",
  enabled: true,
  limit: { context: 100_000, output: 10_000 },
} satisfies ModelInfo

export const secondModel = {
  id: "second-model",
  modelID: "second-model",
  providerID: "test",
  name: "Second Model",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [{ id: "low" }, { id: "medium" }],
  time: { released: 0 },
  cost: [],
  status: "active",
  enabled: true,
  limit: { context: 200_000, output: 20_000 },
} satisfies ModelInfo

export const buildAgent = {
  id: "build",
  name: "Build",
  request: { settings: {}, headers: {}, body: {} },
  mode: "primary",
  hidden: false,
  permissions: [],
} satisfies AgentInfo

export const planAgent = {
  id: "plan",
  name: "Plan",
  description: "Plan first",
  request: { settings: {}, headers: {}, body: {} },
  mode: "primary",
  hidden: false,
  permissions: [],
} satisfies AgentInfo

export const reviewCommand = {
  name: "review",
  description: "Review changes",
} satisfies CommandInfo

export function makeSession(
  id: string,
  input: {
    readonly cwd?: string
    readonly agent?: string
    readonly model?: ModelRef
    readonly cost?: number
    readonly tokens?: TokenUsageInfo
    readonly time?: SessionInfo["time"]
    readonly title?: string
  } = {},
): SessionInfo {
  return {
    id,
    projectID: "global",
    agent: input.agent ?? "build",
    model: input.model ?? { providerID: "test", id: "test-model", variant: "default" },
    cost: input.cost ?? 0,
    tokens: input.tokens ?? tokens(0),
    time: input.time ?? { created: 0, updated: 0 },
    title: input.title ?? `Session ${id}`,
    location: { directory: input.cwd ?? "/workspace" },
  }
}

const ids = { next: 0 }

export function durableEvent<Type extends DurableEvent["type"]>(
  type: Type,
  data: Extract<DurableEvent, { type: Type }>["data"],
) {
  ids.next++
  return {
    id: `evt_${ids.next}`,
    created: ids.next,
    type,
    durable: { aggregateID: "test", seq: ids.next, version: 1 },
    data,
  }
}

export function ephemeralEvent<Type extends EphemeralEvent["type"]>(
  type: Type,
  data: Extract<EphemeralEvent, { type: Type }>["data"],
) {
  ids.next++
  return { id: `evt_${ids.next}`, created: ids.next, type, data }
}

export function tokens(value = 1): TokenUsageInfo {
  return { input: value, output: value, reasoning: 0, cache: { read: 0, write: 0 } }
}

export const delivered = (sessionID: string, inboxID: string) =>
  durableEvent("session.inbox.delivered", { sessionID, inboxID })

export const succeeded = (sessionID: string) => durableEvent("session.execution.succeeded", { sessionID })

export const textDelta = (sessionID: string, assistantMessageID: string, delta: string, ordinal = 0) =>
  ephemeralEvent("session.text.delta", { sessionID, assistantMessageID, ordinal, delta })

export const stepEnded = (
  sessionID: string,
  assistantMessageID: string,
  input: {
    readonly finish?: EventData<"session.step.ended">["finish"]
    readonly tokens?: TokenUsageInfo
  } = {},
) =>
  durableEvent("session.step.ended", {
    sessionID,
    assistantMessageID,
    finish: input.finish ?? "stop",
    cost: 0,
    tokens: input.tokens ?? tokens(),
  })

export const childCreated = (sessionID: string, parentID: string, title: string) =>
  durableEvent("session.created", {
    sessionID,
    slug: sessionID,
    projectID: "project",
    location: { directory: "/workspace" },
    parentID,
    title,
    version: "test",
  })

export function toolStarted(sessionID: string, id: string, name: string) {
  return durableEvent("session.tool.input.started", { sessionID, assistantMessageID: "msg_tools", id, name })
}

export function toolCalled(sessionID: string, id: string, input: EventData<"session.tool.called">["input"]) {
  return durableEvent("session.tool.called", { sessionID, assistantMessageID: "msg_tools", id, input, executed: false })
}

export function toolProgress(sessionID: string, id: string, metadata: EventData<"session.tool.progress">["metadata"]) {
  return ephemeralEvent("session.tool.progress", { sessionID, assistantMessageID: "msg_tools", id, metadata })
}

export function toolSucceeded(
  sessionID: string,
  id: string,
  metadata: EventData<"session.tool.success">["metadata"],
  text: string,
) {
  return durableEvent("session.tool.success", {
    sessionID,
    assistantMessageID: "msg_tools",
    id,
    metadata,
    content: [{ type: "text", text }],
    executed: true,
  })
}

export function permissionAsked(
  sessionID: string,
  id: string,
  input: {
    readonly action?: string
    readonly metadata?: EventData<"permission.asked">["metadata"]
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
  } = {},
) {
  return ephemeralEvent("permission.asked", {
    id,
    sessionID,
    action: input.action ?? "shell",
    resources: ["*"],
    metadata: input.metadata ?? { command: "printf hello" },
    ...(input.source ? { source: input.source } : {}),
  })
}

export function assistantMessage(id: string, input: Partial<Extract<SessionMessageInfo, { type: "assistant" }>> = {}) {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { providerID: "test", id: "test-model" },
    content: [],
    finish: "stop",
    tokens: tokens(),
    time: { created: 1, completed: 2 },
    ...input,
  } satisfies SessionMessageInfo
}

export async function startWire(options: WireOptions = {}) {
  const waiters = new Set<() => void>()
  const changed = () => waiters.forEach((check) => check())
  const server = startServer(options, changed)

  const received: AnyMessage[] = []
  const updates: SessionNotification[] = []
  const permissions: RequestPermissionRequest[] = []
  const writes: WriteTextFileRequest[] = []
  const extensions: Array<{ readonly method: string; readonly params: Record<string, unknown> }> = []
  // Handlers record typed params after SDK validation; this counter lets callers wait for them to catch up with the wire.
  const counts = { tapped: 0, handled: 0 }
  const handledMethods = new Set<string>([
    "session/update",
    "session/request_permission",
    "fs/write_text_file",
    ChildSessionUpdateMethod,
  ])
  const handled = () => {
    counts.handled++
    changed()
  }

  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>()
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>()
  const agentConnection = ACP.connect(
    OpenCode.make({ baseUrl: server.url }),
    ndJsonStream(agentToClient.writable, clientToAgent.readable),
  )
  const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
  const connection = client({ name: "test" })
    .onNotification("session/update", (ctx) => {
      updates.push(ctx.params)
      handled()
    })
    .onNotification(ChildSessionUpdateMethod, objectParams, (ctx) => {
      extensions.push({ method: ChildSessionUpdateMethod, params: ctx.params })
      handled()
    })
    .onRequest("session/request_permission", (ctx) => {
      permissions.push(ctx.params)
      handled()
      return options.permission?.(ctx.params, ctx.signal) ?? { outcome: { outcome: "cancelled" } }
    })
    .onRequest("fs/write_text_file", (ctx) => {
      writes.push(ctx.params)
      handled()
      return {}
    })
    .connect({
      writable: clientStream.writable,
      readable: clientStream.readable.pipeThrough(
        new TransformStream<AnyMessage, AnyMessage>({
          transform(message, controller) {
            received.push(message)
            if ("method" in message && handledMethods.has(message.method)) counts.tapped++
            controller.enqueue(message)
            changed()
          },
        }),
      ),
    })

  const until = <T>(read: () => T | undefined | false, description = "condition", timeout = 5_000) => {
    const initial = read()
    if (initial !== undefined && initial !== false) return Promise.resolve(initial)
    return new Promise<T>((resolve, reject) => {
      const check = () => {
        const value = read()
        if (value === undefined || value === false) return
        cleanup()
        resolve(value)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`timed out waiting for ${description}`))
      }, timeout)
      const cleanup = () => {
        clearTimeout(timer)
        waiters.delete(check)
      }
      waiters.add(check)
    })
  }

  const settle = <T>(promise: Promise<T>) =>
    promise.finally(() => {
      const target = counts.tapped
      return until(() => counts.handled >= target, "client handlers to record agent messages")
    })

  const request = <Method extends AgentRequestMethod>(
    method: Method,
    params: AgentRequestParamsByMethod[Method],
    signal?: AbortSignal,
  ): Promise<AgentRequestResponsesByMethod[Method]> =>
    settle(connection.agent.request(method, params, signal ? { cancellationSignal: signal } : undefined))

  const wire = {
    server,
    received,
    updates,
    permissions,
    writes,
    extensions,
    request,
    until,
    send<Method extends AgentRequestMethod>(method: Method, params: AgentRequestParamsByMethod[Method]) {
      const controller = new AbortController()
      return { response: request(method, params, controller.signal), cancel: () => controller.abort() }
    },
    notify: <Method extends AgentNotificationMethod>(method: Method, params: AgentNotificationParamsByMethod[Method]) =>
      connection.agent.notify(method, params),
    initialize: (capabilities: ClientCapabilities = {}) =>
      request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          ...(capabilities.writeTextFile ? { fs: { writeTextFile: true, readTextFile: false } } : {}),
          _meta: {
            ...(capabilities.childSessionUpdates ? { "opencode/child-session-updates": true } : {}),
            ...(capabilities.terminalAuth ? { "terminal-auth": true } : {}),
          },
        },
        clientInfo: { name: "test", version: "1" },
      }),
    newSession: (cwd = "/workspace", mcpServers: McpServer[] = []) => request("session/new", { cwd, mcpServers }),
    prompt: (sessionId: string, prompt: string | ContentBlock[]) =>
      request("session/prompt", {
        sessionId,
        prompt: typeof prompt === "string" ? [{ type: "text", text: prompt }] : prompt,
      }),
    waitForUpdate: (predicate: (update: SessionNotification) => boolean, description = "session/update") =>
      until(() => updates.find(predicate), description),
    async [Symbol.asyncDispose]() {
      connection.close()
      agentConnection.close()
      await server.stop()
    },
  }
  return wire
}

export async function rpcError(promise: Promise<unknown>) {
  const error = await promise.then(
    (result) => {
      throw new Error(`expected an ACP error, got ${JSON.stringify(result)}`)
    },
    (error: unknown) => error,
  )
  if (!(error instanceof RequestError)) throw error
  return { code: error.code, message: error.message, data: error.data }
}

export function currentValue(
  result: { readonly configOptions?: readonly SessionConfigOption[] | null } | undefined,
  id: string,
) {
  return result?.configOptions?.find((option) => option.id === id)?.currentValue
}

function promptID(request: ServerRequest) {
  const id = stringField(request.body, "id")
  if (!id) throw new Error(`missing prompt id for ${request.path}`)
  return id
}

function startServer(options: WireOptions, changed: () => void) {
  const encoder = new TextEncoder()
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const requests: ServerRequest[] = []
  const sessions = new Map<string, SessionInfo>()
  const messages = new Map<string, SessionMessageInfo[]>()
  const counter = { sessions: 0 }
  const models = options.models ?? [testModel, secondModel]

  const send = (event: unknown) => {
    const chunk = encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
    for (const stream of streams) {
      try {
        stream.enqueue(chunk)
      } catch {
        streams.delete(stream)
      }
    }
  }
  const fake: FakeServer = { requests, sessions, messages, send }
  const createSession = (source: SessionInfo) => {
    const session = { ...source, id: `ses_${++counter.sessions}` }
    sessions.set(session.id, session)
    return session
  }
  const notFound = (sessionID: string) =>
    Response.json({ _tag: "SessionNotFoundError", sessionID, message: "session not found" }, { status: 404 })

  const http = Bun.serve({
    port: 0,
    fetch: (raw) => handle(raw).finally(changed),
  })

  async function handle(raw: Request) {
    const url = new URL(raw.url)
    const request: ServerRequest = {
      method: raw.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body: raw.method === "GET" || raw.method === "HEAD" ? undefined : await raw.json().catch(() => undefined),
    }
    requests.push(request)
    changed()
    const override = await options.fetch?.(request, fake)
    if (override) return override

    const directory = request.query["location[directory]"] ?? "/workspace"
    const location = { directory, project: { id: "global", directory } }
    const route = (method: string, pattern: RegExp) =>
      request.method === method ? pattern.exec(request.path)?.slice(1).map(decodeURIComponent) : undefined

    if (request.path === "/api/event") {
      const state: { stream?: ReadableStreamDefaultController<Uint8Array> } = {}
      return new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            state.stream = stream
            streams.add(stream)
            stream.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ id: "evt_connected", type: "server.connected", data: {} })}\n\n`,
              ),
            )
          },
          cancel() {
            if (state.stream) streams.delete(state.stream)
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    }
    if (request.path === "/api/model") return Response.json({ location, data: models })
    if (request.path === "/api/model/default")
      return Response.json({ location, data: options.defaultModel ?? models[0] ?? null })
    if (request.path === "/api/agent")
      return Response.json({ location, data: options.agents ?? [buildAgent, planAgent] })
    if (request.path === "/api/command") return Response.json({ location, data: options.commands ?? [reviewCommand] })

    if (request.method === "POST" && request.path === "/api/session") {
      const cwd = stringField(field(request.body, "location"), "directory") ?? "/workspace"
      return Response.json({ data: createSession(makeSession("", { cwd })) })
    }
    if (request.method === "GET" && request.path === "/api/session") {
      const data = [...sessions.values()]
        .filter((session) => !request.query.directory || session.location.directory === request.query.directory)
        .toSorted((a, b) => b.time.updated - a.time.updated)
      return Response.json({ data, cursor: {} })
    }
    if (request.method === "PUT" && request.path.startsWith("/api/experimental/mcp/"))
      return new Response(null, { status: 204 })

    const get = route("GET", /^\/api\/session\/([^/]+)$/)
    if (get?.[0]) {
      const session = sessions.get(get[0])
      return session ? Response.json({ data: session }) : notFound(get[0])
    }
    const remove = route("DELETE", /^\/api\/session\/([^/]+)$/)
    if (remove?.[0]) {
      if (!sessions.delete(remove[0])) return notFound(remove[0])
      return new Response(null, { status: 204 })
    }
    const fork = route("POST", /^\/api\/session\/([^/]+)\/fork$/)
    if (fork?.[0]) {
      const source = sessions.get(fork[0])
      if (!source) return notFound(fork[0])
      const forked = createSession(source)
      messages.set(forked.id, [...(messages.get(source.id) ?? [])])
      return Response.json({ data: forked })
    }
    const select = route("POST", /^\/api\/session\/([^/]+)\/(model|agent)$/)
    if (select?.[0]) return new Response(null, { status: 204 })
    const list = route("GET", /^\/api\/session\/([^/]+)\/message$/)
    if (list?.[0]) return Response.json({ data: messages.get(list[0]) ?? [], cursor: {} })
    const message = route("GET", /^\/api\/session\/([^/]+)\/message\/([^/]+)$/)
    if (message?.[0] && message[1]) {
      const messageID = message[1]
      return Response.json({
        data: messages.get(message[0])?.find((item) => item.id === messageID) ?? assistantMessage(messageID),
      })
    }
    const prompt = route("POST", /^\/api\/session\/([^/]+)\/prompt$/)
    if (prompt?.[0]) {
      const sessionID = prompt[0]
      const id = promptID(request)
      await (options.onPrompt ?? completeTurn)({ sessionID, id, body: request.body, signal: raw.signal, send })
      return Response.json({ data: { text: stringField(request.body, "text") ?? "" } })
    }
    const compact = route("POST", /^\/api\/session\/([^/]+)\/compact$/)
    if (compact?.[0]) {
      completeTurn({ sessionID: compact[0], id: promptID(request), send })
      return Response.json({ data: {} })
    }
    if (route("POST", /^\/api\/session\/([^/]+)\/command$/)) return new Response(null, { status: 204 })
    if (route("POST", /^\/api\/session\/([^/]+)\/synthetic$/)) return Response.json({ data: {} })
    const interrupt = route("POST", /^\/api\/session\/([^/]+)\/interrupt$/)
    if (interrupt?.[0]) {
      const sessionID = interrupt[0]
      if (!sessions.has(sessionID)) return notFound(sessionID)
      const interrupted = (await options.onInterrupt?.({ sessionID, send })) === true
      return Response.json({ interrupted })
    }
    const reply = route("POST", /^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/)
    if (reply?.[0] && reply[1]) {
      const decision = stringField(request.body, "decision")
      if (!decision) return new Response(null, { status: 400 })
      await options.onPermissionReply?.({ sessionID: reply[0], requestID: reply[1], decision, send })
      return new Response(null, { status: 204 })
    }
    const form = route("DELETE", /^\/api\/session\/([^/]+)\/form\/([^/]+)$/)
    if (form?.[0] && form[1]) {
      await options.onFormCancel?.({ sessionID: form[0], formID: form[1], send })
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 404 })
  }

  return Object.assign(fake, {
    url: http.url.toString(),
    async stop() {
      for (const stream of streams) {
        try {
          stream.close()
        } catch {}
      }
      streams.clear()
      await http.stop(true)
    },
  })
}

function completeTurn(input: { readonly sessionID: string; readonly id: string; readonly send: Send }) {
  input.send(delivered(input.sessionID, input.id))
  input.send(succeeded(input.sessionID))
}

function objectParams(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("expected object params")
  return Object.fromEntries(Object.entries(params))
}

function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined
  return Object.entries(value).find((entry) => entry[0] === key)?.[1]
}

function stringField(value: unknown, key: string) {
  const result = field(value, key)
  return typeof result === "string" ? result : undefined
}
