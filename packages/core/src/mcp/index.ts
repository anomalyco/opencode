export * as Mcp from "./index.js"

import { Mcp } from "@opencode/schema/mcp"
import { McpEvent } from "@opencode/schema/mcp-event"
import { ephemeral } from "@opencode/schema/event"
import type { Session } from "@opencode/schema/session"
import type { Transport } from "@modelcontextprotocol/client"
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { Clock, Context, Effect, Exit, Fiber, FiberSet, Latch, Layer, Schema, Scope, Semaphore, Stream, Types } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Credential } from "../credential.js"
import { Bus } from "../bus.js"
import { Environment } from "../environment/index.js"
import { Form } from "../form.js"
import { Integration } from "../integration.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { Location } from "../location.js"
import { waitForAbort } from "@opencode/util/process"
import { State } from "../state.js"
import type { McpClient } from "./client.js"
import { McpConnection } from "./connection.js"

export const ServerName = Schema.String.pipe(Schema.brand("MCP.ServerName"))
export type ServerName = typeof ServerName.Type
export const PromptsChanged = ephemeral({ type: "mcp.prompts.changed", schema: { server: Schema.String } })

export const Status = Mcp.Status
export type Status = Mcp.Status
export type ServerInfo = Mcp.Server

export interface ServerInstructions {
  readonly server: ServerName
  readonly instructions: string
}

/** Checked MCP tool definition tagged with the server that owns it. */
export type Tool = McpClient.Tool & { readonly server: ServerName; readonly codemode?: boolean }
export type ToolResultContent = McpClient.CallToolContent
export type ToolResult = McpClient.CallToolResult
export type Prompt = McpClient.Prompt & { readonly server: ServerName }
export type PromptResult = McpClient.GetPromptResult

export const Resource = Mcp.Resource
export type Resource = Mcp.Resource
export const ResourceTemplate = Mcp.ResourceTemplate
export type ResourceTemplate = Mcp.ResourceTemplate
export const ResourceCatalog = Mcp.ResourceCatalog
export type ResourceCatalog = Mcp.ResourceCatalog
export const ResourceContent = Mcp.ResourceContent
export type ResourceContent = Mcp.ResourceContent

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("MCP.NotFoundError", {
  server: ServerName,
}) {
  override get message() {
    return `MCP server not found: ${this.server}`
  }
}

export class ToolCallError extends Schema.TaggedError<ToolCallError>()("MCP.ToolCallError", {
  server: ServerName,
  tool: Schema.String,
  message: Schema.String,
}) {}

const unavailable = (server: ServerName, status: Status) => {
  switch (status.status) {
    case "failed":
      return `MCP server "${server}" is not connected: ${status.error}. Reconnect it from /mcps.`
    case "needs_auth":
      return `MCP server "${server}" needs authentication: ${status.error}. Sign in from /mcps.`
    case "disabled":
      return `MCP server "${server}" is disabled.`
    default:
      return `MCP server "${server}" is not connected.`
  }
}

type ServerEntry = {
  readonly config: Mcp.ServerConfig
  status: Status
  readonly startup: Latch.Latch
  // The connection attempt in flight: when it began and a latch that opens once it settles.
  attempt?: { readonly started: number; readonly settled: Latch.Latch }
  readonly connection: McpConnection.Connection
  // The connection's tool list tagged for this server, rebuilt only when the connection lists again.
  tagged?: { readonly source: ReadonlyArray<McpClient.Tool>; readonly tools: ReadonlyArray<Tool> }
  // Set when a remote server is registered as an OAuth integration; the credential lives in the global store.
  integrationID?: Integration.ID
  registration?: State.Registration
  // Only discovery has touched this connection. Real work promotes it and keeps it alive until disposal.
  retained: boolean
  // Requests currently using the connection; a release waits for them to finish.
  borrowers: number
  // The discovery idle window elapsed while a borrower was active, so release on return.
  discoveryExpired: boolean
  idleTimer?: Fiber.Fiber<void>
}

// A client-hosted MCP server attached over a connection the client opened. Internal: never listed,
// never reconciled against config, and removed entirely once its scope or connection closes.
// Connections attached under one name stack; the most recent live one serves the name's tools.
type AttachedEntry = {
  readonly scope: Scope.Closeable
  readonly client: McpClient.Connection
  tools: ReadonlyArray<Tool>
}

// How long a model call may wait for a server that is still connecting, counted from when it began.
const STARTUP_GRACE_MS = 2_000

// Discovery is cacheable; MCP has no protocol for proving that a tool left no persistent state.
// Only connections that never served real work are released, and their metadata stays cached.
const DISCOVERY_IDLE = "60 seconds"

// Bounds re-listing the tools of an attached connection that takes over the top of its stack.
const FALLBACK_LIST_TIMEOUT = "5 seconds"

// MCP elicitations are Location-scoped, not Session-scoped: the server cannot attribute them to a
// persisted session row, so their forms are owned by this opaque sentinel session identifier.
const GLOBAL_ELICITATION_SESSION_ID = "global"
const URL_ELICITATION_FIELD_KEY = "elicitation"
// Connections remain Location-scoped, but shared remote endpoints should not receive concurrent startup bursts.
const endpointLoads = KeyedMutex.makeUnsafe<string>()

type Data = {
  servers: Map<ServerName, Types.DeepMutable<Mcp.ServerConfig>>
  removed: Set<ServerName>
}

