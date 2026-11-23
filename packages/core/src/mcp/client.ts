export * as McpClient from "./client.js"

import { pathToFileURL } from "node:url"
import {
  type AuthProvider,
  Client,
  InsufficientScopeError,
  OAuthError,
  OAuthErrorCode,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  UnsupportedProtocolVersionError,
  type CallToolRequestOptions,
  type CallToolResult as SdkCallToolResult,
  type ElicitRequestFormParams,
  type ElicitRequestParams,
  type ElicitRequestURLParams,
  type ElicitResult,
  type GetPromptResult,
  type Implementation,
  type Prompt,
  type ReadResourceResult,
  type Resource,
  type ResourceTemplateType,
  type Transport,
  type VersionNegotiationOptions,
} from "@modelcontextprotocol/client"
import {
  Cause,
  Clock,
  Duration,
  Effect,
  Exit,
  Option,
  PlatformError,
  Queue,
  Schedule,
  Schema,
  Semaphore,
  Stream,
} from "effect"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import type { Session } from "@opencode/schema/session"
import { isRecord } from "@opencode/util/record"
import { codecFor } from "../tool/runtime.js"
import { McpStdio } from "./stdio.js"
import { EventStreamRejectedError, EventStreamTerminatedError, reopen } from "./event-stream.js"

export { EventStreamRejectedError, EventStreamTerminatedError }

const DEFAULT_STARTUP_TIMEOUT = 30_000
const DEFAULT_CATALOG_TIMEOUT = 30_000
const DEFAULT_EXECUTION_TIMEOUT = 12 * 60 * 60 * 1_000 // 12 hours
const ATTACHED_EXECUTION_TIMEOUT = 10 * 60 * 1_000 // 10 minutes
const TERMINATE_TIMEOUT = 1_000
const PROBE_TIMEOUT = 5_000
// SEP-2243 HeaderMismatch; the SDK does not export the constant.
const HEADER_MISMATCH = -32020
const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

// HTTP statuses and network error codes live on error properties and are lost once flattened to a message.
const describe = (error: unknown) => {
  if (!(error instanceof Error)) return String(error)
  const detail =
    error instanceof SdkHttpError
      ? `HTTP ${error.status}`
      : !(error instanceof SdkError) && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined
  return detail && !error.message.includes(detail) ? `${error.message} (${detail})` : error.message
}

// Overloaded or restarting servers and dropped connections usually recover within a second.
// Fetch reports network failures as a TypeError carrying a system error code.
// 501 means the server will never support the request.
const isTransient = (error: unknown) =>
  error instanceof SdkHttpError
    ? error.status === 408 || error.status === 429 || (error.status >= 500 && error.status !== 501)
    : error instanceof TypeError && "code" in error

// MCP Events (SEP-3415), a beta extension on 2026-07-28. Every `notifications/events/*` names its stream by the
// JSON-RPC id of the `events/stream` request that opened it.
const EVENTS = "io.modelcontextprotocol/events"
const SUBSCRIPTION_ID = "io.modelcontextprotocol/subscriptionId"
// A stream is dead once three heartbeat intervals pass without a message: the server's grant, or the spec's
// recommended 30 seconds before the first grant arrives.
const MISSED_HEARTBEATS = 3
const UNGRANTED_SILENCE = Duration.seconds(30 * MISSED_HEARTBEATS)
const EVENT_LIST_PAGES = 100
// A watch that was down for long resumes with at most this much backlog, not everything since its cursor.
const REPLAY_LIMIT_MS = 60 * 60 * 1_000

/** Experimental: MCP Events is a beta extension; may change without compatibility guarantees. */
export const EventType = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  /** Any of "poll", "push" and "webhook"; modes added later pass through. */
  delivery: Schema.NonEmptyArray(Schema.String),
  inputSchema: Schema.Record(Schema.String, Schema.Unknown),
  payloadSchema: Schema.Record(Schema.String, Schema.Unknown),
})
export type EventType = typeof EventType.Type
const EventError = Schema.Struct({
  code: Schema.Int,
  message: Schema.String,
  data: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
})
export type EventError = typeof EventError.Type
// An absent cursor means null: the event type has no replay.
const Cursor = Schema.optional(Schema.NullOr(Schema.String))
const Subscribed = { _meta: Schema.Struct({ [SUBSCRIPTION_ID]: Schema.Union([Schema.String, Schema.Int]) }) }
// Each event type is decoded on its own, so one malformed type doesn't hide the rest.
const EventList = Schema.toStandardSchemaV1(
  Schema.Struct({ events: Schema.Array(Schema.Unknown), nextCursor: Schema.optional(Schema.String) }),
)
const decodeEventType = Schema.decodeUnknownOption(EventType)
const ISO_8601 =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-](0\d|1[0-4]):[0-5]\d)$/
const AnyValue = Schema.toStandardSchemaV1(Schema.Unknown)
const ActiveNotification = Schema.toStandardSchemaV1(
  Schema.Struct({
    cursor: Cursor,
    truncated: Schema.optional(Schema.Boolean),
    heartbeatMs: Schema.Int.check(Schema.isGreaterThan(0)),
    ...Subscribed,
  }),
)
const EventNotification = Schema.toStandardSchemaV1(
  Schema.Struct({
    eventId: Schema.String,
    name: Schema.String,
    timestamp: Schema.String.check(Schema.isPattern(ISO_8601)),
    data: Schema.Record(Schema.String, Schema.Json),
    cursor: Cursor,
    ...Subscribed,
  }),
)
const HeartbeatNotification = Schema.toStandardSchemaV1(Schema.Struct({ cursor: Cursor, ...Subscribed }))
const ErrorNotification = Schema.toStandardSchemaV1(Schema.Struct({ error: EventError, ...Subscribed }))

/**
 * One message on an event stream. Persist the latest non-null `cursor` to resume from it.
 * Experimental: MCP Events is a beta extension; may change without compatibility guarantees.
 */
export type EventMessage =
  /** The stream is live. Sent first, and again with `truncated` when the server skipped events it could not replay. */
  | { readonly type: "active"; readonly cursor: string | null; readonly truncated: boolean }
  | {
      readonly type: "event"
      readonly eventId: string
      readonly name: string
      readonly timestamp: string
      readonly data: { readonly [key: string]: Schema.Json }
      readonly cursor: string | null
    }
  /** Nothing matched; the server has checked up to `cursor`. */
  | { readonly type: "heartbeat"; readonly cursor: string | null }
  /** A recoverable failure, such as one failed upstream fetch; the stream stays open. */
  | { readonly type: "error"; readonly error: EventError }

