export * as Mcp from "./index.js"

import { Mcp } from "@opencode/schema/mcp"
import { McpEvent } from "@opencode/schema/mcp-event"
import { ephemeral } from "@opencode/schema/event"
import type { Session } from "@opencode/schema/session"
import type { Transport } from "@modelcontextprotocol/client"
import { createHash } from "node:crypto"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import {
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Latch,
  Layer,
  Option,
  Schema,
  Scope,
  Semaphore,
  Stream,
  Types,
} from "effect"
import { FetchHttpClient } from "effect/http"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { httpFetch } from "@opencode/util/effect/app-node-platform"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Hash } from "@opencode/util/hash"
import { Credential } from "../credential.js"
import { Bus } from "../bus.js"
import { Environment } from "../environment/index.js"
import { Flag } from "../flag.js"
import { Form } from "../form.js"
import { Integration } from "../integration.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { Location } from "../location.js"
import { waitForAbort } from "@opencode/util/process"
import { State } from "../state.js"
import type { McpClient } from "./client.js"
import { McpConnection } from "./connection.js"
import { McpPool } from "./pool.js"

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

const unavailable = (server: ServerName, entry: ServerEntry) => {
  const status = entry.status
  // The model cannot reconnect a server from /mcps; one that dropped on its own reconnects on the next call.
  if (entry.disconnected)
    return `MCP server "${server}" lost its connection: ${entry.disconnected.reason}. It reconnects on the next call; try again shortly.`
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
  // Tools offered while the connection has none: the last list of a connection that dropped on its own, or the
  // disk-cached list of a server still starting. The next connect replaces it; a failure or an explicit stop drops it.
  retained?: ReadonlyArray<McpClient.Tool>
  // Set while the connection is down after dropping on its own. The next request that needs the server reconnects,
  // unless a reconnect failed and its backoff has not passed yet. An explicit lifecycle operation clears it.
  disconnected?: { failures: number; retryAt: number; reason: string }
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

// After a failed reconnect, requests fail at once for 1 s, doubling per consecutive failure up to 30 s.
const RECONNECT_BACKOFF_MS = 1_000
const RECONNECT_MAX_BACKOFF_MS = 30_000
const disconnectedError = (error: string) => `${error} (tools kept; reconnects when next used)`

// Last listed tools per server, keyed by everything that changes the connection (see `McpPool.key`).
const CachedTools = Schema.fromJsonString(
  Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        title: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
        inputSchema: Schema.StructWithRest(
          Schema.Struct({
            type: Schema.Literal("object"),
            properties: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
            required: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
          }),
          [Schema.Record(Schema.String, Schema.Unknown)],
        ),
        outputSchema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        annotations: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        execution: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        _meta: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      }),
    ),
  }),
)
const decodeCachedTools = Schema.decodeUnknownOption(CachedTools)
const encodeCachedTools = Schema.encodeSync(CachedTools)

// Bounds re-listing the tools of an attached connection that takes over the top of its stack.
const FALLBACK_LIST_TIMEOUT = "5 seconds"

// MCP elicitations are Location-scoped, not Session-scoped: the server cannot attribute them to a
// persisted session row, so their forms are owned by this opaque sentinel session identifier.
const GLOBAL_ELICITATION_SESSION_ID = "global"
const URL_ELICITATION_FIELD_KEY = "elicitation"

