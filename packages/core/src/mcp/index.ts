export * as MCP from "./index"

import { Mcp } from "@opencode-ai/schema/mcp"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Command } from "@opencode-ai/schema/command"
import { createHash } from "node:crypto"
import { Cause, Context, Deferred, Effect, Exit, FiberSet, Layer, Schema, Scope, Stream } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Config } from "../config"
import { ConfigMCP } from "../config/mcp"
import { Credential } from "../credential"
import { EventV2 } from "../event"
import { Form } from "../form"
import { Integration } from "../integration"
import { IntegrationConnection } from "../integration/connection"
import { KeyedMutex } from "../effect/keyed-mutex"
import { Location } from "../location"
import { waitForAbort } from "../process"
import { State } from "../state"
import { MCPClient } from "./client"
import { MCPOAuth } from "./oauth"

export const ServerName = Schema.String.pipe(Schema.brand("MCP.ServerName"))
export type ServerName = typeof ServerName.Type

// The status union is a public wire contract, so it lives in @opencode-ai/schema and is re-exported here.
export const Status = Mcp.Status
export type Status = Mcp.Status

export class ServerInfo extends Schema.Class<ServerInfo>("MCP.ServerInfo")({
  name: ServerName,
  status: Status,
  integrationID: Integration.ID.pipe(Schema.optional),
  connection: IntegrationConnection.Info.pipe(Schema.optional),
}) {}

export class ServerInstructions extends Schema.Class<ServerInstructions>("MCP.ServerInstructions")({
  server: ServerName,
  instructions: Schema.String,
}) {}

export class Tool extends Schema.Class<Tool>("MCP.Tool")({
  server: ServerName,
  name: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  inputSchema: Schema.Unknown.pipe(Schema.optional),
  outputSchema: Schema.Unknown.pipe(Schema.optional),
}) {}

export const ToolResultContent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("media"), data: Schema.String, mimeType: Schema.String }),
]).pipe(Schema.toTaggedUnion("type"))
export type ToolResultContent = typeof ToolResultContent.Type

export class ToolResult extends Schema.Class<ToolResult>("MCP.ToolResult")({
  server: ServerName,
  tool: Schema.String,
  isError: Schema.Boolean,
  structured: Schema.Unknown.pipe(Schema.optional),
  content: Schema.Array(ToolResultContent),
}) {}

export class PromptArgument extends Schema.Class<PromptArgument>("MCP.PromptArgument")({
  name: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  required: Schema.Boolean.pipe(Schema.optional),
}) {}

export class Prompt extends Schema.Class<Prompt>("MCP.Prompt")({
  server: ServerName,
  name: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  arguments: Schema.Array(PromptArgument).pipe(Schema.optional),
}) {}

export class PromptMessage extends Schema.Class<PromptMessage>("MCP.PromptMessage")({
  role: Schema.String,
  content: Schema.Unknown,
}) {}

export class PromptResult extends Schema.Class<PromptResult>("MCP.PromptResult")({
  server: ServerName,
  name: Schema.String,
  messages: Schema.Array(PromptMessage),
}) {}

export const Resource = Mcp.Resource
export type Resource = Mcp.Resource
export const ResourceTemplate = Mcp.ResourceTemplate
export type ResourceTemplate = Mcp.ResourceTemplate
export const ResourceCatalog = Mcp.ResourceCatalog
export type ResourceCatalog = Mcp.ResourceCatalog
export const ResourceContentPart = Mcp.ResourceContentPart
export type ResourceContentPart = Mcp.ResourceContentPart
export const ResourceContent = Mcp.ResourceContent
export type ResourceContent = Mcp.ResourceContent

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("MCP.NotFoundError", {
  server: ServerName,
}) {
  override get message() {
    return `MCP server not found: ${this.server}`
  }
}

export class ToolCallError extends Schema.TaggedErrorClass<ToolCallError>()("MCP.ToolCallError", {
  server: ServerName,
  tool: Schema.String,
  message: Schema.String,
}) {}