// JSON-RPC errors that mean an `events/stream` request can never succeed as sent: unknown method, bad arguments, and
// the events extension's NotFound, Forbidden and Unsupported.
const EVENT_STREAM_REJECTED = new Set([-32601, -32602, -32023, -32024, -32026])

export type { GetPromptResult, Prompt, ReadResourceResult, Resource }
export type ResourceTemplate = ResourceTemplateType

/** A listed tool, keeping the server's fields except `icons`, each only when it has the right type. */
export interface Tool {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly inputSchema: {
    readonly type: "object"
    readonly properties?: Record<string, unknown>
    readonly required?: string[]
    readonly [key: string]: unknown
  }
  readonly outputSchema?: Record<string, unknown>
  readonly annotations?: Record<string, unknown>
  readonly execution?: Record<string, unknown>
  readonly _meta?: Record<string, unknown>
}

export class NeedsAuthError extends Schema.TaggedError<NeedsAuthError>()("MCP.NeedsAuthError", {
  server: Schema.String,
  message: Schema.String,
}) {}

export class ConnectError extends Schema.TaggedError<ConnectError>()("MCP.ConnectError", {
  server: Schema.String,
  message: Schema.String,
  /** The server was reached but refused or broke the handshake, so different connect options might succeed. */
  answered: Schema.optional(Schema.Boolean),
}) {}

/** A legacy Streamable HTTP server no longer recognizes this connection's session; the lifecycle reconnects. */
export class SessionExpiredError extends Schema.TaggedError<SessionExpiredError>()("MCP.SessionExpiredError", {
  server: Schema.String,
}) {
  override get message() {
    return `MCP server session expired: ${this.server}`
  }
}

export type CallToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "media"; readonly data: string; readonly mimeType: string; readonly uri?: string }

export interface CallToolResult {
  readonly isError: boolean
  readonly structured?: unknown
  readonly content: ReadonlyArray<CallToolContent>
}

export type ElicitationFormParams = ElicitRequestFormParams
export type ElicitationParams = ElicitRequestParams
export type ElicitationResult = ElicitResult

export interface ElicitationHandler {
  readonly create: (input: {
    readonly server: string
    readonly params: ElicitationParams
    readonly signal: AbortSignal
  }) => Effect.Effect<ElicitationResult, Error>
  /**
   * Legacy era only: the server announces that a URL-mode elicitation finished out of band. Removed in
   * 2026-07-28, where the client learns the outcome by retrying, but legacy servers still send it and
   * it lets the form settle without the user re-running the tool.
   */
  readonly complete: (input: {
    readonly server: string
    readonly elicitationID: ElicitRequestURLParams["elicitationId"]
  }) => Effect.Effect<void>
}

/** For a request that can come back asking for input: tool calls, prompts and resource reads. */
export interface PerRequest {
  /**
   * Answers the elicitations this request causes instead of the connection's handler, for a connection
   * that serves several callers. 2026-07-28 only.
   */
  readonly elicitation?: ElicitationHandler["create"]
}

/** Handle over a connected MCP server that keeps the SDK `Client` out of the rest of core. */
export interface Connection {
  /** True when the connection negotiated revision 2026-07-28 or later; false is the initialize handshake. */
  readonly modern: boolean
  /** The protocol revision the connection negotiated, such as "2025-11-25". */
  readonly protocolVersion: string | undefined
  /** Display title from `serverInfo.title`, when the server provides one. */
  readonly title: string | undefined
  readonly instructions: string | undefined
  readonly tools: () => Effect.Effect<Tool[], Error>
  readonly prompts: () => Effect.Effect<Prompt[], Error>
  readonly resources: () => Effect.Effect<Resource[], Error>
  readonly resourceTemplates: () => Effect.Effect<ResourceTemplateType[], Error>
  /** Resolves to undefined when the server does not advertise resources. */
  readonly readResource: (
    input: { readonly uri: string } & PerRequest,
  ) => Effect.Effect<ReadResourceResult | undefined, Error>
  readonly prompt: (
    input: {
      readonly name: string
      readonly args?: Record<string, string>
    } & PerRequest,
  ) => Effect.Effect<GetPromptResult, Error>
  readonly callTool: (
    input: {
      readonly name: string
      readonly args?: Record<string, unknown>
      readonly sessionID?: Session.ID
    } & PerRequest,
  ) => Effect.Effect<CallToolResult, Error>
  /** MCP Events, when the connection declared them and negotiated 2026-07-28 with a server that offers them. Experimental; see `Events`. */
  readonly events: Events | undefined
  readonly onClose: (callback: (reason: string) => void) => void
  readonly onSessionExpired: (callback: () => void) => void
  readonly onToolsChanged: (callback: () => void) => void
  readonly onPromptsChanged: (callback: () => void) => void
  readonly onResourcesChanged: (callback: () => void) => void
}

/** Experimental: MCP Events is a beta extension; may change without compatibility guarantees. */
export interface Events {
  /** Every event type the server offers (`events/list`), leaving out those whose schemas can't be used. */
  readonly list: () => Effect.Effect<ReadonlyArray<EventType>, Error>
  /**
   * Fails with EventStreamRejectedError when an event type is unknown, offers no push delivery, or doesn't accept
   * these arguments. `stream` runs the same check before opening.
   */
  readonly check: (input: {
    readonly name: string
    readonly arguments?: Record<string, unknown>
  }) => Effect.Effect<void, Error>
  /**
   * Push delivery (`events/stream`) from `cursor`, or from now. Ends when the server closes the stream. Fails with
   * EventStreamRejectedError when the server refuses the subscription, EventStreamTerminatedError when it ends it,
   * and with another error when the stream breaks or misses three heartbeats, after which it can be opened again
   * from the last cursor. Interrupting it cancels it. Events whose name or data don't match the event type are dropped.
   */
  readonly stream: (input: {
    readonly name: string
    readonly arguments?: Record<string, unknown>
    readonly cursor?: string | null
    /** Replays nothing older than this, even from an older cursor. Defaults to an hour when resuming from a cursor. */
    readonly maxAgeMs?: number
  }) => Stream.Stream<EventMessage, Error>
}