export type Editor = {
  list: () => readonly [ServerName, Types.DeepMutable<Mcp.ServerConfig>][]
  get: (server: ServerName | string) => Types.DeepMutable<Mcp.ServerConfig> | undefined
  set: (server: ServerName | string, config: Mcp.ServerConfig) => void
  update: (server: ServerName | string, update: (config: Types.DeepMutable<Mcp.ServerConfig>) => void) => void
  remove: (server: ServerName | string) => void
}

const cloneConfig = (config: Mcp.ServerConfig) => structuredClone(config) as Types.DeepMutable<Mcp.ServerConfig>

export interface Interface extends State.Transformable<Editor> {
  /** Starts configured servers on first use and waits for their initial discovery. */
  readonly start: () => Effect.Effect<void>
  readonly servers: () => Effect.Effect<ServerInfo[]>
  readonly add: (server: ServerName | string, config: Mcp.ServerConfig) => Effect.Effect<void>
  readonly connect: (server: ServerName | string) => Effect.Effect<void, NotFoundError>
  readonly disconnect: (server: ServerName | string) => Effect.Effect<void, NotFoundError>
  readonly remove: (server: ServerName | string) => Effect.Effect<void, NotFoundError>
  /**
   * Attaches a client-hosted MCP server for the lifetime of the calling scope. Its tools are named after
   * `name` like any server's. Attaching a name again stacks the new connection on top: it serves the
   * name until it closes, then the most recent remaining connection takes over.
   */
  readonly attach: (name: string, transport: Transport) => Effect.Effect<void, McpClient.ConnectError, Scope.Scope>
  readonly tools: () => Effect.Effect<Tool[]>
  /**
   * Waits for servers that are still connecting, each until it settles or until its startup grace
   * window ends. Servers past their window never wait.
   */
  readonly awaitStartup: () => Effect.Effect<void>
  readonly callTool: (input: {
    readonly server: ServerName | string
    readonly name: string
    readonly args?: Record<string, unknown>
    readonly sessionID?: Session.ID
  }) => Effect.Effect<ToolResult, NotFoundError | ToolCallError>
  readonly instructions: () => Effect.Effect<ServerInstructions[]>
  readonly prompts: () => Effect.Effect<Prompt[]>
  readonly prompt: (input: {
    readonly server: ServerName | string
    readonly name: string
    readonly args?: Record<string, string>
  }) => Effect.Effect<PromptResult | undefined, NotFoundError>
  readonly resourceCatalog: () => Effect.Effect<ResourceCatalog>
  readonly resources: (input: { readonly server: ServerName | string }) => Effect.Effect<ResourceCatalog, Error>
  readonly readResource: (input: {
    readonly server: ServerName | string
    readonly uri: string
  }) => Effect.Effect<ResourceContent | undefined, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MCP") {}

export const Options = Schema.Struct({
  clientInfo: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      version: Schema.String,
    }),
  ),
})
export type Options = typeof Options.Type

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const location = yield* Location.Service
      const environment = yield* Environment.Service
      const bus = yield* Bus.Service
      const forms = yield* Form.Service
      const integration = yield* Integration.Service
      const credentials = yield* Credential.Service
      const root = yield* Effect.scope
      const fork = yield* FiberSet.makeRuntime<never, void, never>()
      // Server scopes close in parallel on shutdown, so one slow server's stop grace does not delay
      // the rest past a service restart's kill deadline and leave them orphaned.
      const servers = yield* Scope.fork(root, "parallel")
      // Connection callbacks run here. Created after `servers`, so the layer scope closes this set first
      // (finalizers run in reverse): in-flight callbacks are interrupted and later ones never start, so
      // connections closing with the Location publish nothing. Clients re-fetch on MCP events, which
      // would boot the Location straight back up.
      const callbacks = yield* FiberSet.makeRuntime<never, void, never>()

      const entries = new Map<ServerName, ServerEntry>()
      const attached = new Map<ServerName, AttachedEntry[]>()
      // Set on the first consumer read; configured servers stay dormant in an unused Location.
      let active = false
      // Serializes lifecycle operations per server. Anything taking this lock from a connection
      // callback must stay forked: lifecycle operations close scopes while holding it, firing onClose.
      const locks = KeyedMutex.makeUnsafe<ServerName>()
      // Attached connections lock separately so a configured server of the same name never contends.
      const attachedLocks = KeyedMutex.makeUnsafe<ServerName>()
      // Legacy era only: pending URL-mode elicitation forms, settled by notifications/elicitation/complete.
      const urlElicitations = new Map<string, Form.ID>()

      // Register every remote server as an OAuth integration so credentials live in the global store
      // rather than in committed config. Servers that connect anonymously simply never use the method.
      const register = Effect.fnUntraced(function* (name: ServerName, entry: ServerEntry) {
        if (entry.config.type !== "remote" || entry.config.oauth === false) return
        const remote = entry.config
        // Key identity on name + url, not url alone: two configs for the same url under different names are
        // distinct logical servers that may hold different accounts, so they must not share a credential row.
        const suffix =
          "mcp_" +
          createHash("sha1")
            .update(name + "\u0000" + remote.url)
            .digest("hex")
            .slice(0, 16)
        const integrationID = Integration.ID.make(suffix)
        entry.integrationID = integrationID
        const methodID = Integration.MethodID.make(suffix)
        // Each registration gets its own child scope so disposal detaches it from the root scope
        // entirely; registering directly on root would accumulate a dead finalizer per replaced or
        // removed server for the lifetime of the layer.
        const scope = yield* Scope.fork(root)
        entry.registration = { dispose: Scope.close(scope, Exit.void) }
        yield* integration
          .transform((editor) => {
            editor.update(integrationID, (ref) => {
              ref.name = name
              ref.metadata = { source: "mcp" }
            })
            editor.method.update({
              integrationID,
              method: { id: methodID, type: "oauth", label: name },
              authorize: () =>
                Effect.gen(function* () {
                  const { McpOAuth } = yield* Effect.promise(() => import("./oauth.js"))
                  return yield* McpOAuth.authorize({ name, config: remote, integrationID, methodID }).pipe(
                    Effect.provideService(Credential.Service, credentials),
                  )
                }),
            })
          })
          .pipe(Scope.provide(scope))
      })
      const requireServer = Effect.fnUntraced(function* (name: ServerName) {
        const entry = entries.get(name)
        if (!entry) return yield* new NotFoundError({ server: name })
        return entry
      })

      const connectProvider = Effect.fnUntraced(function* (entry: ServerEntry) {
        if (entry.config.type !== "remote" || !entry.integrationID) return undefined
        const { McpOAuth } = yield* Effect.promise(() => import("./oauth.js"))
        return yield* McpOAuth.connectProvider({ config: entry.config, integrationID: entry.integrationID }).pipe(
          Effect.provideService(Credential.Service, credentials),
        )
      })

      const elicitation = {
        create: (input: {
          readonly server: string
          readonly params: McpClient.ElicitationParams
          readonly signal: AbortSignal
        }) =>
          Effect.gen(function* () {
            if (input.params.mode === "url") {
              const formID = Form.ID.create()
              // Legacy only: 2026-07-28 has no elicitationId and no completion notification, so the form
              // settles when the user confirms and the SDK retries the tool call itself.
              const elicitationID = input.params.elicitationId
              const key = elicitationID === undefined ? undefined : input.server + "\u0000" + elicitationID
              if (key) urlElicitations.set(key, formID)
              return yield* forms
                .ask({
                  id: formID,
                  sessionID: GLOBAL_ELICITATION_SESSION_ID,
                  title: `${input.server} is requesting input`,
                  metadata: {
                    kind: "mcp-elicitation",
                    server: input.server,
                    ...(elicitationID === undefined ? {} : { elicitationID }),
                    message: input.params.message,
                  },
                  fields: [{ key: URL_ELICITATION_FIELD_KEY, type: "external", url: input.params.url }],
                })
                .pipe(
                  Effect.raceFirst(waitForAbort(input.signal)),
                  Effect.ensuring(Effect.sync(() => key && urlElicitations.delete(key))),
                  Effect.map(
                    (state): McpClient.ElicitationResult => ({
                      action: state.status === "answered" ? "accept" : "cancel",
                    }),
                  ),
                )
            }
            const params = input.params
            const [field, ...fields] = Object.entries(params.requestedSchema.properties).map(([key, property]) =>
              toElicitationField(key, property, params.requestedSchema.required?.includes(key) === true),
            )
            if (!field) return { action: "accept", content: {} }
            return yield* forms
              .ask({
                sessionID: GLOBAL_ELICITATION_SESSION_ID,
                title: `${input.server} is requesting input`,
                metadata: { kind: "mcp-elicitation", server: input.server, message: params.message },
                fields: [field, ...fields],
              })
              .pipe(
                Effect.raceFirst(waitForAbort(input.signal)),
                Effect.map((state): McpClient.ElicitationResult => {
                  if (state.status !== "answered") return { action: "cancel" }
                  return {
                    action: "accept",
                    content: Object.fromEntries(
                      Object.entries(state.answer).map(
                        ([key, value]): [string, NonNullable<McpClient.ElicitationResult["content"]>[string]] =>
                          typeof value === "object" ? [key, Array.from(value)] : [key, value],
                      ),
                    ),
                  }
                }),
              )
          }),
        complete: (input: { readonly server: string; readonly elicitationID: string }) =>
          Effect.gen(function* () {
            const formID = urlElicitations.get(input.server + "\u0000" + input.elicitationID)
            if (!formID) return
            yield* forms.reply({ id: formID, answer: { [URL_ELICITATION_FIELD_KEY]: true } }).pipe(Effect.ignore)
          }),
      } satisfies McpClient.ElicitationHandler

      const makeEntry = (name: ServerName, config: Mcp.ServerConfig, started: number): ServerEntry => {
        const entry: ServerEntry = {
          config,
          status: { status: "pending" },
          startup: Latch.makeUnsafe(),
          attempt: { started, settled: Latch.makeUnsafe() },
          retained: false,
          borrowers: 0,
          discoveryExpired: false,
          connection: McpConnection.make({
            name,
            config,
            directory: location.directory,
            clientInfo: options?.clientInfo,
            authProvider: Effect.suspend(() => connectProvider(entry)),
            elicitation,
            environment,
            scope: servers,
            lock: locks.withLock(name),
            handshake: (effect) => (config.type === "remote" ? endpointLoads.withLock(config.url)(effect) : effect),
            callbacks,
            fork,
            events: {
              connecting: Effect.gen(function* () {
                // A server still pending from creation keeps the window that started with its entry.
                if (!entry.attempt || entry.status.status !== "pending")
                  entry.attempt = { started: yield* Clock.currentTimeMillis, settled: Latch.makeUnsafe() }
                // Announce the handshake so connect() and credential reconnects don't show a stale
                // disabled/failed status for the duration of the connection attempt.
                entry.status = { status: "pending" }
                yield* bus.publish(McpEvent.StatusChanged, { server: name })
              }),
              connected: Effect.gen(function* () {
                entry.status = { status: "connected" }
                yield* Effect.logInfo("mcp connected", { server: name, tools: entry.connection.tools?.length })
                // The tool registry reads on this event; a late-connecting server has no other way to appear.
                yield* bus.publish(McpEvent.ToolsChanged, { server: name })
                yield* bus.publish(McpEvent.ResourcesChanged, { server: name })
                yield* bus.publish(McpEvent.StatusChanged, { server: name })
                yield* scheduleIdle(name, entry)
              }),
              failed: (failure) =>
                Effect.gen(function* () {
                  entry.status = failure
                  yield* Effect.logWarning("mcp connect failed", { server: name, status: entry.status })
                  yield* bus.publish(McpEvent.StatusChanged, { server: name })
                }),
              // Every start runs under the server lock, so the attempt read here is the one it began.
              settled: Effect.suspend(() => {
                const attempt = entry.attempt
                entry.attempt = undefined
                return (attempt ? attempt.settled.open : Effect.void).pipe(Effect.ensuring(entry.startup.open))
              }),
              stopped: Effect.gen(function* () {
                yield* bus.publish(McpEvent.ToolsChanged, { server: name })
                yield* bus.publish(McpEvent.ResourcesChanged, { server: name })
                yield* bus.publish(PromptsChanged, { server: name })
              }),
              released: Effect.gen(function* () {
                entry.status = { status: "idle" }
                yield* bus.publish(McpEvent.StatusChanged, { server: name })
              }),
              closed: (reason) =>
                Effect.gen(function* () {
                  entry.status = { status: "failed", error: reason }
                  yield* entry.connection.stop
                  yield* bus.publish(McpEvent.StatusChanged, { server: name })
                }),
              toolsChanged: bus.publish(McpEvent.ToolsChanged, { server: name }),
              promptsChanged: bus.publish(PromptsChanged, { server: name }),
              resourcesChanged: bus.publish(McpEvent.ResourcesChanged, { server: name }),
            },
          }),
        }
        return entry
      }

      // MCP.tools() runs every step and the tool registry compares tools by identity, so tag the
      // connection's list once per listing instead of on every read.
      const serverTools = (name: ServerName, entry: ServerEntry) => {
        const source = entry.connection.tools
        if (!source) return []
        if (entry.tagged?.source !== source)
          entry.tagged = {
            source,
            tools: source.map(
              (tool): Tool => ({
                ...tool,
                server: name,
                codemode: entry.config.codemode,
              }),
            ),
          }
        return entry.tagged.tools
      }

      const toCatalog = (name: ServerName, catalog: McpConnection.Catalog) =>
        ResourceCatalog.make({
          resources: catalog.resources.map((resource) =>
            Resource.make({
              server: name,
              name: resource.name,
              uri: resource.uri,
              description: resource.description,
              mimeType: resource.mimeType,
            }),
          ),
          templates: catalog.templates.map((template) =>
            ResourceTemplate.make({
              server: name,
              name: template.name,
              uriTemplate: template.uriTemplate,
              description: template.description,
              mimeType: template.mimeType,
            }),
          ),
        })

      const startServer = (entry: ServerEntry) =>
        Effect.gen(function* () {
          entry.discoveryExpired = false
          // Reset the startup grace window for this attempt; a deferred entry may have waited a long time.
          entry.attempt = { started: yield* Clock.currentTimeMillis, settled: Latch.makeUnsafe() }
          yield* entry.connection.start
        }).pipe(Effect.ensuring(entry.startup.open))

      const cancelIdle = Effect.fnUntraced(function* (entry: ServerEntry) {
        const timer = entry.idleTimer
        entry.idleTimer = undefined
        if (timer) yield* Fiber.interrupt(timer)
      })

      // Called under the server lock. Discovery-only connections are released after the idle window;
      // real work sets `retained` and keeps its transport until disposal.
      const scheduleIdle = Effect.fnUntraced(function* (name: ServerName, entry: ServerEntry) {
        if (!entry.connection.client || entry.retained) {
          yield* cancelIdle(entry)
          return
        }
        if (entry.discoveryExpired) {
          if (entry.borrowers > 0) return
          yield* entry.connection.release
          return
        }
        if (entry.idleTimer) return
        const connection = entry.connection.client
        entry.idleTimer = fork(
          Effect.sleep(DISCOVERY_IDLE).pipe(
            Effect.andThen(
              Effect.gen(function* () {
                entry.idleTimer = undefined
                // A reconnect, replacement or disposal since the timer began owns the current state.
                if (entries.get(name) !== entry || entry.connection.client !== connection) return
                entry.discoveryExpired = true
                yield* scheduleIdle(name, entry)
              }).pipe(locks.withLock(name)),
            ),
          ),
        )
      })

      const stopServer = Effect.fnUntraced(function* (entry: ServerEntry) {
        yield* cancelIdle(entry)
        yield* entry.connection.stop
      })

      const disposeServer = Effect.fnUntraced(function* (entry: ServerEntry) {
        yield* stopServer(entry)
        if (entry.registration) yield* entry.registration.dispose
        // Lazy startup may have readers waiting on an entry removed before its queued fork runs.
        yield* entry.startup.open
      })

      const replaceServer = Effect.fnUntraced(function* (name: ServerName, serverConfig: Mcp.ServerConfig) {
        const previous = entries.get(name)
        const connect = active || previous?.connection.client !== undefined
        if (previous) yield* disposeServer(previous)
        const entry = makeEntry(name, serverConfig, yield* Clock.currentTimeMillis)
        entries.set(name, entry)
        yield* Effect.gen(function* () {
          yield* register(name, entry)
          if (serverConfig.disabled) {
            entry.status = { status: "disabled" }
            yield* bus.publish(McpEvent.StatusChanged, { server: name })
            return
          }
          if (connect) yield* startServer(entry)
        }).pipe(
          // Settle startup even when registration fails or replacement is interrupted, so readers cannot hang.
          Effect.ensuring(entry.startup.open),
        )
      })

      const removeServer = Effect.fnUntraced(function* (name: ServerName, entry: ServerEntry) {
        yield* disposeServer(entry)
        // Credentials are keyed by name + URL and intentionally survive removal for a later re-add.
        entries.delete(name)
        yield* bus.publish(McpEvent.StatusChanged, { server: name })
      })

      const toAttachedTools = (server: ServerName, tools: ReadonlyArray<McpClient.Tool>) =>
        tools.map((tool): Tool => ({ ...tool, server }))

      const detach = Effect.fnUntraced(function* (name: ServerName, entry: AttachedEntry) {
        const stack = attached.get(name) ?? []
        if (!stack.includes(entry)) return
        const remaining = stack.filter((item) => item !== entry)
        const next = remaining.at(-1)
        if (!next) {
          attached.delete(name)
          yield* Scope.close(entry.scope, Exit.void)
          return yield* bus.publish(McpEvent.ToolsChanged, { server: name })
        }
        // Unlocked reads must never pick a closing connection, so update the stack before closing it.
        attached.set(name, remaining)
        yield* Scope.close(entry.scope, Exit.void)
        // Closing an idle connection changes nothing visible.
        if (stack.at(-1) !== entry) return
        // Idle connections ignore tool list changes, so the one taking over lists its tools again. A short
        // timeout keeps a half-open connection from holding the lock; it then keeps its stored tools.
        const previous = next.tools
        yield* next.client.tools().pipe(
          Effect.timeout(FALLBACK_LIST_TIMEOUT),
          Effect.map((tools) => {
            next.tools = toAttachedTools(name, tools)
          }),
          Effect.ignore,
        )
        // Readers may have seen the stored tools in the meantime, so compare against both.
        if (!isDeepStrictEqual(entry.tools, next.tools) || !isDeepStrictEqual(previous, next.tools))
          yield* bus.publish(McpEvent.ToolsChanged, { server: name })
      })

      // The handshake runs interruptibly and outside the lock, so a stalled client never blocks detach or
      // fallback for its name; the lock only guards adding the finished connection to the stack.
      const attach = Effect.fnUntraced(function* (name: ServerName, transport: Transport) {
        const { McpClient } = yield* Effect.promise(() => import("./client.js"))
        const scope = yield* Effect.acquireRelease(Scope.fork(root), (scope) => Scope.close(scope, Exit.void))
        // The client registers its own close only once initialized; closing the scope mid-handshake (caller
        // interruption or Location shutdown) must still close the transport right away.
        yield* Scope.addFinalizer(scope, Effect.promise(() => transport.close()).pipe(Effect.ignore))
        let closed = false
        const result = yield* McpClient.connect(
          name,
          { type: "attached", transport },
          location.directory,
          undefined,
          elicitation,
          options?.clientInfo,
        ).pipe(
          Effect.tap((connection) =>
            Effect.sync(() =>
              connection.onClose(() => {
                closed = true
              }),
            ),
          ),
          Effect.flatMap((connection) => connection.tools().pipe(Effect.map((tools) => ({ connection, tools })))),
          Effect.provideService(Environment.Service, environment),
          Scope.provide(scope),
          Effect.onError(() => Scope.close(scope, Exit.void)),
          Effect.mapError((error) =>
            error instanceof McpClient.ConnectError
              ? error
              : new McpClient.ConnectError({ server: name, message: error.message }),
          ),
        )
        const register = Effect.gen(function* () {
          if (closed) {
            yield* Scope.close(scope, Exit.void)
            return yield* new McpClient.ConnectError({ server: name, message: "Connection closed" })
          }
          const entry: AttachedEntry = { scope, client: result.connection, tools: toAttachedTools(name, result.tools) }
          attached.set(name, [...(attached.get(name) ?? []), entry])
          const locked = <E>(effect: Effect.Effect<void, E>) =>
            fork(effect.pipe(attachedLocks.withLock(name), Effect.ignore))
          result.connection.onClose(() => locked(detach(name, entry)))
          // Bounded like fallback so a connection that stalls after announcing a change cannot hold the lock.
          const refresh = result.connection.tools().pipe(
            Effect.timeout(FALLBACK_LIST_TIMEOUT),
            Effect.map((tools) => {
              entry.tools = toAttachedTools(name, tools)
            }),
            Effect.andThen(bus.publish(McpEvent.ToolsChanged, { server: name })),
          )
          result.connection.onToolsChanged(() =>
            locked(Effect.suspend(() => (attached.get(name)?.at(-1) === entry ? refresh : Effect.void))),
          )
          yield* Effect.logInfo("mcp client attached", { server: name, tools: entry.tools.length })
          yield* bus.publish(McpEvent.ToolsChanged, { server: name })
          return entry
        })
        yield* Effect.acquireRelease(register.pipe(attachedLocks.withLock(name)), (entry) =>
          detach(name, entry).pipe(attachedLocks.withLock(name)),
        )
      })

      const startPending = Effect.fnUntraced(function* () {
        const started = yield* Clock.currentTimeMillis
        for (const [name, entry] of entries) {
          if (entry.config.disabled || entry.status.status !== "pending" || entry.connection.client) continue
          entry.attempt = { started, settled: Latch.makeUnsafe() }
          // A queued attempt must let current readers wait only for this window.
          entry.startup.closeUnsafe()
          fork(
            Effect.suspend(() =>
              entries.get(name) === entry && entry.status.status === "pending" && !entry.connection.client
                ? startServer(entry)
                : Effect.void,
            ).pipe(locks.withLock(name)),
          )
        }
      })

      // A Location becomes active on its first MCP consumer read. Before then, config is registered
      // without spawning a server; after it, newly registered servers start immediately.
      const activate = Effect.suspend(() =>
        active
          ? Effect.void
          : reconcileLock.withPermit(
              Effect.gen(function* () {
                if (active) return
                active = true
                yield* startPending()
              }),
            ),
      ).pipe(Effect.uninterruptible)

      // Acquisition and release are masked by acquireUseRelease, including cancelled startup waiters.
      // The lock protects lifecycle transitions, not the request: concurrent readers share a client.
      const withConnection = <A, E extends Error>(
        name: ServerName,
        entry: ServerEntry,
        retain: boolean,
        run: (connection: McpClient.Connection) => Effect.Effect<A, E>,
      ) =>
        Effect.acquireUseRelease(
          Effect.gen(function* () {
            if (entries.get(name) !== entry) return { connection: undefined, borrowed: false }
            if (!entry.connection.client && (entry.status.status === "idle" || entry.status.status === "pending"))
              yield* startServer(entry)
            entry.borrowers++
            return { connection: entry.connection.client, borrowed: true }
          }).pipe(locks.withLock(name)),
          ({ connection }) =>
            Effect.suspend(() => {
              if (!connection) return Effect.succeed(undefined)
              if (retain) entry.retained = true
              return entry.connection.recovering(connection, run)
            }),
          ({ borrowed }) =>
            Effect.gen(function* () {
              if (!borrowed) return
              entry.borrowers--
              yield* scheduleIdle(name, entry)
            }).pipe(locks.withLock(name)),
        )

      const discoverCatalog = (name: ServerName, entry: ServerEntry) =>
        withConnection(name, entry, false, (connection) => entry.connection.loadCatalog(connection)).pipe(
          Effect.map((catalog) => (catalog ? toCatalog(name, catalog) : undefined)),
        )

      let booted = false
      const overrides = new Map<ServerName, Mcp.ServerConfig | false>()
      const reconcileLock = Semaphore.makeUnsafe(1)
      const reconcile = Effect.fnUntraced(function* () {
        const servers = state.get().servers
        if (!booted) {
          booted = true
          const started = yield* Clock.currentTimeMillis
          for (const [name, server] of servers) {
            entries.set(name, makeEntry(name, server, started))
          }
          yield* Effect.forEach(entries, ([name, entry]) => register(name, entry), { discard: true })

          // Register metadata at boot, but do not spawn servers for a Location nobody uses yet.
          for (const [name, entry] of entries) {
            if (!entry.config.disabled) continue
            entry.status = { status: "disabled" }
            entry.startup.openUnsafe()
            yield* bus.publish(McpEvent.StatusChanged, { server: name })
          }
          if (active) yield* startPending()
          return
        }

        for (const [name, entry] of entries) {
          const updated = servers.get(name)
          if (isDeepStrictEqual(entry.config, updated)) continue
          yield* (updated ? replaceServer(name, updated) : removeServer(name, entry)).pipe(locks.withLock(name))
        }
        for (const [name, updated] of servers) {
          if (!entries.has(name)) yield* replaceServer(name, updated).pipe(locks.withLock(name))
        }
      })

      // Bring a server online (or back to needs_auth) when its integration's credential changes, so an
      // OAuth login takes effect without a restart. Only fires for the integrations we registered.
      const reconnect = (integrationID: Integration.ID) =>
        Effect.gen(function* () {
          const match = Array.from(entries).find(([, entry]) => entry.integrationID === integrationID)
          if (!match) return
          const name = match[0]
          yield* Effect.gen(function* () {
            // add() or remove() may have replaced or deleted the entry while we waited for the lock.
            const entry = entries.get(name)
            if (!entry || entry.integrationID !== integrationID) return
            if (entry.status.status === "disabled") return
            // A dormant or idle metadata connection picks up the new credential when its next use starts it.
            if (
              !entry.connection.client &&
              (!active || entry.status.status === "idle" || entry.status.status === "pending")
            )
              return
            yield* stopServer(entry)
            yield* startServer(entry)
          }).pipe(locks.withLock(name))
        })
      fork(
        bus
          .subscribe(Credential.Event.Switched)
          .pipe(Stream.runForEach((event) => Effect.sync(() => fork(reconnect(event.data.integrationID))))),
      )
      const state: State.Interface<Data, Editor> = State.create<Data, Editor>({
        name: "mcp",
        initial: () => ({
          servers: new Map(
            Array.from(overrides).flatMap(([name, config]) =>
              config === false ? [] : [[name, cloneConfig(config)] as const],
            ),
          ),
          removed: new Set(Array.from(overrides).flatMap(([name, config]) => (config === false ? [name] : []))),
        }),
        editor: (editor) => ({
          list: () => Array.from(editor.servers),
          get: (server) => editor.servers.get(ServerName.make(server)),
          set: (server, serverConfig) => {
            const name = ServerName.make(server)
            if (editor.removed.has(name)) return
            editor.servers.set(name, cloneConfig(serverConfig))
          },
          update: (server, update) => {
            const current = editor.servers.get(ServerName.make(server))
            if (!current) return
            update(current)
          },
          remove: (server) => editor.servers.delete(ServerName.make(server)),
        }),
        notify: () => State.reconcile(root, fork, () => reconcileLock.withPermit(reconcile())),
      })

      const awaitStartup = Effect.fnUntraced(function* () {
        const now = yield* Clock.currentTimeMillis
        yield* Effect.all(
          Array.from(entries.values()).flatMap((entry) => {
            if (entry.status.status !== "pending" || !entry.attempt) return []
            const remaining = entry.attempt.started + STARTUP_GRACE_MS - now
            return remaining > 0 ? [entry.attempt.settled.await.pipe(Effect.raceFirst(Effect.sleep(remaining)))] : []
          }),
          { concurrency: "unbounded", discard: true },
        )
      })

      return Service.of({
        transform: state.transform,
        reload: state.reload,
        start: Effect.fn("MCP.start")(function* () {
          // First use may precede the config plugin's initial notification, which registers entries.
          if (!booted) yield* state.reload()
          yield* activate
          // Startup grace stays bounded: a slow handshake never holds up session preparation.
          yield* awaitStartup()
        }),
        servers: Effect.fn("MCP.servers")(function* () {
          yield* activate
          return Array.from(entries)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(
              ([name, entry]): ServerInfo => ({
                name,
                status: entry.status,
                title: entry.connection.title,
                integrationID: entry.integrationID,
              }),
            )
        }),
        add: Effect.fn("MCP.add")(function* (server, config) {
          const name = ServerName.make(server)
          overrides.set(name, config)
          yield* state.reload()
        }),
        connect: Effect.fn("MCP.connect")(function* (server) {
          const name = ServerName.make(server)
          yield* Effect.gen(function* () {
            const entry = yield* requireServer(name)
            entry.retained = true
            yield* stopServer(entry)
            yield* startServer(entry)
          }).pipe(locks.withLock(name))
        }),
        disconnect: Effect.fn("MCP.disconnect")(function* (server) {
          const name = ServerName.make(server)
          yield* Effect.gen(function* () {
            const entry = yield* requireServer(name)
            yield* stopServer(entry)
            entry.retained = false
            entry.status = { status: "disabled" }
            yield* entry.startup.open
            yield* bus.publish(McpEvent.StatusChanged, { server: name })
          }).pipe(locks.withLock(name))
        }),
        remove: Effect.fn("MCP.remove")(function* (server) {
          const name = ServerName.make(server)
          yield* requireServer(name)
          overrides.set(name, false)
          yield* state.reload()
        }),
        attach: Effect.fn("MCP.attach")(function* (client, transport) {
          yield* attach(ServerName.make(client), transport)
        }),
        // Reads report what is connected now; dormant and idle servers contribute their cached metadata.
        tools: Effect.fn("MCP.tools")(function* () {
          const clients = Array.from(attached.values()).flatMap((stack) => stack.at(-1)?.tools ?? [])
          // Match callTool: an attached client's tool shadows a configured server's tool of the same name.
          const shadowed = new Set(clients.map((tool) => `${tool.server}\0${tool.name}`))
          return [
            ...Array.from(entries)
              .flatMap(([name, entry]) => serverTools(name, entry))
              .filter((tool) => !shadowed.has(`${tool.server}\0${tool.name}`)),
            ...clients,
          ].toSorted((a, b) => a.server.localeCompare(b.server) || a.name.localeCompare(b.name))
        }),
        awaitStartup,
        callTool: Effect.fn("MCP.callTool")(function* (input) {
          const server = ServerName.make(input.server)
          const call = (connection: McpClient.Connection) =>
            connection.callTool({ name: input.name, args: input.args, sessionID: input.sessionID })
          const failed = (owner: string) =>
            Effect.mapError(
              (error: Error) =>
                new ToolCallError({
                  server,
                  tool: input.name,
                  message: `MCP tool "${input.name}" on ${owner} "${server}" failed: ${error.message}`,
                }),
            )
          // An attached client owns the tools it lists, even when a configured server shares its name, and
          // owns its name outright when no configured server has it. It must not wake configured servers.
          const client = attached.get(server)?.at(-1)
          if (client && (client.tools.some((tool) => tool.name === input.name) || !entries.has(server)))
            return yield* call(client.client).pipe(failed("client"))
          yield* activate
          const entry = yield* requireServer(server)
          const result = yield* withConnection(server, entry, true, call).pipe(failed("server"))
          if (!result) return yield* new ToolCallError({ server, tool: input.name, message: unavailable(server, entry.status) })
          return result
        }),
        instructions: Effect.fn("MCP.instructions")(function* () {
          yield* activate
          return Array.from(entries)
            .flatMap(([server, entry]) => {
              const instructions = entry.connection.instructions
              if (!instructions) return []
              return [{ server, instructions }]
            })
            .toSorted((a, b) => a.server.localeCompare(b.server))
        }),
        prompts: Effect.fn("MCP.prompts")(function* () {
          return Array.from(entries)
            .flatMap(([server, entry]) =>
              (entry.connection.prompts ?? []).map((prompt): Prompt => ({ ...prompt, server })),
            )
            .toSorted((a, b) => a.server.localeCompare(b.server) || a.name.localeCompare(b.name))
        }),
        prompt: Effect.fn("MCP.prompt")(function* (input) {
          const server = ServerName.make(input.server)
          yield* activate
          const entry = yield* requireServer(server)
          return yield* withConnection(server, entry, true, (connection) =>
            connection.prompt({ name: input.name, args: input.args }),
          ).pipe(Effect.orElseSucceed(() => undefined))
        }),
        resourceCatalog: Effect.fn("MCP.resourceCatalog")(function* () {
          yield* activate
          const empty = ResourceCatalog.make({ resources: [], templates: [] })
          const catalogs = yield* Effect.forEach(
            Array.from(entries),
            ([name, entry]) =>
              Effect.suspend(() => {
                const cached = entry.connection.catalog
                if (entry.status.status === "idle" && cached) return Effect.succeed(toCatalog(name, cached))
                return discoverCatalog(name, entry).pipe(
                  Effect.orElseSucceed(() => undefined),
                  Effect.map((catalog) => catalog ?? empty),
                )
              }),
            { concurrency: "unbounded" },
          )
          return mergeCatalogs(catalogs)
        }),
        resources: Effect.fn("MCP.resources")(function* (input) {
          const name = ServerName.make(input.server)
          yield* activate
          const entry = yield* requireServer(name)
          const cached = entry.connection.catalog
          if (entry.status.status === "idle" && cached) return mergeCatalogs([toCatalog(name, cached)])
          const catalog = yield* discoverCatalog(name, entry)
          return catalog ? mergeCatalogs([catalog]) : ResourceCatalog.make({ resources: [], templates: [] })
        }),
        readResource: Effect.fn("MCP.readResource")(function* (input) {
          const name = ServerName.make(input.server)
          yield* activate
          const entry = yield* requireServer(name)
          const result = yield* withConnection(name, entry, true, (connection) =>
            connection.readResource({ uri: input.uri }),
          )
          if (!result) return undefined
          return ResourceContent.make({
            server: name,
            uri: input.uri,
            contents: result.contents.map((part) =>
              "text" in part
                ? { type: "text", uri: part.uri, text: part.text, mimeType: part.mimeType }
                : { type: "blob", uri: part.uri, blob: part.blob, mimeType: part.mimeType },
            ),
          })
        }),
      })
    }),
  )