type ServerEntry = {
  readonly config: typeof ConfigMCP.Server.Type
  status: Status
  readonly startup: Deferred.Deferred<void>
  scope?: Scope.Closeable
  client?: MCPClient.Connection
  tools?: ReadonlyArray<Tool>
  prompts?: ReadonlyArray<Prompt>
  // Set when a remote server is registered as an OAuth integration; the credential lives in the global store.
  integrationID?: Integration.ID
  registration?: State.Registration
}

// MCP elicitations are Location-scoped, not Session-scoped: the server cannot attribute them to a
// persisted session row, so their forms are owned by this opaque sentinel session identifier.
const GLOBAL_ELICITATION_SESSION_ID = "global"
const URL_ELICITATION_FIELD_KEY = "elicitation"

export interface Interface {
  readonly servers: () => Effect.Effect<ServerInfo[]>
  readonly add: (server: ServerName | string, config: typeof ConfigMCP.Server.Type) => Effect.Effect<void>
  readonly connect: (server: ServerName | string) => Effect.Effect<void, NotFoundError>
  readonly disconnect: (server: ServerName | string) => Effect.Effect<void, NotFoundError>
  readonly remove: (server: ServerName | string) => Effect.Effect<void, NotFoundError>
  readonly tools: () => Effect.Effect<Tool[]>
  readonly callTool: (input: {
    readonly server: ServerName | string
    readonly name: string
    readonly args?: Record<string, unknown>
  }) => Effect.Effect<ToolResult, NotFoundError | ToolCallError>
  readonly instructions: () => Effect.Effect<ServerInstructions[]>
  readonly prompts: () => Effect.Effect<Prompt[]>
  readonly prompt: (input: {
    readonly server: ServerName | string
    readonly name: string
    readonly args?: Record<string, string>
  }) => Effect.Effect<PromptResult | undefined, NotFoundError>
  readonly resourceCatalog: () => Effect.Effect<ResourceCatalog>
  readonly readResource: (input: {
    readonly server: ServerName | string
    readonly uri: string
  }) => Effect.Effect<ResourceContent | undefined, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/MCP") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const location = yield* Location.Service
    const events = yield* EventV2.Service
    const forms = yield* Form.Service
    const integration = yield* Integration.Service
    const credentials = yield* Credential.Service
    const root = yield* Scope.make()
    const fork = yield* FiberSet.makeRuntime<never, void, never>()
    yield* Effect.addFinalizer((exit) => Scope.close(root, exit))