/** An MCP server reached over a transport someone else already opened, such as a client socket. */
export interface Attached {
  readonly type: "attached"
  readonly transport: Transport
  /** Defaults to "legacy": attached clients run ordinary SDK servers over the initialize handshake. */
  readonly protocol?: ConfigMCP.Protocol
}

export interface ConnectOptions {
  readonly server: string
  readonly config: typeof ConfigMCP.Server.Type | Attached
  /** Resolves a relative stdio `cwd` and is the default one, and is the root `roots/list` answers with. */
  readonly directory: string
  /** Remote only. A 401 the provider cannot recover from ends in UnauthorizedError → needs_auth. */
  readonly authProvider?: AuthProvider
  readonly elicitation?: ElicitationHandler
  readonly clientInfo?: Implementation
  /** False declares no roots and leaves `roots/list` unanswered, for a connection no one directory owns. */
  readonly roots?: boolean
  /** Experimental: declares MCP Events, a beta extension, and exposes `Connection.events` for a 2026-07-28 server that offers them. */
  readonly events?: boolean
}

/**
 * Connects an MCP server; closing the calling scope tears down the transport and any spawned process.
 * A stdio server is spawned through the location's `Environment`, so it runs wherever the location's
 * shell commands run rather than always on the host.
 */
export const connect = Effect.fnUntraced(function* (options: ConnectOptions) {
  const server = options.server
  const config = options.config
  const elicitation = options.elicitation
  // The SDK takes list-changed handlers at construction, but consumers register after connect. On a
  // modern connection the SDK opens the subscriptions/listen stream behind these itself.
  const timeout: (typeof ConfigMCP.Server.Type)["timeout"] =
    config.type === "attached" ? { execution: ATTACHED_EXECUTION_TIMEOUT } : config.timeout
  const protocol = config.protocol ?? (config.type === "attached" ? "legacy" : "auto")
  const changed = { tools: () => {}, prompts: () => {}, resources: () => {} }
  const listChanged = (key: keyof typeof changed) => ({
    autoRefresh: false,
    debounceMs: 0,
    onChanged: () => changed[key](),
  })

  // Requests that bring their own elicitation handler, keyed by the signal each passes to the SDK.
  const callers = new WeakMap<AbortSignal, ElicitationHandler["create"]>()
  const claim = (signal: AbortSignal, input: PerRequest) => {
    if (input.elicitation) callers.set(signal, input.elicitation)
    return signal
  }

  // Open event streams, by the JSON-RPC id of their `events/stream` request. Every message pulses `heard` for the
  // watchdog, which fails the stream once `silence` passes without one.
  type OpenStream = {
    queue: Queue.Queue<EventMessage, Error | Cause.Done>
    heard: Queue.Queue<void>
    silence: Duration.Duration
  }
  const streams = new Map<string, OpenStream>()

  // The SDK fails pending requests with a bare "Connection closed"; the transport error before it says why.
  let lastError: string | undefined
  const explain = (error: unknown) =>
    error instanceof SdkError && error.code === SdkErrorCode.ConnectionClosed && lastError
      ? `${describe(error)}: ${lastError}`
      : describe(error)

  // Two more attempts, 250 ms and 1 s later, while the failure is transient and the deadline has not passed.
  const retrying = <A, E>(what: string, effect: Effect.Effect<A, E>, deadline = Infinity) =>
    Effect.retry(
      effect,
      Schedule.max([Schedule.exponential("250 millis", 4), Schedule.recurs(2)]).pipe(
        Schedule.setInputType<E>(),
        Schedule.while(({ input, now, duration }) =>
          !isTransient(input) || now + Duration.toMillis(duration) >= deadline
            ? Effect.succeed(false)
            : Effect.logWarning(`retrying ${what}`, { server, error: describe(input) }).pipe(Effect.as(true)),
        ),
      ),
    )

  const initialize = Effect.fnUntraced(function* (
    transport: Transport,
    protocol: ConfigMCP.Protocol,
    startup = timeout?.startup ?? DEFAULT_STARTUP_TIMEOUT,
  ) {
    // SDK callbacks run outside any fiber. They must run with this context so events they publish keep
    // the server's Location; clients drop unlocated `form.created` events and elicitations then hang.
    const context = yield* Effect.context()
    const runFork = Effect.runForkWith(context)
    const runPromise = Effect.runPromiseWith(context)
    const client = new Client(options.clientInfo ?? { name: "opencode", version: "unknown" }, {
      capabilities: {
        ...(elicitation ? { elicitation: { form: {}, url: {} } } : {}),
        // Legacy era only: roots are deprecated as of 2026-07-28 and modern servers cannot request them.
        // Some legacy servers refuse to run without one (https://github.com/anomalyco/opencode/issues/2308).
        ...(options.roots === false ? {} : { roots: {} }),
        ...(options.events ? { extensions: { [EVENTS]: {} } } : {}),
      },
      versionNegotiation: negotiation(protocol, timeout?.startup ?? DEFAULT_STARTUP_TIMEOUT),
      listChanged: {
        tools: listChanged("tools"),
        prompts: listChanged("prompts"),
        resources: listChanged("resources"),
      },
    })
    // Background work such as the standalone SSE stream reports failures only here; aborts come from close.
    client.onerror = (error) => {
      if (error.name === "AbortError") return
      lastError = describe(error)
      runFork(Effect.logWarning("mcp transport error", { server, error: lastError }))
    }
    if (options.roots !== false)
      client.setRequestHandler("roots/list", () => ({ roots: [{ uri: pathToFileURL(options.directory).href }] }))
    if (options.events) {
      const deliver = (
        params: { readonly _meta: { readonly [SUBSCRIPTION_ID]: string | number } },
        message: EventMessage,
      ) => {
        const open = streams.get(String(params._meta[SUBSCRIPTION_ID]))
        if (!open) return
        Queue.offerUnsafe(open.heard, undefined)
        Queue.offerUnsafe(open.queue, message)
      }
      client.setNotificationHandler("notifications/events/active", { params: ActiveNotification }, (params) => {
        // The server's grant is authoritative, and it comes with every `active`.
        const open = streams.get(String(params._meta[SUBSCRIPTION_ID]))
        if (open) open.silence = Duration.millis(params.heartbeatMs * MISSED_HEARTBEATS)
        deliver(params, { type: "active", cursor: params.cursor ?? null, truncated: params.truncated === true })
      })
      client.setNotificationHandler("notifications/events/event", { params: EventNotification }, (params) =>
        deliver(params, {
          type: "event",
          eventId: params.eventId,
          name: params.name,
          timestamp: params.timestamp,
          data: params.data,
          cursor: params.cursor ?? null,
        }),
      )
      client.setNotificationHandler("notifications/events/heartbeat", { params: HeartbeatNotification }, (params) =>
        deliver(params, { type: "heartbeat", cursor: params.cursor ?? null }),
      )
      client.setNotificationHandler("notifications/events/error", { params: ErrorNotification }, (params) =>
        deliver(params, { type: "error", error: params.error }),
      )
      client.setNotificationHandler("notifications/events/terminated", { params: ErrorNotification }, (params) => {
        const open = streams.get(String(params._meta[SUBSCRIPTION_ID]))
        if (open)
          Queue.failCauseUnsafe(open.queue, Cause.fail(new EventStreamTerminatedError({ server, ...params.error })))
      })
    }
    if (elicitation) {
      // A 2026-07-28 server asks for input in the result of the request that needs it. Our SDK patch puts
      // that request's options on the context (`mcpReq.origin`, see patches/@modelcontextprotocol%2Fclient),
      // so its signal finds the handler it brought. Anything else goes to the connection's handler.
      client.setRequestHandler("elicitation/create", (request, ctx) => {
        const origin = (ctx.mcpReq as { readonly origin?: { readonly options?: { readonly signal?: AbortSignal } } })
          .origin?.options?.signal
        const create = (origin && callers.get(origin)) ?? elicitation.create
        return runPromise(create({ server, params: request.params, signal: ctx.mcpReq.signal }))
      })
      client.setNotificationHandler("notifications/elicitation/complete", (notification) =>
        runPromise(elicitation.complete({ server, elicitationID: notification.params.elicitationId })),
      )
    }

    yield* Effect.tryPromise({
      try: (signal) => client.connect(transport, { timeout: startup, signal }),
      catch: (error) => error,
    }).pipe(Effect.onError(() => Effect.promise(() => transport.close()).pipe(Effect.ignore)))
    return client
  })

  // Legacy era only: the transport holds the Mcp-Session-Id the server minted, and the server answering
  // it with 404, or with the 400 a freshly restarted single-session server emits, means it no longer
  // knows this connection. Modern connections never carry a session id, so a modern 404 for an unknown
  // method is not mistaken for expiry. Other 400s pass through untouched.
  const session: { transport?: StreamableHTTPClientTransport; expired?: () => void; reported: boolean } = {
    reported: false,
  }
  const failure = (error: unknown) => {
    // A tool call that relists first can fail with the list's already mapped expiry.
    if (error instanceof SessionExpiredError) return error
    if (!(error instanceof SdkHttpError) || session.transport?.sessionId === undefined) return new Error(explain(error))
    const expired =
      error.status === 404 ||
      (error.status === 400 &&
        typeof error.data.text === "string" &&
        error.data.text.includes("Bad Request: Server not initialized"))
    if (!expired) return new Error(explain(error))
    if (!session.reported) {
      session.reported = true
      session.expired?.()
    }
    return new SessionExpiredError({ server })
  }

  const exit = yield* Effect.gen(function* () {
    if (config.type === "attached") return yield* initialize(config.transport, protocol)
    if (config.type === "local") {
      const [command, ...args] = config.command
      const spawn = (protocol: ConfigMCP.Protocol) =>
        McpStdio.make({
          server,
          command,
          args,
          cwd: McpStdio.resolveCwd(options.directory, config.cwd),
          environment: {
            ...(command === "opencode" ? { BUN_BE_BUN: "1" } : {}),
            ...config.environment,
          },
        }).pipe(Effect.flatMap((transport) => initialize(transport, protocol)))
      // Some legacy servers exit on the auto probe's unknown request (Python SDK 1.3 does), so respawn for initialize.
      // A shared connection (no roots) can't be legacy, so the pool opens its own private one instead.
      return yield* spawn(protocol).pipe(
        Effect.catchIf(
          (error) =>
            protocol === "auto" &&
            options.roots !== false &&
            error instanceof SdkError &&
            (error.code === SdkErrorCode.ConnectionClosed || error.code === SdkErrorCode.EraNegotiationFailed),
          () => spawn("legacy"),
        ),
      )
    }
    const { McpOAuth } = yield* Effect.promise(() => import("./oauth.js"))
    const fetch = yield* McpOAuth.loggedFetch({ server, directory: options.directory })
    const { McpTls } = yield* Effect.promise(() => import("./tls.js"))
    // Servers that bundle their own Code Mode (Cloudflare and others) expose raw tools when asked
    // with ?codemode=false, which is what our Code Mode wants. The configured URL stays the OAuth identity.
    const url = new URL(config.url)
    const addedCodemode = config.codemode !== false && !url.searchParams.has("codemode") && !rejectsUnknownQuery(url)
    if (addedCodemode) url.searchParams.set("codemode", "false")
    // A missing CA file or a fingerprint mismatch fails the connect instead of the first request.
    const tls = config.tls
    const resolved = tls
      ? yield* Effect.tryPromise({ try: () => McpTls.resolveTls(tls, options.directory, url), catch: toError })
      : undefined
    const open = Effect.fnUntraced(function* (url: URL, protocol: ConfigMCP.Protocol, startup?: number) {
      session.transport = new StreamableHTTPClientTransport(url, {
        requestInit: config.headers ? { headers: config.headers } : undefined,
        authProvider: options.authProvider,
        fetch: resolved ? McpTls.withTls(resolved, fetch) : fetch,
      })
      return yield* initialize(session.transport, protocol, startup)
    })
    // Every attempt opens a fresh transport; no retry starts once the startup timeout has passed.
    const deadline = (yield* Clock.currentTimeMillis) + (timeout?.startup ?? DEFAULT_STARTUP_TIMEOUT)
    // Over HTTP the SDK treats an unanswered auto probe as an outage, but slow legacy servers may still initialize
    // within what is left of the startup timeout.
    const negotiate = (url: URL) =>
      open(url, protocol).pipe(
        Effect.catchIf(
          (error) => protocol === "auto" && error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout,
          (error) =>
            Clock.currentTimeMillis.pipe(
              Effect.flatMap((now) => (now < deadline ? open(url, "legacy", deadline - now) : Effect.fail(error))),
            ),
        ),
      )

    return yield* retrying(
      "MCP connect",
      negotiate(url).pipe(
        Effect.catch((error) => {
          if (!addedCodemode || !(error instanceof SdkHttpError) || (error.status !== 400 && error.status !== 404))
            return Effect.fail(error)
          // Servers that reject unknown query params get one retry at the configured URL.
          return negotiate(new URL(config.url))
        }),
      ),
      deadline,
    )
  }).pipe(Effect.exit)
  if (Exit.isSuccess(exit)) {
    const client = exit.value
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        // Close only aborts streams; the legacy session lives on until the server expires it unless
        // terminated explicitly. Terminate first: close aborts the signal the DELETE shares.
        const transport = session.transport
        // Termination failures are logged below; onerror would report them a second time.
        client.onerror = undefined
        if (transport?.sessionId !== undefined && !session.reported)
          yield* Effect.tryPromise({ try: () => transport.terminateSession(), catch: toError }).pipe(
            Effect.timeoutOrElse({
              duration: TERMINATE_TIMEOUT,
              orElse: () => Effect.fail(new Error(`Timed out after ${TERMINATE_TIMEOUT}ms`)),
            }),
            Effect.tapError((error) =>
              Effect.logWarning("failed to terminate MCP session", { server, error: error.message }),
            ),
            Effect.ignore,
          )
        yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
      }),
    )
    const catalog = { timeout: timeout?.catalog ?? DEFAULT_CATALOG_TIMEOUT }
    const listed = new Map<string, Tool>()
    const execution = timeout?.execution ?? DEFAULT_EXECUTION_TIMEOUT
    const request = <A>(what: string, run: (signal: AbortSignal) => Promise<A>) =>
      Effect.tryPromise({ try: run, catch: failure }).pipe(
        Effect.tapError((error) => Effect.logWarning(`failed to ${what}`, { server, error: error.message })),
      )
    // Listing is read-only, so a transient failure is safe to retry.
    const list = <A>(what: string, run: (signal: AbortSignal) => Promise<A>) =>
      retrying(what, Effect.tryPromise({ try: run, catch: (error) => error })).pipe(
        Effect.mapError(failure),
        Effect.tapError((error) => Effect.logWarning(`failed to ${what}`, { server, error: error.message })),
      )
    // The SDK answers a list for an unadvertised capability with a console.debug line plus an empty
    // result, so refreshing a tools-only server prints to stdout on every catalog load. Negotiate
    // first and leave the request unmade; the result is the same empty list without the noise.
    const advertised = (capability: "tools" | "prompts" | "resources") =>
      Boolean(client.getServerCapabilities()?.[capability])
    // Each listed event type with its `x-mcp-header` annotations, mirrored as `Mcp-Param-*` headers on its stream,
    // and checks for its arguments and data. One refresh runs at a time and swaps in a complete map, so a stream never
    // reads a half-built one.
    type Known = {
      readonly type: EventType
      readonly headers: ReadonlyArray<HeaderParam>
      readonly arguments: (value: unknown) => boolean
      readonly data: (value: unknown) => boolean
    }
    let eventTypes = new Map<string, Known>()
    const refresh = yield* Semaphore.make(1)
    const listEvents = Effect.fnUntraced(function* () {
      const events: unknown[] = []
      let cursor: string | undefined
      for (let page = 0; page < EVENT_LIST_PAGES; page++) {
        const result = yield* list("list MCP events", (signal) =>
          client.request({ method: "events/list", params: cursor === undefined ? {} : { cursor } }, EventList, {
            ...catalog,
            signal,
          }),
        )
        events.push(...result.events)
        cursor = result.nextCursor
        if (cursor === undefined) break
      }
      if (cursor !== undefined)
        yield* Effect.logWarning("MCP event list has more pages than read", { server, pages: EVENT_LIST_PAGES })
      const known = new Map<string, Known>()
      for (const raw of events) {
        const decoded = decodeEventType(raw)
        if (Option.isNone(decoded)) {
          yield* Effect.logWarning("skipping malformed MCP event type", {
            server,
            event: isRecord(raw) ? raw.name : undefined,
          })
          continue
        }
        const event = decoded.value
        const params = headerParams(event.inputSchema)
        if (typeof params === "string") {
          yield* Effect.logWarning("skipping MCP event type with an invalid x-mcp-header", {
            server,
            event: event.name,
            reason: params,
          })
          continue
        }
        const args = matcher(event.inputSchema)
        const data = matcher(event.payloadSchema)
        if (!args || !data) {
          yield* Effect.logWarning("skipping MCP event type with a schema that can't be checked", {
            server,
            event: event.name,
          })
          continue
        }
        known.set(event.name, { type: event, headers: params, arguments: args, data })
      }
      eventTypes = known
      return Array.from(known.values(), (entry) => entry.type)
    }, refresh.withPermit)
    const checkEvent: Events["check"] = Effect.fnUntraced(function* (input) {
      if (!eventTypes.has(input.name)) yield* listEvents()
      const known = eventTypes.get(input.name)
      const reject = (code: number, message: string) => new EventStreamRejectedError({ server, code, message })
      if (!known?.type.delivery.includes("push"))
        return yield* reject(-32023, `No push event type ${input.name} on MCP server ${server}`)
      if (!known.arguments(input.arguments ?? {}))
        return yield* reject(-32602, `Arguments for ${input.name} do not match its inputSchema`)
    })

    // Annotated rather than `satisfies`: the inferred SDK types are cyclic, so declaration emit needs the named type.
    const connection: Connection = {
      modern: client.getProtocolEra() === "modern",
      protocolVersion: client.getNegotiatedProtocolVersion(),
      title: client.getServerVersion()?.title?.trim() || undefined,
      instructions: client.getInstructions()?.trim() || undefined,
      // Events are defined for 2026-07-28 only.
      events:
        options.events && client.getProtocolEra() === "modern" && client.getServerCapabilities()?.extensions?.[EVENTS]
          ? {
              list: listEvents,
              check: checkEvent,
              stream: (input) =>
                Stream.callback<EventMessage, Error>((queue) =>
                  Effect.gen(function* () {
                    const stream: OpenStream = {
                      queue,
                      heard: yield* Queue.sliding<void>(1),
                      silence: UNGRANTED_SILENCE,
                    }
                    yield* Effect.addFinalizer(() =>
                      Effect.sync(() => {
                        for (const [id, open] of streams) if (open === stream) streams.delete(id)
                      }),
                    )
                    // Heartbeats, not a request timeout, tell a quiet stream from a dead one. Each message restarts
                    // the deadline, using the grant it may have just changed.
                    yield* Effect.suspend(() => Queue.take(stream.heard).pipe(Effect.timeout(stream.silence))).pipe(
                      Effect.forever,
                      Effect.catch(() =>
                        Queue.fail(queue, new Error(`MCP server ${server} stopped sending event stream heartbeats`)),
                      ),
                      Effect.forkScoped,
                    )
                    const params =
                      typeof input.cursor === "string" && input.maxAgeMs === undefined
                        ? { ...input, maxAgeMs: REPLAY_LIMIT_MS }
                        : input
                    // Interrupting the request cancels the stream; the server closing it resolves the request.
                    const request = Effect.tryPromise({
                      try: (signal) =>
                        client.request({ method: "events/stream", params }, AnyValue, {
                          signal,
                          headers: paramHeaders(eventTypes.get(input.name)?.headers ?? [], input.arguments),
                          timeout: Infinity,
                          // Routes the stream's notifications, which can arrive before the request settles.
                          onRequestId: (id) => streams.set(String(id), stream),
                        }),
                      catch: (error) => error,
                    })
                    // A modern server rejects headers mirrored from a stale or unlisted event type before opening
                    // the stream, so relist and retry once with the fresh schema.
                    yield* checkEvent(input).pipe(
                      Effect.andThen(
                        request.pipe(
                          Effect.catchIf(
                            (error) => error instanceof ProtocolError && error.code === HEADER_MISMATCH,
                            () => listEvents().pipe(Effect.andThen(request)),
                          ),
                        ),
                      ),
                      Effect.mapError((error) =>
                        error instanceof EventStreamRejectedError
                          ? error
                          : error instanceof ProtocolError && EVENT_STREAM_REJECTED.has(error.code)
                            ? new EventStreamRejectedError({ server, code: error.code, message: error.message })
                            : failure(error),
                      ),
                      Effect.tapError((error) =>
                        Effect.logWarning("failed to stream MCP events", { server, error: error.message }),
                      ),
                      Effect.matchEffect({
                        onFailure: (error) => Queue.fail(queue, error),
                        onSuccess: () => Queue.end(queue),
                      }),
                      Effect.forkScoped,
                    )
                  }),
                ).pipe(
                  Stream.filterEffect((message) =>
                    message.type !== "event" ||
                    (message.name === input.name && eventTypes.get(input.name)?.data(message.data) === true)
                      ? Effect.succeed(true)
                      : Effect.logWarning("dropping an MCP event that doesn't match its event type", {
                          server,
                          event: input.name,
                          eventId: message.eventId,
                        }).pipe(Effect.as(false)),
                  ),
                ),
            }
          : undefined,
      // Tool lists skip the SDK response cache: it re-stringifies every list, and on the first tools/call
      // re-parses it and compiles an output validator for every listed tool. Each call passes its own
      // checked definition instead, so modern Mcp-Param-* header mirroring still sees the input schema.
      // Tools are relisted on connect, list_changed and a stale header declaration; the SDK cache never
      // relisted an expired list before a call either.
      tools: () =>
        advertised("tools")
          ? list("list MCP tools", (signal) =>
              client.listTools(undefined, { ...catalog, cacheMode: "bypass", signal }),
            ).pipe(
              // Our SDK patch leaves the listed tools unchecked, so one malformed tool doesn't fail the
              // whole list; each is checked here and copied, dropping fields of the wrong type.
              Effect.flatMap((result) => {
                const skipped: Array<{ tool: unknown; reason: string }> = []
                const tools = result.tools.flatMap((tool: unknown): Tool[] => {
                  const skip = (reason: string) => {
                    skipped.push({ tool: isRecord(tool) ? tool.name : undefined, reason })
                    return []
                  }
                  if (!isRecord(tool)) return skip("not an object")
                  if (typeof tool.name !== "string" || tool.name === "") return skip("name is not a non-empty string")
                  if (!isRecord(tool.inputSchema)) return skip("inputSchema is not an object")
                  if (tool.inputSchema.type !== undefined && tool.inputSchema.type !== "object")
                    return skip('inputSchema type is not "object"')
                  const { properties, required, ...inputSchema } = tool.inputSchema
                  return [
                    {
                      name: tool.name,
                      title: typeof tool.title === "string" ? tool.title : undefined,
                      description: typeof tool.description === "string" ? tool.description : undefined,
                      // Providers that check tool parameters against the JSON Schema metaschema reject the
                      // whole request over a malformed top level. Nested property schemas are left as sent.
                      inputSchema: {
                        ...inputSchema,
                        type: "object",
                        ...(isRecord(properties) ? { properties } : {}),
                        ...(Array.isArray(required) && required.every((key): key is string => typeof key === "string")
                          ? { required }
                          : {}),
                      },
                      outputSchema: isRecord(tool.outputSchema) ? tool.outputSchema : undefined,
                      annotations: isRecord(tool.annotations) ? tool.annotations : undefined,
                      execution: isRecord(tool.execution) ? tool.execution : undefined,
                      _meta: isRecord(tool._meta) ? tool._meta : undefined,
                    },
                  ]
                })
                listed.clear()
                for (const tool of tools) listed.set(tool.name, tool)
                return Effect.forEach(
                  skipped,
                  (entry) => Effect.logWarning("skipping invalid MCP tool", { server, ...entry }),
                  { discard: true },
                ).pipe(Effect.as(tools))
              }),
            )
          : Effect.succeed([]),
      prompts: () =>
        advertised("prompts")
          ? list("list MCP prompts", (signal) => client.listPrompts(undefined, { ...catalog, signal })).pipe(
              Effect.map((r) => r.prompts),
            )
          : Effect.succeed([]),
      resources: () =>
        advertised("resources")
          ? list("list MCP resources", (signal) => client.listResources(undefined, { ...catalog, signal })).pipe(
              Effect.map((r) => r.resources),
            )
          : Effect.succeed([]),
      resourceTemplates: () =>
        advertised("resources")
          ? list("list MCP resource templates", (signal) =>
              client.listResourceTemplates(undefined, { ...catalog, signal }),
            ).pipe(Effect.map((r) => r.resourceTemplates))
          : Effect.succeed([]),
      readResource: (input) => {
        if (!advertised("resources")) return Effect.succeed(undefined)
        return request("read MCP resource", (signal) =>
          client.readResource({ uri: input.uri }, { signal: claim(signal, input), timeout: execution }),
        )
      },
      prompt: (input) =>
        request("get MCP prompt", (signal) =>
          client.getPrompt(
            { name: input.name, arguments: input.args ?? {} },
            { signal: claim(signal, input), timeout: execution },
          ),
        ),
      callTool: (input) => {
        const call = Effect.tryPromise({
          try: (signal) =>
            client.callTool(
              {
                name: input.name,
                arguments: input.args ?? {},
                ...(input.sessionID === undefined ? {} : { _meta: { "ai.opencode/sessionID": input.sessionID } }),
              },
              {
                signal: claim(signal, input),
                timeout: execution,
                // Only asks for a progress token: progress on the response stream can keep proxies from closing it.
                // The SDK timeout does not reset on progress; execution is the hard wall.
                onprogress: () => {},
                // Always passed, even for a tool we haven't listed, so the SDK never falls back to listing
                // and caching the raw tools itself. Its types are narrower than what it reads (JSON values,
                // a string `$schema`); ours keep the server's values. Leaving out `outputSchema` skips the
                // SDK's output check: servers return results that miss or break their own schema (Zoom
                // answers a 204 with nothing), and failing the call would report a completed action as failed.
                toolDefinition: {
                  ...(listed.get(input.name) ?? { name: input.name, inputSchema: { type: "object" } }),
                  outputSchema: undefined,
                } as CallToolRequestOptions["toolDefinition"],
              },
            ),
          catch: (error) => error,
        })
        // A modern server rejects headers mirrored from a stale definition before running the tool,
        // so relist and retry once with the fresh definition.
        return call.pipe(
          Effect.catchIf(
            (error) => connection.modern && error instanceof ProtocolError && error.code === HEADER_MISMATCH,
            () => connection.tools().pipe(Effect.andThen(call)),
          ),
          Effect.mapError(failure),
          Effect.tapError((error) => Effect.logWarning("failed to call MCP tool", { server, error: error.message })),
          Effect.map(toCallToolResult),
        )
      },
      onClose: (callback) => {
        client.onclose = () => callback(lastError ? `Connection closed: ${lastError}` : "Connection closed")
      },
      onSessionExpired: (callback) => {
        session.expired = callback
      },
      onToolsChanged: (callback) => {
        changed.tools = callback
      },
      onPromptsChanged: (callback) => {
        changed.prompts = callback
      },
      onResourcesChanged: (callback) => {
        changed.resources = callback
      },
    }
    // A server whose event types change at runtime says so on a `subscriptions/listen` stream; relisting keeps each
    // type's mirrored headers current. Open streams keep running.
    const settings = client.getServerCapabilities()?.extensions?.[EVENTS]
    if (connection.events && isRecord(settings) && settings.listChanged === true) {
      // One scoped worker relists; changes that arrive while it runs collapse into one more relist.
      const changed = yield* Queue.sliding<void>(1)
      client.setNotificationHandler("notifications/events/list_changed", { params: AnyValue }, () => {
        Queue.offerUnsafe(changed, undefined)
      })
      yield* Queue.take(changed).pipe(Effect.andThen(listEvents()), Effect.ignore, Effect.forever, Effect.forkScoped)
      // The SDK's filter type predates Events; it sends the filter as given.
      const filter: Record<string, boolean> = { eventsListChanged: true }
      // Held for the connection's life: a listen the server ends or drops is reopened after a capped, jittered delay,
      // then relisted to catch changes missed while it was closed. A refusal is not retried. Closing never waits on
      // the server: opening aborts, and the cancellation is sent without waiting.
      yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: (signal) => client.listen(filter, { timeout: catalog.timeout, signal }),
          catch: (error) => error,
        }),
        (subscription) => Effect.sync(() => void subscription.close().catch(() => {})),
        // Opening waits for the server's ack; without this, closing the connection would wait for it too.
        { interruptible: true },
      ).pipe(
        Effect.tap(() => Queue.offer(changed, undefined)),
        Effect.flatMap((subscription) => Effect.promise(() => subscription.closed)),
        Effect.scoped,
        Effect.andThen(Effect.fail(new Error("the server closed the listen stream"))),
        Effect.tapError((error) =>
          Effect.logWarning("MCP event list change listener stopped", { server, error: describe(error) }),
        ),
        Effect.retry(
          reopen.pipe(
            Schedule.setInputType<unknown>(),
            Schedule.while(({ input }) => !(input instanceof ProtocolError)),
          ),
        ),
        Effect.ignore,
        Effect.forkScoped,
      )
    }
    return connection
  }

  const error = Cause.squash(exit.cause)
  if (error instanceof UnauthorizedError || error instanceof InsufficientScopeError)
    return yield* new NeedsAuthError({ server, message: error.message })
  if (error instanceof UnsupportedProtocolVersionError)
    return yield* new ConnectError({
      server,
      message: `${error.message}; the server supports ${error.supported.join(", ")}. Set "protocol" for this server to one of those or to "legacy".`,
    })
  return yield* new ConnectError({ server, message: explain(error), answered: !repeats(error) })
})