function mergeCatalogs(catalogs: ReadonlyArray<ResourceCatalog>) {
  return ResourceCatalog.make({
    resources: catalogs
      .flatMap((catalog) => catalog.resources)
      .toSorted(
        (a, b) => a.server.localeCompare(b.server) || a.name.localeCompare(b.name) || a.uri.localeCompare(b.uri),
      ),
    templates: catalogs
      .flatMap((catalog) => catalog.templates)
      .toSorted(
        (a, b) =>
          a.server.localeCompare(b.server) ||
          a.name.localeCompare(b.name) ||
          a.uriTemplate.localeCompare(b.uriTemplate),
      ),
  })
}

export function configured(options?: Options) {
  return makeLocationNode({
    service: Service,
    layer: layer(options),
    deps: [Location.node, Environment.node, Bus.node, Form.node, Integration.node, Credential.node],
  })
}

export const node = configured()

// Schema `optional` strips undefined-valued properties on encode, so fields can assign
// optional properties directly instead of conditionally spreading them.
function toElicitationField(key: string, property: ElicitationProperty, required: boolean): Form.Field {
  // Some servers emit machine titles like "string with format email"; prefer description/key over those.
  const machineTitle = /^(boolean|string|number|integer|array|object)(\s+with\b.*|\s+in\b.*)?$/i
  const title =
    property.title && !machineTitle.test(property.title.trim()) ? property.title : (property.description ?? key)
  const base = {
    key,
    title,
    description: property.description === title ? undefined : property.description,
    required: required || undefined,
  }
  switch (property.type) {
    case "boolean":
      return { ...base, type: "boolean", default: property.default }
    case "number":
    case "integer":
      return {
        ...base,
        type: property.type,
        minimum: property.minimum,
        maximum: property.maximum,
        default: property.default,
      }
    case "array":
      return {
        ...base,
        type: "multiselect",
        options:
          "anyOf" in property.items
            ? property.items.anyOf.map((option) => ({ value: option.const, label: option.title }))
            : property.items.enum.map((value) => ({ value, label: value })),
        custom: false,
        minItems: property.minItems,
        maxItems: property.maxItems,
        default: property.default,
      }
    case "string": {
      const options =
        "oneOf" in property
          ? property.oneOf.map((option) => ({ value: option.const, label: option.title }))
          : "enum" in property
            ? property.enum.map((value, index) => ({
                value,
                label: ("enumNames" in property ? property.enumNames?.[index] : undefined) ?? value,
              }))
            : undefined
      return {
        ...base,
        type: "string",
        format: "format" in property ? property.format : undefined,
        minLength: "minLength" in property ? property.minLength : undefined,
        maxLength: "maxLength" in property ? property.maxLength : undefined,
        default: property.default,
        options,
        custom: options ? false : undefined,
      }
    }
  }
}

type ElicitationProperty = McpClient.ElicitationFormParams["requestedSchema"]["properties"][string]