    const documents = (yield* config.entries()).filter((entry): entry is Config.Document => entry.type === "document")
    // Global MCP timeout defaults, later config files overriding earlier ones.
    const timeout = Object.assign(
      {},
      ...documents.flatMap((entry) => (entry.info.mcp?.timeout ? [entry.info.mcp.timeout] : [])),
    )
    // Later config files win for duplicate server names; per-server timeout overrides globals.
    const runtime = new Map<ServerName, ServerEntry>()
    // Serializes lifecycle operations per server. Anything taking this lock from a connection
    // callback must stay forked: lifecycle operations close scopes while holding it, firing onClose.
    const locks = KeyedMutex.makeUnsafe<ServerName>()
    const urlElicitations = new Map<string, Form.ID>()
    for (const entry of documents) {
      for (const [name, server] of Object.entries(entry.info.mcp?.servers ?? {})) {
        runtime.set(ServerName.make(name), {
          config: { ...server, timeout: { ...timeout, ...server.timeout } },
          status: { status: "pending" },
          startup: Deferred.makeUnsafe<void>(),
        })
      }
    }

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
      entry.registration = yield* integration
        .transform((draft) => {
          draft.update(integrationID, (ref) => {
            ref.name = name
          })
          draft.method.update({
            integrationID,
            method: { id: methodID, type: "oauth", label: name },
            authorize: () => MCPOAuth.authorize({ name, config: remote, methodID }),
          })
        })
        .pipe(Scope.provide(root))
    })
    yield* Effect.forEach(runtime, ([name, entry]) => register(name, entry), { discard: true })

    const requireServer = Effect.fnUntraced(function* (server: ServerName | string) {
      const name = ServerName.make(server)
      const entry = runtime.get(name)
      if (!entry) return yield* new NotFoundError({ server: name })
      return { name, entry }
    })

    const info = (name: ServerName, entry: ServerEntry, connection: IntegrationConnection.Info | undefined) =>
      new ServerInfo({
        name,
        status: entry.status,
        integrationID: entry.integrationID,
        connection,
      })

    // Builds the connect-time auth provider for a remote OAuth-integration server. The SDK presents and
    // refreshes stored tokens, persisting refreshes back to the same credential row. The provider never
    // opens a browser, so an auth-gated connect ends in UnauthorizedError -> needs_auth rather than a redirect.
    const connectProvider = Effect.fnUntraced(function* (entry: ServerEntry) {
      if (entry.config.type !== "remote" || !entry.integrationID) return undefined
      const remote = entry.config
      const oauth = remote.oauth || undefined
      const base = {
        redirectUrl: oauth?.redirect_uri ?? "http://127.0.0.1/callback",
        scope: oauth?.scope,
        client: oauth?.client_id ? { id: oauth.client_id, secret: oauth.client_secret } : undefined,
        // No browser during connect: an auth-gated server surfaces needs_auth instead of opening a browser.
        onRedirect: () => {},
      }
      const stored = yield* credentials.list(entry.integrationID)
      const found = stored.find((credential) => credential.value.type === "oauth")
      if (!found || found.value.type !== "oauth")
        // No stored credential yet: an empty in-memory store still lets the SDK run the auth handshake, which
        // ends in UnauthorizedError -> needs_auth. Returning no provider instead would let the transport throw
        // a raw HTTP error, hiding the auth requirement behind a generic failed status. Anonymous servers are
        // unaffected: tokens() returns undefined, so no auth header is sent and the SDK never calls auth().
        return MCPOAuth.provider({ ...base, store: MCPOAuth.memoryStore() })
      const credentialID = found.id
      const methodID = found.value.methodID
      let current: Credential.OAuth | undefined = found.value
      return MCPOAuth.provider({
        ...base,
        // Drop a credential the SDK rejected so the next connect cleanly reports needs_auth. Uses the raw
        // credential service (no integration event) to avoid re-triggering the reconnect subscriber mid-connect.
        invalidate: async (scope) => {
          if (scope === "verifier" || scope === "discovery") return
          current = undefined
          await Effect.runPromise(credentials.remove(credentialID))
        },
        store: {
          tokens: async () => (current ? MCPOAuth.toTokens(current) : undefined),
          saveTokens: async (tokens) => {
            current = MCPOAuth.toCredential({
              methodID,
              serverUrl: remote.url,
              tokens,
              client: current ? MCPOAuth.clientFromCredential(current) : undefined,
            })
            await Effect.runPromise(credentials.update(credentialID, { value: current }))
          },
          clientInformation: async () => (current ? MCPOAuth.clientFromCredential(current) : undefined),
          saveClientInformation: async () => {},
          codeVerifier: async () => undefined,
          saveCodeVerifier: async () => {},
        },
      })
    })

    const elicitation = {
      create: (input: {
        readonly server: string
        readonly params: MCPClient.ElicitationParams
        readonly signal: AbortSignal
      }) =>
        Effect.gen(function* () {
          if (input.params.mode === "url") {
            const formID = Form.ID.create()
            const key = input.server + "\u0000" + input.params.elicitationId
            urlElicitations.set(key, formID)
            return yield* forms
              .ask({
                id: formID,
                sessionID: GLOBAL_ELICITATION_SESSION_ID,
                title: `${input.server} is requesting input`,
                metadata: {
                  kind: "mcp-elicitation",
                  server: input.server,
                  elicitationID: input.params.elicitationId,
                  message: input.params.message,
                },
                fields: [{ key: URL_ELICITATION_FIELD_KEY, type: "external", url: input.params.url }],
              })
              .pipe(
                Effect.raceFirst(waitForAbort(input.signal)),
                Effect.ensuring(Effect.sync(() => urlElicitations.delete(key))),
                Effect.map(
                  (state): MCPClient.ElicitationResult => ({
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
              Effect.map((state): MCPClient.ElicitationResult => {
                if (state.status !== "answered") return { action: "cancel" }
                return {
                  action: "accept",
                  content: Object.fromEntries(
                    Object.entries(state.answer).map(
                      ([key, value]): [string, NonNullable<MCPClient.ElicitationResult["content"]>[string]] =>
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
    } satisfies MCPClient.ElicitationHandler

    const toTool = (server: ServerName, def: MCPClient.ToolDefinition) =>
      new Tool({
        server,
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        outputSchema: def.outputSchema,
      })

    const toPrompt = (server: ServerName, def: MCPClient.PromptDefinition) =>
      new Prompt({
        server,
        name: def.name,
        description: def.description,
        arguments: def.arguments?.map(
          (argument) =>
            new PromptArgument({
              name: argument.name,
              description: argument.description,
              required: argument.required,
            }),
        ),
      })

    const toResource = (server: ServerName, def: MCPClient.ResourceDefinition) =>
      Resource.make({
        server,
        name: def.name,
        uri: def.uri,
        description: def.description,
        mimeType: def.mimeType,
      })

    const toResourceTemplate = (server: ServerName, def: MCPClient.ResourceTemplateDefinition) =>
      ResourceTemplate.make({
        server,
        name: def.name,
        uriTemplate: def.uriTemplate,
        description: def.description,
        mimeType: def.mimeType,
      })

    const refreshTools = (name: ServerName, entry: ServerEntry, connection: MCPClient.Connection) =>
      connection.tools().pipe(
        Effect.map((defs) => {
          entry.tools = defs.map((def) => toTool(name, def))
        }),
      )

    const refreshPrompts = (name: ServerName, entry: ServerEntry, connection: MCPClient.Connection) =>
      connection.prompts().pipe(
        Effect.map((defs) => {
          entry.prompts = defs.map((def) => toPrompt(name, def))
        }),
        Effect.andThen(events.publish(Command.Event.Updated, {})),
        Effect.catch(() =>
          Effect.sync(() => (entry.prompts = [])).pipe(Effect.andThen(events.publish(Command.Event.Updated, {}))),
        ),
      )

    // Runs a connection callback under the server lock, dropping it if the connection is no longer
    // the entry's live client, so late SDK callbacks cannot commit obsolete state.
    const whenLive =
      (name: ServerName, entry: ServerEntry, connection: MCPClient.Connection) =>
      <E>(effect: Effect.Effect<void, E>) =>
        fork(
          Effect.suspend(() => (entry.client === connection ? effect : Effect.void)).pipe(
            locks.withLock(name),
            Effect.ignore,
          ),
        )

    const watch = (name: ServerName, entry: ServerEntry, connection: MCPClient.Connection) => {
      const live = whenLive(name, entry, connection)
      connection.onClose(() =>
        live(
          Effect.gen(function* () {
            entry.client = undefined
            entry.tools = undefined
            entry.prompts = undefined
            entry.status = { status: "failed", error: "Connection closed" }
            yield* events.publish(McpEvent.ToolsChanged, { server: name }).pipe(Effect.ignore)
            yield* events.publish(McpEvent.ResourcesChanged, { server: name }).pipe(Effect.ignore)
            yield* events.publish(Command.Event.Updated, {}).pipe(Effect.ignore)
            yield* events.publish(McpEvent.StatusChanged, { server: name }).pipe(Effect.ignore)
          }),
        ),
      )
      connection.onLog((message) => fork(serverLog(name, message).pipe(Effect.ignore)))
      connection.onToolsChanged(() =>
        live(
          refreshTools(name, entry, connection).pipe(
            Effect.andThen(events.publish(McpEvent.ToolsChanged, { server: name })),
          ),
        ),
      )
      connection.onPromptsChanged(() => live(refreshPrompts(name, entry, connection)))
      connection.onResourcesChanged(() => live(events.publish(McpEvent.ResourcesChanged, { server: name })))
    }

    const serverLog = (server: ServerName, message: MCPClient.LogMessage) => {
      const fields = { server, logger: message.logger, level: message.level, data: message.data }
      switch (message.level) {
        case "debug":
          return Effect.logDebug("MCP server log", fields)
        case "info":
        case "notice":
          return Effect.logInfo("MCP server log", fields)
        case "warning":
          return Effect.logWarning("MCP server log", fields)
        case "error":
        case "critical":
        case "alert":
        case "emergency":
          return Effect.logError("MCP server log", fields)
      }
    }

    const startServer = (name: ServerName, entry: ServerEntry) =>
      Effect.gen(function* () {
        // Announce the handshake so connect() and credential reconnects don't show a stale
        // disabled/failed status for the duration of the connection attempt.
        entry.status = { status: "pending" }
        yield* events.publish(McpEvent.StatusChanged, { server: name }).pipe(Effect.ignore)
        const scope = yield* Scope.fork(root)
        entry.scope = scope
        const authProvider = yield* connectProvider(entry)
        // List tools as part of connect so a failure here marks the server failed rather than
        // leaving it connected with a silently empty tool list and no path to recover.
        const result = yield* MCPClient.connect(name, entry.config, location.directory, authProvider, elicitation).pipe(
          Effect.flatMap((connection) => connection.tools().pipe(Effect.map((tools) => ({ connection, tools })))),
          Scope.provide(scope),
          Effect.exit,
        )
        if (Exit.isSuccess(result)) {
          entry.client = result.value.connection
          entry.tools = result.value.tools.map((def) => toTool(name, def))
          entry.prompts = []
          entry.status = { status: "connected" }
          watch(name, entry, result.value.connection)
          yield* Effect.logInfo("mcp connected", { server: name, tools: entry.tools.length })
          // Announce the new tool set so the tool registry registers it. A server that finishes connecting
          // after the initial registration sweep and emits no list-changed notification would otherwise
          // stay invisible to the model.
          yield* events.publish(McpEvent.ToolsChanged, { server: name }).pipe(Effect.ignore)
          yield* events.publish(McpEvent.ResourcesChanged, { server: name }).pipe(Effect.ignore)
          yield* events.publish(McpEvent.StatusChanged, { server: name }).pipe(Effect.ignore)
          whenLive(name, entry, result.value.connection)(refreshPrompts(name, entry, result.value.connection))
          return
        }
        yield* Scope.close(scope, Exit.void)
        entry.scope = undefined
        const error = Cause.squash(result.cause)
        entry.status =
          error instanceof MCPClient.NeedsAuthError
            ? { status: "needs_auth" }
            : { status: "failed", error: error instanceof Error ? error.message : String(error) }
        yield* Effect.logWarning("mcp connect failed", { server: name, status: entry.status })
        yield* events.publish(McpEvent.StatusChanged, { server: name }).pipe(Effect.ignore)
      }).pipe(Effect.ensuring(Deferred.succeed(entry.startup, undefined)))

    const stopServer = Effect.fnUntraced(function* (name: ServerName, entry: ServerEntry) {
      const scope = entry.scope
      if (!scope) return
      entry.scope = undefined
      entry.client = undefined
      entry.tools = undefined
      entry.prompts = undefined
      yield* Scope.close(scope, Exit.void)
      yield* events.publish(McpEvent.ToolsChanged, { server: name }).pipe(Effect.ignore)
      yield* events.publish(McpEvent.ResourcesChanged, { server: name }).pipe(Effect.ignore)
      yield* events.publish(Command.Event.Updated, {}).pipe(Effect.ignore)
    })

    // Disabled servers settle their startup immediately so queries never block on them.
    for (const [name, entry] of runtime) {
      if (entry.config.disabled) {
        entry.status = { status: "disabled" }
        Deferred.doneUnsafe(entry.startup, Exit.void)
        continue
      }
      fork(startServer(name, entry).pipe(locks.withLock(name)))
    }

    // Bring a server online (or back to needs_auth) when its integration's credential changes, so an
    // OAuth login takes effect without a restart. Only fires for the integrations we registered.
    const reconnect = (integrationID: Integration.ID) =>
      Effect.gen(function* () {
        const match = Array.from(runtime).find(([, entry]) => entry.integrationID === integrationID)
        if (!match) return
        const name = match[0]
        yield* Effect.gen(function* () {
          // add() or remove() may have replaced or deleted the entry while we waited for the lock.
          const entry = runtime.get(name)
          if (!entry || entry.integrationID !== integrationID) return
          if (entry.status.status === "disabled") return
          yield* stopServer(name, entry)
          yield* startServer(name, entry)
        }).pipe(locks.withLock(name))
      })
    fork(
      events.subscribe(Integration.Event.ConnectionUpdated).pipe(
        Stream.filter((event) => owned.has(event.data.integrationID)),
        Stream.runForEach((event) => Effect.sync(() => fork(reconnect(event.data.integrationID)))),
        Effect.ignore,
      ),
    )

    // Suspend so each await sees current entries; a bare Map iterator is exhausted after one run.
    const whenAllReady = Effect.suspend(() =>
      Effect.forEach(Array.from(runtime.values()), (entry) => Deferred.await(entry.startup), {
        concurrency: "unbounded",
        discard: true,
      }),
    )
    return Service.of({
      servers: Effect.fn("MCP.servers")(function* () {
        const entries = Array.from(runtime).toSorted(([a], [b]) => a.localeCompare(b))
        return yield* Effect.forEach(entries, ([name, entry]) =>
          Effect.gen(function* () {
            const connection = entry.integrationID
              ? yield* integration.connection.active(entry.integrationID)
              : undefined
            return info(name, entry, connection)
          }),
        )
      }),
      add: Effect.fn("MCP.add")(function* (server, config) {
        const name = ServerName.make(server)
        yield* Effect.gen(function* () {
          const previous = runtime.get(name)
          if (previous) {
            yield* stopServer(name, previous)
            if (previous.integrationID) owned.delete(previous.integrationID)
            if (previous.registration) yield* previous.registration.dispose
          }
          const entry: ServerEntry = {
            config: { ...config, timeout: { ...timeout, ...config.timeout } },
            status: { status: "pending" },
            startup: Deferred.makeUnsafe<void>(),
          }
          runtime.set(name, entry)
          yield* Effect.gen(function* () {
            yield* register(name, entry)
            if (config.disabled) {
              entry.status = { status: "disabled" }
              yield* events.publish(McpEvent.StatusChanged, { server: name }).pipe(Effect.ignore)
              return
            }
            yield* startServer(name, entry)
          }).pipe(
            // Settle startup even when register fails or add is interrupted, so an entry that made it
            // into runtime can never hang readers awaiting its startup.
            Effect.ensuring(Effect.sync(() => Deferred.doneUnsafe(entry.startup, Exit.void))),
          )
        }).pipe(locks.withLock(name))
      }),
      connect: Effect.fn("MCP.connect")(function* (server) {
        const name = ServerName.make(server)
        yield* Effect.gen(function* () {
          const target = yield* requireServer(name)
          yield* stopServer(name, target.entry)
          yield* startServer(name, target.entry)
        }).pipe(locks.withLock(name))
      }),
      disconnect: Effect.fn("MCP.disconnect")(function* (server) {
        const name = ServerName.make(server)
        yield* Effect.gen(function* () {
          const target = yield* requireServer(name)
          yield* stopServer(name, target.entry)
          target.entry.status = { status: "disabled" }
          yield* events.publish(McpEvent.StatusChanged, { server: name }).pipe(Effect.ignore)
        }).pipe(locks.withLock(name))
      }),
      remove: Effect.fn("MCP.remove")(function* (server) {
        const name = ServerName.make(server)
        yield* Effect.gen(function* () {
          const target = yield* requireServer(name)
          yield* stopServer(name, target.entry)
          if (target.entry.integrationID) owned.delete(target.entry.integrationID)
          if (target.entry.registration) yield* target.entry.registration.dispose
          // Credentials are kept: they are keyed by name + url, so re-adding the same server
          // reuses them without forcing re-auth, matching add()'s replacement semantics.
          runtime.delete(name)
          yield* events.publish(McpEvent.StatusChanged, { server: name }).pipe(Effect.ignore)
        }).pipe(locks.withLock(name))
      }),
      tools: Effect.fn("MCP.tools")(function* () {
        yield* whenAllReady
        return Array.from(runtime.values())
          .flatMap((entry) => entry.tools ?? [])
          .toSorted((a, b) => a.server.localeCompare(b.server) || a.name.localeCompare(b.name))
      }),
      callTool: Effect.fn("MCP.callTool")(function* (input) {
        const target = yield* requireServer(input.server)
        yield* Deferred.await(target.entry.startup)
        if (!target.entry.client)
          return yield* new ToolCallError({
            server: target.name,
            tool: input.name,
            message: "MCP server is not connected",
          })
        const result = yield* target.entry.client
          .callTool({ name: input.name, args: input.args })
          .pipe(
            Effect.mapError(
              (error) => new ToolCallError({ server: target.name, tool: input.name, message: error.message }),
            ),
          )
        return new ToolResult({
          server: target.name,
          tool: input.name,
          isError: result.isError,
          structured: result.structured,
          content: result.content,
        })
      }),
      instructions: Effect.fn("MCP.instructions")(function* () {
        yield* whenAllReady
        return Array.from(runtime)
          .flatMap(([server, entry]) => {
            const instructions = entry.client?.instructions
            if (!instructions) return []
            return [new ServerInstructions({ server, instructions })]
          })
          .toSorted((a, b) => a.server.localeCompare(b.server))
      }),
      prompts: Effect.fn("MCP.prompts")(function* () {
        return Array.from(runtime.values())
          .flatMap((entry) => entry.prompts ?? [])
          .toSorted((a, b) => a.server.localeCompare(b.server) || a.name.localeCompare(b.name))
      }),
      prompt: Effect.fn("MCP.prompt")(function* (input) {
        const target = yield* requireServer(input.server)
        yield* Deferred.await(target.entry.startup)
        if (!target.entry.client) return undefined
        const result = yield* target.entry.client
          .prompt({ name: input.name, args: input.args })
          .pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!result) return undefined
        return new PromptResult({
          server: target.name,
          name: input.name,
          messages: result.messages.map(
            (message) => new PromptMessage({ role: message.role, content: message.content }),
          ),
        })
      }),
      resourceCatalog: Effect.fn("MCP.resourceCatalog")(function* () {
        yield* whenAllReady
        const catalogs = yield* Effect.forEach(
          Array.from(runtime),
          ([name, entry]) => {
            if (!entry.client) return Effect.succeed({ resources: [], templates: [] })
            return Effect.all(
              {
                resources: entry.client.resources().pipe(Effect.catch(() => Effect.succeed([]))),
                templates: entry.client.resourceTemplates().pipe(Effect.catch(() => Effect.succeed([]))),
              },
              { concurrency: "unbounded" },
            ).pipe(
              Effect.map((catalog) => ({
                resources: catalog.resources.map((def) => toResource(name, def)),
                templates: catalog.templates.map((def) => toResourceTemplate(name, def)),
              })),
            )
          },
          { concurrency: "unbounded" },
        )
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
      }),
      readResource: Effect.fn("MCP.readResource")(function* (input) {
        const target = yield* requireServer(input.server)
        yield* Deferred.await(target.entry.startup)
        if (!target.entry.client) return undefined
        const result = yield* target.entry.client
          .readResource({ uri: input.uri })
          .pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!result) return undefined
        return ResourceContent.make({
          server: target.name,
          uri: input.uri,
          contents: result.contents,
        })
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, Location.node, EventV2.node, Form.node, Integration.node, Credential.node],
})

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

type ElicitationProperty = MCPClient.ElicitationFormParams["requestedSchema"]["properties"][string]
