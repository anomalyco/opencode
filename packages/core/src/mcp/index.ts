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
import { Integration } from "../integration"
import { IntegrationConnection } from "../integration/connection"
import { Location } from "../location"
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

export class Resource extends Schema.Class<Resource>("MCP.Resource")({
  server: ServerName,
  name: Schema.String,
  uri: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  mimeType: Schema.String.pipe(Schema.optional),
}) {}

export class ResourceTemplate extends Schema.Class<ResourceTemplate>("MCP.ResourceTemplate")({
  server: ServerName,
  name: Schema.String,
  uriTemplate: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  mimeType: Schema.String.pipe(Schema.optional),
}) {}

export class ResourceCatalog extends Schema.Class<ResourceCatalog>("MCP.ResourceCatalog")({
  resources: Schema.Array(Resource),
  templates: Schema.Array(ResourceTemplate),
}) {}

export const ResourceContentPart = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    uri: Schema.String,
    text: Schema.String,
    mimeType: Schema.String.pipe(Schema.optional),
  }),
  Schema.Struct({
    type: Schema.Literal("blob"),
    uri: Schema.String,
    blob: Schema.String,
    mimeType: Schema.String.pipe(Schema.optional),
  }),
]).pipe(Schema.toTaggedUnion("type"))
export type ResourceContentPart = typeof ResourceContentPart.Type

export class ResourceContent extends Schema.Class<ResourceContent>("MCP.ResourceContent")({
  server: ServerName,
  uri: Schema.String,
  contents: Schema.Array(ResourceContentPart),
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("MCP.NotFoundError", {
  server: ServerName,
}) {}

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
}

export interface Interface {
  readonly servers: () => Effect.Effect<ServerInfo[]>
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
    for (const entry of documents) {
      for (const [name, server] of Object.entries(entry.info.mcp?.servers ?? {})) {
        runtime.set(ServerName.make(name), {
          config: { ...server, timeout: { ...timeout, ...server.timeout } },
          status: { status: "disconnected" },
          startup: Deferred.makeUnsafe<void>(),
        })
      }
    }

    // Register every remote server as an OAuth integration so credentials live in the global store
    // rather than in committed config. Servers that connect anonymously simply never use the method.
    const registrations: Array<{
      readonly name: ServerName
      readonly remote: typeof ConfigMCP.Remote.Type
      readonly integrationID: Integration.ID
      readonly methodID: Integration.MethodID
    }> = []
    for (const [name, entry] of runtime) {
      if (entry.config.type !== "remote" || entry.config.oauth === false) continue
      const remote = entry.config
      // Key identity on name + url, not url alone: two configs for the same url under different names are
      // distinct logical servers that may hold different accounts, so they must not share a credential row.
      const suffix =
        "mcp_" +
        createHash("sha1")
          .update(name + "\u0000" + remote.url)
          .digest("hex")
          .slice(0, 16)
      entry.integrationID = Integration.ID.make(suffix)
      registrations.push({
        name,
        remote,
        integrationID: entry.integrationID,
        methodID: Integration.MethodID.make(suffix),
      })
    }
    if (registrations.length > 0)
      yield* integration.transform((draft) => {
        for (const reg of registrations) {
          draft.update(reg.integrationID, (ref) => {
            ref.name = reg.name
          })
          draft.method.update({
            integrationID: reg.integrationID,
            method: { id: reg.methodID, type: "oauth", label: reg.name },
            authorize: () => MCPOAuth.authorize({ name: reg.name, config: reg.remote, methodID: reg.methodID }),
          })
        }
      })

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

    const toTool = (server: ServerName, def: MCPClient.ToolDefinition) =>
      new Tool({ server, name: def.name, description: def.description, inputSchema: def.inputSchema })

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

    const watch = (name: ServerName, entry: ServerEntry, connection: MCPClient.Connection) => {
      connection.onClose(() => {
        // A reconnect closes the previous scope, but the SDK may fire this onclose after the new
        // connection is already assigned; ignore the stale close so it can't null out the live client.
        if (entry.client !== connection) return
        entry.client = undefined
        entry.tools = undefined
        entry.prompts = undefined
        entry.status = { status: "failed", error: "Connection closed" }
        fork(events.publish(McpEvent.ToolsChanged, { server: name }).pipe(Effect.ignore))
        fork(events.publish(Command.Event.Updated, {}).pipe(Effect.ignore))
        fork(events.publish(McpEvent.StatusChanged, { server: name }).pipe(Effect.ignore))
      })
      connection.onLog((message) => fork(serverLog(name, message).pipe(Effect.ignore)))
      connection.onToolsChanged(() => {
        fork(
          refreshTools(name, entry, connection).pipe(
            Effect.andThen(events.publish(McpEvent.ToolsChanged, { server: name })),
            Effect.ignore,
          ),
        )
      })
      connection.onPromptsChanged(() => {
        fork(refreshPrompts(name, entry, connection).pipe(Effect.ignore))
      })
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
        const scope = yield* Scope.fork(root)
        entry.scope = scope
        const authProvider = yield* connectProvider(entry)
        // List tools as part of connect so a failure here marks the server failed rather than
        // leaving it connected with a silently empty tool list and no path to recover.
        const result = yield* MCPClient.connect(name, entry.config, location.directory, authProvider).pipe(
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
          yield* events.publish(McpEvent.StatusChanged, { server: name }).pipe(Effect.ignore)
          fork(refreshPrompts(name, entry, result.value.connection).pipe(Effect.ignore))
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

    // Disabled servers settle their startup immediately so queries never block on them.
    for (const [name, entry] of runtime) {
      if (entry.config.disabled) {
        entry.status = { status: "disabled" }
        Deferred.doneUnsafe(entry.startup, Exit.void)
        continue
      }
      fork(startServer(name, entry))
    }

    // Bring a server online (or back to needs_auth) when its integration's credential changes, so an
    // OAuth login takes effect without a restart. Only fires for the integrations we registered.
    const owned = new Set(registrations.map((reg) => reg.integrationID))
    const reconnect = (integrationID: Integration.ID) =>
      Effect.gen(function* () {
        const match = Array.from(runtime).find(([, entry]) => entry.integrationID === integrationID)
        if (!match) return
        const [name, entry] = match
        if (entry.config.disabled) return
        if (entry.scope) {
          yield* Scope.close(entry.scope, Exit.void)
          entry.scope = undefined
          entry.client = undefined
          entry.tools = undefined
          entry.prompts = undefined
          yield* events.publish(Command.Event.Updated, {}).pipe(Effect.ignore)
        }
        yield* startServer(name, entry)
      })
    fork(
      events.subscribe(Integration.Event.ConnectionUpdated).pipe(
        Stream.filter((event) => owned.has(event.data.integrationID)),
        Stream.runForEach((event) => Effect.sync(() => fork(reconnect(event.data.integrationID)))),
        Effect.ignore,
      ),
    )

    const whenAllReady = Effect.forEach(runtime.values(), (entry) => Deferred.await(entry.startup), {
      concurrency: "unbounded",
      discard: true,
    })
    const gate = Effect.fnUntraced(function* (server: ServerName | string) {
      const target = yield* requireServer(server)
      yield* Deferred.await(target.entry.startup)
    })

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
        return new ResourceCatalog({ resources: [], templates: [] })
      }),
      readResource: Effect.fn("MCP.readResource")(function* (input) {
        yield* gate(input.server)
        return undefined
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, Location.node, EventV2.node, Integration.node, Credential.node],
})