// Connecting again would fail the same way: the server could not be spawned or reached, did not answer in
// time, is overloaded or down for now, or refused this client's access. A failed auto probe wraps the error it hit.
function repeats(error: unknown): boolean {
  if (error instanceof SdkError && error.code === SdkErrorCode.EraNegotiationFailed && error.cause !== undefined)
    return repeats(error.cause)
  return (
    (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) ||
    // Refused credentials, even without OAuth: any connection with them would be refused the same way.
    (error instanceof SdkHttpError && (error.status === 401 || error.status === 403)) ||
    // The authorization server could not refresh the token for now; see McpOAuth.
    (error instanceof OAuthError && error.code === OAuthErrorCode.TemporarilyUnavailable) ||
    isTransient(error) ||
    PlatformError.isPlatformError(error)
  )
}

// These servers reject any unknown query parameter and have no Code Mode of their own, so adding
// ?codemode=false only costs a failed request before the retry at the configured URL.
function rejectsUnknownQuery(url: URL) {
  // Google Workspace MCP (gmailmcp, drivemcp, calendarmcp, ...) returns 404.
  if (url.hostname.endsWith(".googleapis.com")) return true
  // Zoho MCP gateways (zohomcp.com, zohomcp.eu, ...) return 400.
  if (/(^|\.)zohomcp\.[a-z.]+$/.test(url.hostname)) return true
  // Loopback servers run on this machine (Figma Desktop's Dev Mode MCP returns 404), so they are not hosted Code Mode servers.
  return url.hostname === "localhost" || url.hostname === "[::1]" || /^127(\.\d+){3}$/.test(url.hostname)
}

