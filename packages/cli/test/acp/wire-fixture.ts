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
  type CompactionCapabilities,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type McpServer,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk"
import { OpenCode } from "@opencode/client/effect"
import type { OpenCodeEventEncoded } from "@opencode/protocol/groups/event"
import type { Agent } from "@opencode/schema/agent"
import type { Command } from "@opencode/schema/command"
import { Form } from "@opencode/schema/form"
import type { Location } from "@opencode/schema/location"
import type { Model } from "@opencode/schema/model"
import type { Plugin } from "@opencode/schema/plugin"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { TokenUsage } from "@opencode/schema/token-usage"
import type { BunRequest } from "bun"
import { createTwoFilesPatch } from "diff"
import { Duration, Effect, Exit, Logger, Option, Schema, Scope } from "effect"
import { FetchHttpClient } from "effect/http"
import { ACP } from "../../src/acp/agent"
import { ACPTurn } from "../../src/acp/turn"

// The fake server sends and stores the wire form of each value.
type OpenCodeEvent = OpenCodeEventEncoded
type AgentInfo = typeof Agent.Info.Encoded
type CommandInfo = typeof Command.Info.Encoded
type LocationRef = typeof Location.PublicRef.Encoded
type ModelInfo = typeof Model.Info.Encoded
type ModelRef = typeof Model.Ref.Encoded
type PluginInfo = typeof Plugin.Info.Encoded
type SessionInfo = typeof Session.Info.Encoded
type SessionMessageInfo = typeof SessionMessage.Info.Encoded
type TokenUsageInfo = typeof TokenUsage.Info.Encoded
type DurableEvent = Extract<OpenCodeEvent, { durable: unknown }>
type EphemeralEvent = Exclude<OpenCodeEvent, DurableEvent>
type EventData<Type extends OpenCodeEvent["type"]> = Extract<OpenCodeEvent, { type: Type }>["data"]
type AssistantMessage = Extract<SessionMessageInfo, { type: "assistant" }>

type Events = ReadonlyArray<OpenCodeEvent> | void
type Hook<Input> = (input: Input) => Events | Promise<Events>

type ServerRequest = {
  readonly method: string
  readonly path: string
  readonly query: Record<string, string>
  readonly body: unknown
}

const Files = Schema.Array(Schema.Struct({ uri: Schema.String, name: Schema.optional(Schema.String) }))
const Delivery = Schema.optional(Schema.String)
const PromptBody = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  files: Files,
  delivery: Delivery,
  resume: Schema.optional(Schema.Boolean),
})
const CommandBody = Schema.Struct({ name: Schema.String, text: Schema.String, files: Files, delivery: Delivery })
const CompactBody = Schema.Struct({ id: Schema.String })
const SyntheticBody = Schema.Struct({
  text: Schema.String,
  description: Schema.optional(Schema.String),
  delivery: Delivery,
  resume: Schema.optional(Schema.Boolean),
})
const Permissions = Schema.Array(
  Schema.Struct({ action: Schema.String, resource: Schema.String, effect: Schema.Literals(["allow", "deny", "ask"]) }),
)
const Metadata = Schema.Record(Schema.String, Schema.MutableJson)
const CreateBody = Schema.Struct({
  location: Schema.Struct({ directory: Schema.String }),
  permissions: Schema.optional(Permissions),
  metadata: Schema.optional(Metadata),
})
const UpdateBody = Schema.Struct({ permissions: Schema.optional(Permissions), metadata: Schema.optional(Metadata) })
const ModelBody = Schema.Struct({
  model: Schema.Struct({ providerID: Schema.String, id: Schema.String, variant: Schema.optional(Schema.String) }),
})
const AgentBody = Schema.Struct({ agent: Schema.String })
const ReplyBody = Schema.Struct({ decision: Schema.Literals(["once", "always", "reject"]) })
const FormReplyBody = Schema.Struct({ answer: Form.Answer })
const McpBody = Schema.Struct({ config: Schema.Unknown })
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