const changes = { tools: McpEvent.ToolsChanged, resources: McpEvent.ResourcesChanged, prompts: PromptsChanged }

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
      const fetch = yield* FetchHttpClient.Fetch
      const pool = yield* McpPool.Service
      const flags = yield* Flag.Service
      const global = yield* Global.Service
      const fsutil = yield* FSUtil.Service
      const resilient = flags.enabled("mcp_resilience")
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
      // Runs a requested lifecycle operation to the end even if its caller is interrupted, such as by a
      // client dropping the HTTP request. Stopped halfway, a server stays "pending" after a cancelled
      // connect, or "connected" with no connection after a cancelled disconnect. Location shutdown
      // still interrupts it.
      const transition = <E>(effect: Effect.Effect<void, E>) =>
        Effect.forkIn(effect, root, { startImmediately: true }).pipe(Effect.flatMap(Fiber.join))
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
                    Effect.provideService(FetchHttpClient.Fetch, fetch),
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
      // A request that needs a server disconnected on its own reconnects it first. Concurrent requests share the
      // attempt through the server lock; within the backoff after a failed attempt they get the last error at once.
      const connected = Effect.fnUntraced(function* (name: ServerName) {
        const entry = yield* requireServer(name)
        yield* entry.startup.await
        if (entry.disconnected) yield* revive(entry).pipe(locks.withLock(name))
        return { entry, client: entry.connection.client }
      })
      const revive = Effect.fnUntraced(function* (entry: ServerEntry) {
        if (entry.connection.client || !entry.disconnected) return
        if ((yield* Clock.currentTimeMillis) < entry.disconnected.retryAt) return
        yield* entry.connection.start
      })

      // The credential one start connects with: the integration's latest, or none. Read it once per start and
      // pass the result along, so anything keyed on it and the provider it builds agree on the account.
      const selectCredential = (entry: ServerEntry) =>
        entry.config.type === "remote" && entry.integrationID
          ? credentials.list(entry.integrationID).pipe(Effect.map((rows) => rows.at(-1)))
          : Effect.succeed(undefined)

      const connectProvider = Effect.fnUntraced(function* (
        entry: ServerEntry,
        credential: Credential.Info | undefined,
      ) {
        if (entry.config.type !== "remote" || !entry.integrationID) return undefined
        const { McpOAuth } = yield* Effect.promise(() => import("./oauth.js"))
        return yield* McpOAuth.connectProvider({ config: entry.config, credential }).pipe(
          Effect.provideService(Credential.Service, credentials),
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        )
      })

      // One file per connection identity, so a change to the command, URL, environment, headers or signed-in
      // account reads a different file. Secrets reach the name only as fingerprints inside a one-way hash.
      const toolsFile = Effect.fnUntraced(function* (entry: ServerEntry) {
        const credential = yield* selectCredential(entry)
        const { McpStdio } = yield* Effect.promise(() => import("./stdio.js"))
        const key = McpPool.key({
          config: entry.config,
          cwd: entry.config.type === "local" ? McpStdio.resolveCwd(location.directory, entry.config.cwd) : undefined,
          credential: credential?.id,
          clientInfo: options?.clientInfo,
        })
        return path.join(
          global.cache,
          "mcp",
          "tools",
          `${Hash.sha256(JSON.stringify([location.workspaceID, key]))}.json`,
        )
      })

      const loadTools = Effect.fnUntraced(function* (name: ServerName, entry: ServerEntry) {
        if (entry.config.disabled || !(yield* resilient)) return
        const text = yield* fsutil
          .readFileStringSafe(yield* toolsFile(entry))
          .pipe(Effect.orElseSucceed(() => undefined))
        if (text === undefined) return
        entry.retained = Option.getOrUndefined(decodeCachedTools(text))?.tools
        if (entry.retained) yield* bus.publish(McpEvent.ToolsChanged, { server: name })
      })

      const saveTools = (entry: ServerEntry) =>
        fork(
          Effect.gen(function* () {
            const tools = entry.connection.tools
            if (!tools || !(yield* resilient)) return
            yield* fsutil.writeWithDirs(yield* toolsFile(entry), encodeCachedTools({ tools }))
          }).pipe(Effect.catch((error) => Effect.logWarning("failed to cache MCP tools", { error: error.message }))),
        )

      const dropRetained = Effect.fnUntraced(function* (name: ServerName, entry: ServerEntry) {
        if (!entry.retained) return
        entry.retained = undefined
        yield* bus.publish(McpEvent.ToolsChanged, { server: name })
      })

      // A connection that went away on its own keeps offering its last tools and reports why it went; the next request
      // that needs it reconnects. Runs under the server lock.
      const drop = Effect.fnUntraced(function* (name: ServerName, entry: ServerEntry, reason: string) {
        // A shared connection has already emptied its catalogs, so fall back to the last list read from it.
        entry.retained = entry.connection.tools ?? entry.tagged?.source
        entry.disconnected = { failures: 0, retryAt: 0, reason }
        yield* entry.connection.stop
        entry.status = { status: "failed", error: disconnectedError(reason) }
        yield* Effect.logWarning("mcp connection dropped", { server: name, reason })
        yield* bus.publish(McpEvent.StatusChanged, { server: name })
      })

      const elicitation: McpClient.ElicitationHandler = {
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
            if (!field) return { action: "accept" as const, content: {} }
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
          }).pipe(
            // A shared connection runs its handlers outside this Location; forms must still belong to it.
            Effect.provideService(Location.Service, location),
          ),
        complete: (input: { readonly server: string; readonly elicitationID: string }) =>
          Effect.gen(function* () {
            const formID = urlElicitations.get(input.server + "\u0000" + input.elicitationID)
            if (!formID) return
            yield* forms.reply({ id: formID, answer: { [URL_ELICITATION_FIELD_KEY]: true } }).pipe(Effect.ignore)
          }),
      }

      const makeEntry = (name: ServerName, config: Mcp.ServerConfig, started: number): ServerEntry => {
        // Local servers run on this Location's execution plane, so only Locations on the host share them.
        const pooled =
          config.pool === true &&
          config.protocol !== "legacy" &&
          (config.type === "remote" || location.workspaceID === undefined)
        const share = (input: McpConnection.Input) =>
          pool.connection({
            ...input,
            select: Effect.gen(function* () {
              if (input.config.type === "remote") {
                const credential = yield* selectCredential(entry)
                return {
                  key: McpPool.key({ ...input, credential: credential?.id }),
                  authProvider: connectProvider(entry, credential),
                }
              }
              // Resolved exactly as the spawn resolves it, `~` included, so the key matches where the server runs.
              const { McpStdio } = yield* Effect.promise(() => import("./stdio.js"))
              return {
                key: McpPool.key({ ...input, cwd: McpStdio.resolveCwd(input.directory, input.config.cwd) }),
                authProvider: input.authProvider,
              }
            }),
          })
        const entry: ServerEntry = {
          config,
          status: { status: "pending" },
          startup: Latch.makeUnsafe(),
          attempt: { started, settled: Latch.makeUnsafe() },
          connection: (pooled ? share : McpConnection.make)({
            name,
            // Pooling offers 2026-07-28, the only revision a connection can be shared on.
            config: config.pool && config.protocol === undefined ? { ...config, protocol: "auto" } : config,
            directory: location.directory,
            clientInfo: options?.clientInfo,
            authProvider: Effect.suspend(() =>
              selectCredential(entry).pipe(Effect.flatMap((credential) => connectProvider(entry, credential))),
            ),
            elicitation,
            environment,
            fetch,
            scope: servers,
            lock: locks.withLock(name),
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
                entry.retained = undefined
                entry.disconnected = undefined
                saveTools(entry)
                yield* Effect.logInfo("mcp connected", { server: name, tools: entry.connection.tools?.length })
                // Announce every list a consumer may read, since each reads them only on these events. A
                // connection another Location already holds has loaded its prompts, and no later change
                // would tell this one; prompts still loading read empty now and announce themselves later.
                yield* bus.publish(McpEvent.ToolsChanged, { server: name })
                yield* bus.publish(McpEvent.ResourcesChanged, { server: name })
                yield* bus.publish(PromptsChanged, { server: name })
                yield* bus.publish(McpEvent.StatusChanged, { server: name })
              }),
              failed: (failure) =>
                Effect.gen(function* () {
                  // A failed reconnect keeps the tools and backs off; an auth failure drops them like any other.
                  const disconnected = entry.disconnected
                  if (disconnected && failure.status === "failed") {
                    disconnected.failures += 1
                    disconnected.reason = failure.error
                    disconnected.retryAt =
                      (yield* Clock.currentTimeMillis) +
                      Math.min(
                        RECONNECT_BACKOFF_MS * 2 ** Math.min(disconnected.failures - 1, 5),
                        RECONNECT_MAX_BACKOFF_MS,
                      )
                    entry.status = { status: "failed", error: disconnectedError(failure.error) }
                    yield* Effect.logWarning("mcp reconnect failed", { server: name, error: failure.error })
                    return yield* bus.publish(McpEvent.StatusChanged, { server: name })
                  }
                  entry.status = failure
                  entry.disconnected = undefined
                  yield* Effect.logWarning("mcp connect failed", { server: name, status: entry.status })
                  yield* bus.publish(McpEvent.StatusChanged, { server: name })
                  yield* dropRetained(name, entry)
                }),
              // Every start runs under the server lock, so the attempt read here is the one it began.
              settled: Effect.suspend(() => {
                const attempt = entry.attempt
                entry.attempt = undefined
                return (attempt ? attempt.settled.open : Effect.void).pipe(Effect.ensuring(entry.startup.open))
              }),
              closed: (reason) =>
                Effect.gen(function* () {
                  if (yield* resilient) return yield* drop(name, entry, reason)
                  entry.status = { status: "failed", error: reason }
                  yield* entry.connection.stop
                  yield* bus.publish(McpEvent.StatusChanged, { server: name })
                }),
              // The request that found the session expired needs the server now, so it reconnects at once.
              expired: Effect.gen(function* () {
                if (!(yield* resilient)) return false
                yield* drop(name, entry, "MCP session expired")
                yield* revive(entry)
                return true
              }),
              changed: (kind) => {
                if (kind === "tools") saveTools(entry)
                return bus.publish(changes[kind], { server: name })
              },
            },
          }),
        }
        return entry
      }

      // MCP.tools() runs every step and the tool registry compares tools by identity, so tag the
      // connection's list once per listing instead of on every read.
      const serverTools = (name: ServerName, entry: ServerEntry) => {
        const source = entry.connection.tools ?? entry.retained
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

      const disposeServer = Effect.fnUntraced(function* (name: ServerName, entry: ServerEntry) {
        entry.disconnected = undefined
        yield* entry.connection.stop
        yield* dropRetained(name, entry)
        if (entry.registration) yield* entry.registration.dispose
      })

      const replaceServer = Effect.fnUntraced(function* (name: ServerName, serverConfig: Mcp.ServerConfig) {
        const previous = entries.get(name)
        if (previous) yield* disposeServer(name, previous)
        const entry = makeEntry(name, serverConfig, yield* Clock.currentTimeMillis)
        entries.set(name, entry)
        yield* Effect.gen(function* () {
          yield* register(name, entry)
          yield* loadTools(name, entry)
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

      const removeServer = Effect.fnUntraced(function* (name: ServerName, entry: ServerEntry) {
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
        const result = yield* McpClient.connect({
          server: name,
          config: { type: "attached", transport },
          directory: location.directory,
          elicitation,
          clientInfo: options?.clientInfo,
        }).pipe(
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
          // Read before any connection starts, so the first step already offers the cached tools.
          yield* Effect.forEach(entries, ([name, entry]) => loadTools(name, entry), {
            concurrency: "unbounded",
            discard: true,
          })

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
            entry.disconnected = undefined
            yield* entry.connection.stop
            yield* entry.connection.start
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
          yield* transition(
            Effect.gen(function* () {
              const entry = yield* requireServer(name)
              entry.disconnected = undefined
              yield* entry.connection.stop
              yield* entry.connection.start
            }).pipe(locks.withLock(name)),
          )
        }),
        disconnect: Effect.fn("MCP.disconnect")(function* (server) {
          const name = ServerName.make(server)
          yield* transition(
            Effect.gen(function* () {
              const entry = yield* requireServer(name)
              entry.disconnected = undefined
              yield* entry.connection.stop
              entry.status = { status: "disabled" }
              yield* bus.publish(McpEvent.StatusChanged, { server: name })
              yield* dropRetained(name, entry)
            }).pipe(locks.withLock(name)),
          )
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
              // A server offering retained or cached tools has something to show; the step need not wait for it.
              if (entry.status.status !== "pending" || !entry.attempt || entry.retained) return []
              const remaining = entry.attempt.started + STARTUP_GRACE_MS - now
              return remaining > 0 ? [entry.attempt.settled.await.pipe(Effect.raceFirst(Effect.sleep(remaining)))] : []
            }),
            { concurrency: "unbounded", discard: true },
          )
        }),
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
          // owns its name outright when no configured server has it.
          const client = attached.get(server)?.at(-1)
          if (client && (client.tools.some((tool) => tool.name === input.name) || !entries.has(server)))
            return yield* call(client.client).pipe(failed("client"))
          const target = yield* connected(server)
          if (!target.client)
            return yield* new ToolCallError({
              server,
              tool: input.name,
              message: unavailable(server, target.entry),
            })
          return yield* target.entry.connection.recovering(target.client, call).pipe(failed("server"))
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
          const target = yield* connected(ServerName.make(input.server))
          if (!target.client) return undefined
          return yield* target.entry.connection
            .recovering(target.client, (connection) => connection.prompt({ name: input.name, args: input.args }))
            .pipe(Effect.orElseSucceed(() => undefined))
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
          const name = ServerName.make(input.server)
          const target = yield* connected(name)
          if (!target.client) return ResourceCatalog.make({ resources: [], templates: [] })
          return mergeCatalogs([toCatalog(name, yield* target.entry.connection.catalog(target.client))])
        }),
        readResource: Effect.fn("MCP.readResource")(function* (input) {
          const name = ServerName.make(input.server)
          const target = yield* connected(name)
          if (!target.client) return undefined
          const result = yield* target.entry.connection.recovering(target.client, (connection) =>
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
    deps: [
      Location.node,
      Environment.node,
      Bus.node,
      Form.node,
      Integration.node,
      Credential.node,
      Flag.node,
      Global.node,
      FSUtil.node,
      httpFetch,
      McpPool.node,
    ],
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