// Legacy sends the plain initialize handshake with no discover probe.
function negotiation(protocol: ConfigMCP.Protocol, startup: number): VersionNegotiationOptions | undefined {
  if (protocol === "legacy") return undefined
  // Fail fast on servers that never answer the probe; stdio then falls back in place, HTTP through `negotiate`.
  if (protocol === "auto") return { mode: "auto", probe: { timeoutMs: Math.min(PROBE_TIMEOUT, startup) } }
  return { mode: { pin: protocol } }
}

function toCallToolResult(result: SdkCallToolResult): CallToolResult {
  return {
    isError: result.isError === true,
    structured: result.structuredContent,
    content: result.content.flatMap((part): CallToolContent[] => {
      if (part.type === "text") return [{ type: "text", text: part.text }]
      if (part.type === "image" || part.type === "audio")
        return [{ type: "media", data: part.data, mimeType: part.mimeType }]
      if (part.type === "resource_link") return [{ type: "text", text: part.uri }]
      if (part.type === "resource") {
        const resource = part.resource
        if ("text" in resource) return [{ type: "text", text: resource.text }]
        if ("blob" in resource && resource.mimeType !== undefined)
          return [{ type: "media", data: resource.blob, mimeType: resource.mimeType, uri: resource.uri }]
        return [{ type: "text", text: resource.uri }]
      }
      return []
    }),
  }
}

