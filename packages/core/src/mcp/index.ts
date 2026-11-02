export * as Mcp from "./index.js"

import { Mcp } from "@opencode/schema/mcp"
import { McpEvent } from "@opencode/schema/mcp-event"
import { ephemeral } from "@opencode/schema/event"
import type { Session } from "@opencode/schema/session"
import type { Transport } from "@modelcontextprotocol/client"
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { Clock, Context, Effect, Exit, FiberSet, Latch, Layer, Schema, Scope, Semaphore, Stream, Types } from "effect"
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

/** SDK tool definition tagged with the server that owns it. */
export type Tool = McpClient.Tool & { readonly server: ServerName; readonly codemode?: boolean }
export type ToolResultContent = McpClient.CallToolContent
export type ToolResult = McpClient.CallToolResult & { readonly server: ServerName; readonly tool: string }
export type Prompt = McpClient.Prompt & { readonly server: ServerName }
export type PromptResult = McpClient.GetPromptResult & { readonly server: ServerName; readonly name: string }

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
      // Serializes lifecycle operations per server. Anything taking this lock from a connection
      // callback must stay forked: lifecycle operations close scopes while holding it, firing onClose.
      const locks = KeyedMutex.makeUnsafe<ServerName>()
      // Attached connections lock separately so a configured server of the same name never contends.
      const attachedLocks = KeyedMutex.makeUnsafe<ServerName>()
      // Legacy era only: pending URL-mode elicitation forms, settled by notifications/elicitation/complete.
      const urlElicitations = new Map<string, Form.ID>()

      // Register every remote server as an OAuth integration so credentials live in the global store
      // rather than in committed config. Servers that connect anonymously simply never use the method.
      const owned = new Set<Integration.ID>()
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
        owned.add(integrationID)
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
        return { name, entry }
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
              const elicitationID: string | undefined = input.params.elicitationId
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
              closed: (reason) =>
                Effect.gen(function* () {
                  entry.status = { status: "failed", error: reason }
                  yield* entry.connection.stop
                  yield* bus.publish(McpEvent.StatusChanged, { server: name })
                }),
              toolsChanged: Effect.suspend(() => bus.publish(McpEvent.ToolsChanged, { server: name })),
              promptsChanged: Effect.suspend(() => bus.publish(PromptsChanged, { server: name })),
              resourcesChanged: Effect.suspend(() => bus.publish(McpEvent.ResourcesChanged, { server: name })),
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
                ...(entry.config.codemode === undefined ? {} : { codemode: entry.config.codemode }),
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

      const disposeServer = Effect.fnUntraced(function* (name: ServerName, entry: ServerEntry) {
        yield* entry.connection.stop
        if (entry.integrationID) owned.delete(entry.integrationID)
        if (entry.registration) yield* entry.registration.dispose
      })

      const replaceServer = Effect.fnUntraced(function* (name: ServerName, serverConfig: Mcp.ServerConfig) {
        const previous = entries.get(name)
        if (previous) yield* disposeServer(name, previous)
        const entry = makeEntry(name, serverConfig, yield* Clock.currentTimeMillis)
        entries.set(name, entry)
        yield* Effect.gen(function* () {
          yield* register(name, entry)
          if (serverConfig.disabled) {
            entry.status = { status: "disabled" }
            yield* bus.publish(McpEvent.StatusChanged, { server: name })
            return
          }
          yield* entry.connection.start
        }).pipe(
          // Settle startup even when registration fails or replacement is interrupted, so readers cannot hang.
          Effect.ensuring(entry.startup.open),
        )
      })

      const removeServer = Effect.fnUntraced(function* (name: ServerName) {
        const entry = entries.get(name)
        if (!entry) return
        yield* disposeServer(name, entry)
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
        // Already detaching; closing the scope must not schedule a second detach.
        entry.client.onClose(() => {})
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

      let applied: Map<ServerName, Mcp.ServerConfig> | undefined
      const overrides = new Map<ServerName, Mcp.ServerConfig | false>()
      const reconcileLock = Semaphore.makeUnsafe(1)
      const reconcile = Effect.fnUntraced(function* () {
        const servers = state.get().servers
        if (!applied && entries.size === 0) {
          const started = yield* Clock.currentTimeMillis
          for (const [name, server] of servers) {
            entries.set(name, makeEntry(name, server, started))
          }
          yield* Effect.forEach(entries, ([name, entry]) => register(name, entry), { discard: true })
          applied = servers

          // Initial connections stay asynchronous so one slow server does not block Location startup.
          for (const [name, entry] of entries) {
            if (entry.config.disabled) {
              entry.status = { status: "disabled" }
              entry.startup.openUnsafe()
              yield* bus.publish(McpEvent.StatusChanged, { server: name })
              continue
            }
            fork(
              Effect.gen(function* () {
                // connect() or disconnect() may have settled the server while this startup waited to run.
                if (entry.status.status !== "pending") return yield* entry.startup.open
                yield* entry.connection.start
              }).pipe(locks.withLock(name)),
            )
          }
          return
        }

        const names = new Set([...(applied?.keys() ?? []), ...servers.keys()])
        for (const name of names) {
          const previous = applied?.get(name)
          const updated = servers.get(name)
          if (isDeepStrictEqual(previous, updated)) continue
          if (!updated) {
            yield* removeServer(name).pipe(locks.withLock(name))
            continue
          }
          yield* replaceServer(name, updated).pipe(locks.withLock(name))
        }
        applied = servers
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
            yield* entry.connection.stop
            yield* entry.connection.start
          }).pipe(locks.withLock(name))
        })
      fork(
        bus.subscribe(Credential.Event.Switched).pipe(
          Stream.filter((event) => owned.has(event.data.integrationID)),
          Stream.runForEach((event) => Effect.sync(() => fork(reconnect(event.data.integrationID)))),
        ),
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

      return Service.of({
        transform: state.transform,
        reload: state.reload,
        servers: Effect.fn("MCP.servers")(function* () {
          return Array.from(entries)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(
              ([name, entry]): ServerInfo => ({
                name,
                status: entry.status,
                title: entry.connection.client?.title,
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
            const target = yield* requireServer(name)
            yield* target.entry.connection.stop
            yield* target.entry.connection.start
          }).pipe(locks.withLock(name))
        }),
        disconnect: Effect.fn("MCP.disconnect")(function* (server) {
          const name = ServerName.make(server)
          yield* Effect.gen(function* () {
            const target = yield* requireServer(name)
            yield* target.entry.connection.stop
            target.entry.status = { status: "disabled" }
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
        // Reads report what is connected now; servers still starting contribute once they publish a change.
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
        awaitStartup: Effect.fn("MCP.awaitStartup")(function* () {
          const now = yield* Clock.currentTimeMillis
          yield* Effect.all(
            Array.from(entries.values()).flatMap((entry) => {
              if (entry.status.status !== "pending" || !entry.attempt) return []
              const remaining = entry.attempt.started + STARTUP_GRACE_MS - now
              return remaining > 0 ? [entry.attempt.settled.await.pipe(Effect.raceFirst(Effect.sleep(remaining)))] : []
            }),
            { concurrency: "unbounded", discard: true },
          )
        }),
        callTool: Effect.fn("MCP.callTool")(function* (input) {
          const server = ServerName.make(input.server)
          // An attached client owns the tools it lists, even when a configured server shares its name, and
          // owns its name outright when no configured server has it.
          const client = attached.get(server)?.at(-1)
          if (client && (client.tools.some((tool) => tool.name === input.name) || !entries.has(server))) {
            const result = yield* client.client
              .callTool({ name: input.name, args: input.args, sessionID: input.sessionID })
              .pipe(
                Effect.mapError(
                  (error) =>
                    new ToolCallError({
                      server,
                      tool: input.name,
                      message: `MCP tool "${input.name}" on client "${server}" failed: ${error.message}`,
                    }),
                ),
              )
            return { ...result, server, tool: input.name }
          }
          const target = yield* requireServer(server)
          yield* target.entry.startup.await
          const connected = target.entry.connection.client
          if (!connected)
            return yield* new ToolCallError({
              server: target.name,
              tool: input.name,
              message: unavailable(target.name, target.entry.status),
            })
          const result = yield* target.entry.connection
            .recovering(connected, (connection) =>
              connection.callTool({ name: input.name, args: input.args, sessionID: input.sessionID }),
            )
            .pipe(
              Effect.mapError(
                (error) =>
                  new ToolCallError({
                    server: target.name,
                    tool: input.name,
                    message: `MCP tool "${input.name}" on server "${target.name}" failed: ${error.message}`,
                  }),
              ),
            )
          return { ...result, server: target.name, tool: input.name }
        }),
        instructions: Effect.fn("MCP.instructions")(function* () {
          return Array.from(entries)
            .flatMap(([server, entry]) => {
              const instructions = entry.connection.client?.instructions
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
          const target = yield* requireServer(ServerName.make(input.server))
          yield* target.entry.startup.await
          const client = target.entry.connection.client
          if (!client) return undefined
          const result = yield* target.entry.connection
            .recovering(client, (connection) => connection.prompt({ name: input.name, args: input.args }))
            .pipe(Effect.orElseSucceed(() => undefined))
          if (!result) return undefined
          return { ...result, server: target.name, name: input.name }
        }),
        resourceCatalog: Effect.fn("MCP.resourceCatalog")(function* () {
          const empty = ResourceCatalog.make({ resources: [], templates: [] })
          const catalogs = yield* Effect.forEach(
            Array.from(entries),
            ([name, entry]) =>
              entry.connection.client
                ? entry.connection.catalog(entry.connection.client).pipe(
                    Effect.map((catalog) => toCatalog(name, catalog)),
                    Effect.orElseSucceed(() => empty),
                  )
                : Effect.succeed(empty),
            { concurrency: "unbounded" },
          )
          return mergeCatalogs(catalogs)
        }),
        resources: Effect.fn("MCP.resources")(function* (input) {
          const target = yield* requireServer(ServerName.make(input.server))
          yield* target.entry.startup.await
          const client = target.entry.connection.client
          if (!client) return ResourceCatalog.make({ resources: [], templates: [] })
          return mergeCatalogs([toCatalog(target.name, yield* target.entry.connection.catalog(client))])
        }),
        readResource: Effect.fn("MCP.readResource")(function* (input) {
          const target = yield* requireServer(ServerName.make(input.server))
          yield* target.entry.startup.await
          const client = target.entry.connection.client
          if (!client) return undefined
          const result = yield* target.entry.connection.recovering(client, (connection) =>
            connection.readResource({ uri: input.uri }),
          )
          if (!result) return undefined
          return ResourceContent.make({
            server: target.name,
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