type Submission =
  | ({ readonly kind: "prompt"; readonly sessionID: string } & typeof PromptBody.Type)
  | ({ readonly kind: "command"; readonly sessionID: string } & typeof CommandBody.Type)
  | ({ readonly kind: "compact"; readonly sessionID: string } & typeof CompactBody.Type)
  | ({ readonly kind: "synthetic"; readonly sessionID: string } & typeof SyntheticBody.Type)

type PromptSubmission = Extract<Submission, { readonly kind: "prompt" }>

type Selection =
  | { readonly sessionID: string; readonly model: typeof ModelBody.Type.model }
  | { readonly sessionID: string; readonly agent: string }

const ChildSession = {
  rootSessionId: Schema.String,
  childSessionId: Schema.String,
  parentSessionId: Schema.String,
  depth: Schema.Number,
  title: Schema.optional(Schema.String),
}
const ChildUpdate = Schema.Union([
  Schema.Struct({
    ...ChildSession,
    type: Schema.Literal("update"),
    update: Schema.StructWithRest(Schema.Struct({ sessionUpdate: Schema.String }), [
      Schema.Record(Schema.String, Schema.Unknown),
    ]),
  }),
  Schema.Struct({
    ...ChildSession,
    type: Schema.Literal("status"),
    status: Schema.Literals(["created", "running", "completed", "failed", "interrupted"]),
    error: Schema.optional(Schema.Struct({ type: Schema.String, message: Schema.String })),
  }),
])

export type WireOptions = {
  readonly fetch?: (request: ServerRequest) => Response | undefined | Promise<Response | undefined>
  readonly onPrompt?: Hook<{
    readonly sessionID: string
    readonly id: string
    readonly text: string
    readonly signal: AbortSignal
  }>
  readonly onInterrupt?: Hook<{ readonly sessionID: string }>
  readonly onFormCancel?: Hook<{ readonly sessionID: string; readonly formID: string }>
  readonly onFormReply?: Hook<FormReply>
  readonly permission?: (
    request: RequestPermissionRequest,
    signal: AbortSignal,
  ) => RequestPermissionResponse | Promise<RequestPermissionResponse>
  readonly elicitation?: (
    request: CreateElicitationRequest,
    signal: AbortSignal,
  ) => CreateElicitationResponse | Promise<CreateElicitationResponse>
  readonly cancelDrainTimeout?: Duration.Input
}

type FormReply = {
  readonly sessionID: string
  readonly formID: string
  readonly answer: typeof FormReplyBody.Type.answer
}

type Catalog = {
  models: ModelInfo[]
  agents: AgentInfo[]
  commands: CommandInfo[]
  plugins: PluginInfo[]
}

export type InitializeOptions = {
  readonly childSessionUpdates?: boolean
  readonly terminalAuth?: boolean
  readonly elicitation?: boolean
  readonly compaction?: CompactionCapabilities | null
}

const testModel = {
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

const buildAgent = {
  id: "build",
  name: "Build",
  request: { settings: {}, headers: {}, body: {} },
  mode: "primary",
  hidden: false,
  permissions: [],
} satisfies AgentInfo

const planAgent = {
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
    readonly time?: SessionInfo["time"]
  } = {},
): SessionInfo {
  return {
    id,
    projectID: "global",
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.model ? { model: input.model } : {}),
    cost: input.cost ?? 0,
    tokens: tokens(0),
    time: input.time ?? { created: 0, updated: 0 },
    title: `Session ${id}`,
    location: { directory: input.cwd ?? "/workspace" },
  }
}