// SEP-2243 `x-mcp-header` mirroring, which the SDK applies to tool calls but does not export for other requests.
type HeaderParam = { readonly path: ReadonlyArray<string>; readonly header: string }
const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const HEADER_TYPES = new Set(["string", "integer", "boolean"])
// Subschemas a properties-only chain never passes through; an annotation under one invalidates the schema.
const UNREACHABLE = new Set([
  "items",
  "prefixItems",
  "contains",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "propertyNames",
  "patternProperties",
  "dependentSchemas",
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "$defs",
  "definitions",
])

/** The annotated arguments of an input schema, or why its annotations are invalid. */
function headerParams(schema: unknown): HeaderParam[] | string {
  const params: HeaderParam[] = []
  const seen = new Set<string>()
  const visit = (node: unknown, path: string[], reachable: boolean): string | undefined => {
    if (Array.isArray(node)) return node.map((child) => visit(child, path, false)).find(Boolean)
    if (!isRecord(node)) return undefined
    const header = node["x-mcp-header"]
    if (header !== undefined) {
      const at = path.join(".") || "<root>"
      if (!reachable || path.length === 0)
        return `${at}: x-mcp-header is only allowed on a property reached through properties`
      if (typeof header !== "string" || !HEADER_TOKEN.test(header))
        return `${at}: x-mcp-header is not a valid header name`
      if (typeof node.type !== "string" || !HEADER_TYPES.has(node.type))
        return `${at}: x-mcp-header needs a string, integer or boolean type`
      if (seen.has(header.toLowerCase())) return `${at}: x-mcp-header ${header} is declared twice`
      seen.add(header.toLowerCase())
      params.push({ path, header })
    }
    if (isRecord(node.properties))
      for (const [key, child] of Object.entries(node.properties)) {
        const fault = visit(child, [...path, key], reachable)
        if (fault) return fault
      }
    for (const [key, child] of Object.entries(node)) {
      if (!UNREACHABLE.has(key)) continue
      const fault = visit(
        isRecord(child) && /^(patternProperties|dependentSchemas|\$defs|definitions)$/.test(key)
          ? Object.values(child)
          : child,
        path,
        false,
      )
      if (fault) return fault
    }
    return undefined
  }
  return visit(schema, [], true) ?? params
}