export function assistantMessage(id: string, input: Partial<AssistantMessage> = {}) {
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

export function tokens(value = 1): TokenUsageInfo {
  return { input: value, output: value, reasoning: 0, cache: { read: 0, write: 0 } }
}

// The fake server stamps ids and sequence numbers when it sends an event. The wire form types every version as a
// number, so the client's decode is what rejects an event sent under the wrong version.
function durable(version: number) {
  return <Type extends DurableEvent["type"]>(type: Type, data: EventData<Type>) => ({
    id: "",
    created: 0,
    type,
    durable: { aggregateID: "test", seq: 0, version },
    data,
  })
}

export const durableEvent = durable(1)
const durableEventV2 = durable(2)

export function ephemeralEvent<Type extends EphemeralEvent["type"]>(
  type: Type,
  data: EventData<Type>,
  location?: LocationRef,
) {
  return { id: "", created: 0, type, data, ...(location ? { location } : {}) }
}

export const delivered = (sessionID: string, inboxID: string) =>
  durableEvent("session.inbox.delivered", { sessionID, inboxID })

export const succeeded = (sessionID: string) => durableEvent("session.execution.succeeded", { sessionID })

export const interrupted = (sessionID: string) =>
  durableEvent("session.execution.interrupted", { sessionID, reason: "user" })

export const failed = (sessionID: string, error: EventData<"session.execution.failed">["error"]) =>
  durableEvent("session.execution.failed", { sessionID, error })

export function turn(sessionID: string, inboxID: string, ...events: OpenCodeEvent[]): OpenCodeEvent[] {
  return [delivered(sessionID, inboxID), ...events, succeeded(sessionID)]
}

export const textDelta = (sessionID: string, assistantMessageID: string, delta: string, ordinal = 0) =>
  ephemeralEvent("session.text.delta", { sessionID, assistantMessageID, ordinal, delta })

export const reasoningDelta = (sessionID: string, assistantMessageID: string, delta: string, ordinal = 0) =>
  ephemeralEvent("session.reasoning.delta", { sessionID, assistantMessageID, ordinal, delta })

export const stepEnded = (
  sessionID: string,
  assistantMessageID: string,
  input: { readonly finish?: EventData<"session.step.ended">["finish"]; readonly tokens?: TokenUsageInfo } = {},
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

export function fileDiff(
  file: string,
  before: string,
  after: string,
  status: "added" | "deleted" | "modified" = "modified",
) {
  return { file, patch: createTwoFilesPatch(file, file, before, after), additions: 1, deletions: 1, status }
}

export function toolSucceeded(
  sessionID: string,
  id: string,
  metadata: EventData<"session.tool.success">["metadata"],
  text: string,
) {
  return durableEventV2("session.tool.success", {
    sessionID,
    assistantMessageID: "msg_tools",
    id,
    metadata,
    content: [{ type: "text", text }],
    executed: true,
  })
}

export function toolFailed(
  sessionID: string,
  id: string,
  input: Omit<EventData<"session.tool.failed">, "sessionID" | "assistantMessageID" | "id" | "executed">,
) {
  return durableEventV2("session.tool.failed", {
    sessionID,
    assistantMessageID: "msg_tools",
    id,
    executed: true,
    ...input,
  })
}

export function permissionAsked(
  sessionID: string,
  id: string,
  input: {
    readonly action?: string
    readonly resources?: EventData<"permission.asked">["resources"]
    readonly metadata?: EventData<"permission.asked">["metadata"]
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
  } = {},
) {
  return ephemeralEvent("permission.asked", {
    id,
    sessionID,
    action: input.action ?? "shell",
    resources: input.resources ?? ["*"],
    metadata: input.metadata ?? { command: "printf hello" },
    ...(input.source ? { source: input.source } : {}),
  })
}

/** The response to a submission the server admitted to the session inbox. */
export function enqueued(sessionID: string, id: string, type: string, payload: object) {
  return Response.json({ data: { id, sessionID, time: { created: 0 }, type, payload, delivery: "steer" } })
}

export async function startWire(options: WireOptions = {}) {
  const waiters = new Set<() => void>()
  const changed = () => waiters.forEach((check) => check())
  const server = startServer(options, changed)

  const received: AnyMessage[] = []
  const updates: SessionNotification[] = []
  const permissions: RequestPermissionRequest[] = []
  const childUpdates: Array<typeof ChildUpdate.Type> = []
  const elicitations: CreateElicitationRequest[] = []
  // Client handlers record SDK-validated params; responses wait until they have seen every earlier agent message.
  const counts = { sent: 0, handled: 0 }
  const handled = <Value>(list: Value[], value: Value) => {
    list.push(value)
    counts.handled++
    changed()
  }

  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>()
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>()
  const logs: Array<Pick<Logger.Options<unknown>, "message" | "cause">> = []
  const agentScope = Scope.makeUnsafe()
  const agentConnection = await Effect.runPromise(
    OpenCode.make({ baseUrl: server.url }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.flatMap((client) => ACP.connect(client, ndJsonStream(agentToClient.writable, clientToAgent.readable))),
      Scope.provide(agentScope),
      (effect) =>
        options.cancelDrainTimeout === undefined
          ? effect
          : Effect.provideService(effect, ACPTurn.CancelDrainTimeout, options.cancelDrainTimeout),
      Effect.provide(Logger.layer([Logger.make((log) => logs.push({ message: log.message, cause: log.cause }))])),
    ),
  )
  const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
  const connection = client({ name: "test" })
    .onNotification("session/update", (ctx) => handled(updates, ctx.params))
    .onNotification("opencode/session/child_update", Schema.decodeUnknownSync(ChildUpdate), (ctx) =>
      handled(childUpdates, ctx.params),
    )
    .onRequest("session/request_permission", (ctx) => {
      handled(permissions, ctx.params)
      return options.permission?.(ctx.params, ctx.signal) ?? { outcome: { outcome: "cancelled" } }
    })
    .onRequest("elicitation/create", (ctx) => {
      handled(elicitations, ctx.params)
      return options.elicitation?.(ctx.params, ctx.signal) ?? { action: "cancel" }
    })
    .connect({
      writable: clientStream.writable,
      readable: clientStream.readable.pipeThrough(
        new TransformStream<AnyMessage, AnyMessage>({
          transform(message, controller) {
            received.push(message)
            if ("method" in message && !message.method.startsWith("$/")) counts.sent++
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

  const request = <Method extends AgentRequestMethod>(
    method: Method,
    params: AgentRequestParamsByMethod[Method],
    signal?: AbortSignal,
  ): Promise<AgentRequestResponsesByMethod[Method]> =>
    connection.agent.request(method, params, signal ? { cancellationSignal: signal } : undefined).finally(() => {
      const target = counts.sent
      return until(() => counts.handled >= target, "client handlers for every agent message (is one missing?)")
    })

  const requestExt = (method: string, params: unknown): Promise<unknown> =>
    connection.agent.request(method, params).finally(() => {
      const target = counts.sent
      return until(() => counts.handled >= target, "client handlers for every agent message (is one missing?)")
    })

  const initialize = (capabilities: InitializeOptions = {}) =>
    request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        ...(capabilities.elicitation ? { elicitation: { form: {} } } : {}),
        ...(capabilities.compaction !== undefined ? { session: { compaction: capabilities.compaction } } : {}),
        _meta: {
          ...(capabilities.childSessionUpdates ? { "opencode/child-session-updates": true } : {}),
          ...(capabilities.terminalAuth ? { "terminal-auth": true } : {}),
        },
      },
      clientInfo: { name: "test", version: "1" },
    })

  return {
    server,
    received,
    updates,
    permissions,
    childUpdates,
    elicitations,
    logs,
    request,
    requestExt,
    until,
    initialize,
    notify: <Method extends AgentNotificationMethod>(method: Method, params: AgentNotificationParamsByMethod[Method]) =>
      connection.agent.notify(method, params),
    newSession: (cwd = "/workspace", mcpServers: McpServer[] = []) => request("session/new", { cwd, mcpServers }),
    prompt: (sessionId: string, prompt: string | ContentBlock[], signal?: AbortSignal) =>
      request(
        "session/prompt",
        { sessionId, prompt: typeof prompt === "string" ? [{ type: "text", text: prompt }] : prompt },
        signal,
      ),
    waitForUpdate: (predicate: (update: SessionNotification) => boolean, description = "session/update") =>
      until(() => updates.find(predicate), description),
    async [Symbol.asyncDispose]() {
      connection.close()
      agentConnection.close()
      await Effect.runPromise(Scope.close(agentScope, Exit.void))
      await server.stop()
    },
  }
}

export type Wire = Awaited<ReturnType<typeof startWire>>

export async function startSession(options: WireOptions & { readonly capabilities?: InitializeOptions } = {}) {
  const wire = await startWire(options)
  await wire.initialize(options.capabilities)
  const session = await wire.newSession()
  return Object.assign(wire, { sessionId: session.sessionId })
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

function startServer(options: WireOptions, changed: () => void) {
  const encoder = new TextEncoder()
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const counter = { sessions: 0, events: 0 }
  const catalog: Catalog = {
    models: [testModel, secondModel],
    agents: [buildAgent, planAgent],
    commands: [reviewCommand],
    plugins: [
      {
        id: "opencode.models.dev",
        source: { type: "builtin" },
        features: { server: true },
        state: { status: "active" },
      },
    ],
  }
  const requests: ServerRequest[] = []
  const submissions: Submission[] = []
  const selections: Selection[] = []
  const interrupts: string[] = []
  const replies: Array<{ readonly sessionID: string; readonly requestID: string; readonly decision: string }> = []
  const cancelledForms: Array<{ readonly sessionID: string; readonly formID: string; readonly message?: string }> = []
  const repliedForms: FormReply[] = []
  const mcp: Array<{ readonly name: string; readonly directory?: string; readonly config: unknown }> = []
  const fake = {
    requests,
    catalog,
    sessions: new Map<string, SessionInfo>(),
    messages: new Map<string, SessionMessageInfo[]>(),
    submissions,
    get prompts() {
      return submissions.filter((item): item is PromptSubmission => item.kind === "prompt")
    },
    selections,
    active: new Set<string>(),
    interrupts,
    replies,
    cancelledForms,
    repliedForms,
    mcp,
    send(...events: ReadonlyArray<OpenCodeEvent>) {
      events.forEach((event) => {
        const seq = ++counter.events
        const stamped = {
          ...event,
          id: `evt_${seq}`,
          created: seq,
          ...("durable" in event ? { durable: { ...event.durable, seq } } : {}),
        }
        const chunk = encoder.encode(`data: ${JSON.stringify(stamped)}\n\n`)
        streams.forEach((stream) => stream.enqueue(chunk))
      })
    },
  }
  const emit = async (events: Events | Promise<Events>) => {
    const resolved = await events
    if (resolved) fake.send(...resolved)
    return resolved?.length ?? 0
  }
  const createSession = (source: SessionInfo) => {
    const session = { ...source, id: `ses_${++counter.sessions}` }
    fake.sessions.set(session.id, session)
    return session
  }
  const notFound = (sessionID: string) =>
    Response.json({ _tag: "SessionNotFoundError", sessionID, message: "session not found" }, { status: 404 })
  const noContent = () => new Response(null, { status: 204 })

  // Handlers record facts synchronously before awaiting hooks, so waiters can observe a held request.
  const observed = (response: Response | Promise<Response>) => {
    changed()
    return response
  }
  const record = async (req: Request) => {
    const url = new URL(req.url)
    const text = req.method === "GET" ? "" : await req.text()
    const request: ServerRequest = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body: text ? Option.getOrUndefined(decodeJson(text)) : undefined,
    }
    fake.requests.push(request)
    changed()
    return { request, text, override: await options.fetch?.(request) }
  }
  function route<Path extends string>(
    handle: (req: BunRequest<Path>, query: Record<string, string>) => Response | Promise<Response>,
  ) {
    return (req: BunRequest<Path>) =>
      record(req)
        .then((recorded) => recorded.override ?? observed(handle(req, recorded.request.query)))
        .finally(changed)
  }
  function body<Path extends string, A>(
    schema: Schema.Codec<A, unknown>,
    handle: (req: BunRequest<Path>, body: A, query: Record<string, string>) => Response | Promise<Response>,
  ) {
    // The JSON codec reads an explicit null as an absent optional field, as the server's does.
    const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.toCodecJson(schema)))
    return (req: BunRequest<Path>) =>
      record(req)
        .then((recorded) => {
          if (recorded.override) return recorded.override
          const parsed = decode(recorded.text)
          if (Option.isNone(parsed)) return new Response(null, { status: 400 })
          return observed(handle(req, parsed.value, recorded.request.query))
        })
        .finally(changed)
  }
  const catalogRoute = (data: () => unknown) =>
    route((_req, query) => {
      const directory = query["location[directory]"] ?? "/workspace"
      return Response.json({ location: { directory, project: { id: "global", directory } }, data: data() })
    })
  const page = <Item>(items: readonly Item[], query: Record<string, string>, limit: number) => {
    const start = Number(query.cursor ?? 0)
    const end = start + Number(query.limit ?? limit)
    return { data: items.slice(start, end), cursor: end < items.length ? { next: String(end) } : {} }
  }

  const http = Bun.serve({
    port: 0,
    fetch: (req) =>
      record(req)
        .then((recorded) => recorded.override ?? new Response(null, { status: 404 }))
        .finally(changed),
    routes: {
      "/api/event": {
        GET: route(() => {
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
        }),
      },
      "/api/model": { GET: catalogRoute(() => catalog.models) },
      "/api/model/default": { GET: catalogRoute(() => catalog.models[0] ?? null) },
      "/api/agent": { GET: catalogRoute(() => catalog.agents) },
      "/api/command": { GET: catalogRoute(() => catalog.commands) },
      "/api/plugin": { GET: catalogRoute(() => catalog.plugins) },
      "/api/session": {
        GET: route((_req, query) => {
          const sessions = [...fake.sessions.values()]
            .filter((session) => !query.directory || session.location.directory === query.directory)
            .toSorted((a, b) => b.time.updated - a.time.updated)
          return Response.json(page(sessions, query, 100))
        }),
        POST: body(CreateBody, (_req, input) =>
          Response.json({
            data: createSession({
              ...makeSession("", { cwd: input.location.directory }),
              ...(input.permissions ? { permissions: [...input.permissions] } : {}),
              ...(input.metadata ? { metadata: input.metadata } : {}),
            }),
          }),
        ),
      },
      "/api/session/active": {
        GET: route(() => Response.json({ data: Object.fromEntries([...fake.active].map((id) => [id, { type: "running" }])) })),
      },
      "/api/session/:sessionID": {
        GET: route((req) => {
          const session = fake.sessions.get(req.params.sessionID)
          return session ? Response.json({ data: session }) : notFound(req.params.sessionID)
        }),
        PATCH: body(UpdateBody, (req, input) => {
          const session = fake.sessions.get(req.params.sessionID)
          if (!session) return notFound(req.params.sessionID)
          fake.sessions.set(session.id, {
            ...session,
            ...(input.permissions ? { permissions: input.permissions } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {}),
          })
          return noContent()
        }),
        DELETE: route((req) =>
          fake.sessions.delete(req.params.sessionID) ? noContent() : notFound(req.params.sessionID),
        ),
      },
      "/api/session/:sessionID/fork": {
        POST: route((req) => {
          const source = fake.sessions.get(req.params.sessionID)
          if (!source) return notFound(req.params.sessionID)
          const forked = createSession(source)
          fake.messages.set(forked.id, [...(fake.messages.get(source.id) ?? [])])
          return Response.json({ data: forked })
        }),
      },
      "/api/session/:sessionID/model": {
        POST: body(ModelBody, (req, input) => {
          fake.selections.push({ sessionID: req.params.sessionID, model: input.model })
          return noContent()
        }),
      },
      "/api/session/:sessionID/agent": {
        POST: body(AgentBody, (req, input) => {
          fake.selections.push({ sessionID: req.params.sessionID, agent: input.agent })
          return noContent()
        }),
      },
      "/api/session/:sessionID/message": {
        GET: route((req, query) => Response.json(page(fake.messages.get(req.params.sessionID) ?? [], query, 200))),
      },
      "/api/session/:sessionID/prompt": {
        POST: body(PromptBody, async (req, input) => {
          const sessionID = req.params.sessionID
          fake.submissions.push({ kind: "prompt", sessionID, ...input })
          const hook = options.onPrompt ?? (() => turn(sessionID, input.id))
          await emit(hook({ sessionID, id: input.id, text: input.text, signal: req.signal }))
          return enqueued(sessionID, input.id, "user", { text: input.text })
        }),
      },
      "/api/session/:sessionID/command": {
        POST: body(CommandBody, (req, input) => {
          fake.submissions.push({ kind: "command", sessionID: req.params.sessionID, ...input })
          return noContent()
        }),
      },
      "/api/session/:sessionID/compact": {
        POST: body(CompactBody, (req, input) => {
          fake.submissions.push({ kind: "compact", sessionID: req.params.sessionID, ...input })
          fake.send(...turn(req.params.sessionID, input.id))
          return enqueued(req.params.sessionID, input.id, "compaction", {})
        }),
      },
      "/api/session/:sessionID/synthetic": {
        POST: body(SyntheticBody, (req, input) => {
          fake.submissions.push({ kind: "synthetic", sessionID: req.params.sessionID, ...input })
          return enqueued(req.params.sessionID, "msg_synthetic", "synthetic", { text: input.text })
        }),
      },
      "/api/session/:sessionID/interrupt": {
        POST: route(async (req) => {
          const sessionID = req.params.sessionID
          fake.interrupts.push(sessionID)
          if (!fake.sessions.has(sessionID)) return notFound(sessionID)
          return Response.json({ interrupted: (await emit(options.onInterrupt?.({ sessionID }))) > 0 })
        }),
      },
      "/api/session/:sessionID/permission/:requestID/reply": {
        POST: body(ReplyBody, (req, input) => {
          fake.replies.push({
            sessionID: req.params.sessionID,
            requestID: req.params.requestID,
            decision: input.decision,
          })
          return noContent()
        }),
      },
      "/api/session/:sessionID/form/:formID": {
        DELETE: route(async (req, query) => {
          const form = { sessionID: req.params.sessionID, formID: req.params.formID, message: query.message }
          fake.cancelledForms.push(form)
          await emit(options.onFormCancel?.(form))
          return noContent()
        }),
      },
      "/api/session/:sessionID/form/:formID/reply": {
        POST: body(FormReplyBody, async (req, input) => {
          const reply = { sessionID: req.params.sessionID, formID: req.params.formID, answer: input.answer }
          fake.repliedForms.push(reply)
          await emit(options.onFormReply?.(reply))
          return noContent()
        }),
      },
      "/api/experimental/mcp/:name": {
        PUT: body(McpBody, (req, input, query) => {
          fake.mcp.push({ name: req.params.name, directory: query["location[directory]"], config: input.config })
          return noContent()
        }),
      },
    },
  })

  return Object.assign(fake, {
    url: http.url.toString(),
    /** Ends every open event stream while the server keeps answering requests. */
    closeEvents() {
      streams.forEach((stream) => stream.close())
      streams.clear()
    },
    /** Drops the connection of every open event stream while the server keeps answering requests. */
    dropEvents() {
      streams.forEach((stream) => stream.error())
      streams.clear()
    },
    async stop() {
      streams.forEach((stream) => stream.close())
      streams.clear()
      await http.stop(true)
    },
  })
}