/** `Mcp-Param-*` headers for the annotated arguments that hold a primitive value. */
function paramHeaders(params: ReadonlyArray<HeaderParam>, args: unknown) {
  return Object.fromEntries(
    params.flatMap((param) => {
      const value = param.path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), args)
      const text =
        typeof value === "string"
          ? value
          : typeof value === "boolean" ||
              (typeof value === "number" &&
                Number.isFinite(value) &&
                (!Number.isInteger(value) || Number.isSafeInteger(value)))
            ? String(value)
            : undefined
      if (text === undefined) return []
      // Values that are not plain visible ASCII, or would be read as the sentinel, travel as base64.
      const plain =
        text !== "" && text === text.trim() && /^[\t\x20-\x7e]*$/.test(text) && !/^=\?base64\?.*\?=$/.test(text)
      return [[`Mcp-Param-${param.header}`, plain ? text : `=?base64?${Buffer.from(text).toString("base64")}?=`]]
    }),
  )
}

/** Fails closed: a schema that can't be compiled gives undefined. Never coerces or strips fields. */
function matcher(schema: Record<string, unknown>) {
  const codec = codecFor(schema)
  if (!codec) return undefined
  const decode = Schema.decodeUnknownOption(codec, { onExcessProperty: "error" })
  return (value: unknown) => Option.isSome(decode(value))
}
