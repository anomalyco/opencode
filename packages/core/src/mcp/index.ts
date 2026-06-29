export * as MCP from "./index"

import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Cause, Context, Deferred, Effect, Exit, FiberSet, Layer, Schema, Scope } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Config } from "../config"
import { ConfigMCP } from "../config/mcp"
import { EventV2 } from "../event"
import { Integration } from "../integration"
import { IntegrationConnection } from "../integration/connection"
import { Location } from "../location"
import { MCPClient } from "./client"

export const ServerName = Schema.String.pipe(Schema.brand("MCP.ServerName"))
export type ServerName = typeof ServerName.Type

const StatusConnected = Schema.Struct({ status: Schema.Literal("connected") }).annotate({
  identifier: "MCP.Status.Connected",
})
const StatusDisconnected = Schema.Struct({ status: Schema.Literal("disconnected") }).annotate({
  identifier: "MCP.Status.Disconnected",
})
const StatusDisabled = Schema.Struct({ status: Schema.Literal("disabled") }).annotate({
  identifier: "MCP.Status.Disabled",
})
const StatusFailed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).annotate({
  identifier: "MCP.Status.Failed",
})
const StatusNeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") }).annotate({
  identifier: "MCP.Status.NeedsAuth",
})
const StatusNeedsClientRegistration = Schema.Struct({
  status: Schema.Literal("needs_client_registration"),
  error: Schema.String,
}).annotate({ identifier: "MCP.Status.NeedsClientRegistration" })

export const Status = Schema.Union([
  StatusConnected,
  StatusDisconnected,
  StatusDisabled,
  StatusFailed,
  StatusNeedsAuth,
  StatusNeedsClientRegistration,
]).pipe(Schema.toTaggedUnion("status"))
export type Status = typeof Status.Type

export class ServerInfo extends Schema.Class<ServerInfo>("MCP.ServerInfo")({
  name: ServerName,
  config: ConfigMCP.Server,
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
  readonly integrationID?: Integration.ID
  readonly connection?: IntegrationConnection.Info
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

    const requireServer = Effect.fnUntraced(function* (server: ServerName | string) {
      const name = ServerName.make(server)
      const entry = runtime.get(name)
      if (!entry) return yield* new NotFoundError({ server: name })
      return { name, entry }
    })

    const info = (name: ServerName, entry: ServerEntry) =>
      new ServerInfo({
        name,
        config: entry.config,
        status: entry.status,
        integrationID: entry.integrationID,
        connection: entry.connection,
      })

    const toTool = (server: ServerName, def: MCPClient.ToolDefinition) =>
      new Tool({ server, name: def.name, description: def.description, inputSchema: def.inputSchema })

    const refreshTools = (name: ServerName, entry: ServerEntry, connection: MCPClient.Connection) =>
      connection.tools().pipe(
        Effect.map((defs) => {
          entry.tools = defs.map((def) => toTool(name, def))
        }),
      )

    const watch = (name: ServerName, entry: ServerEntry, connection: MCPClient.Connection) => {
      connection.onClose(() => {
        entry.client = undefined
        entry.tools = undefined
        entry.status = { status: "failed", error: "Connection closed" }
        fork(events.publish(McpEvent.ToolsChanged, { server: name }).pipe(Effect.ignore))
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
        // List tools as part of connect so a failure here marks the server failed rather than
        // leaving it connected with a silently empty tool list and no path to recover.
        const result = yield* MCPClient.connect(name, entry.config, location.directory).pipe(
          Effect.flatMap((connection) => connection.tools().pipe(Effect.map((defs) => ({ connection, defs })))),
          Scope.provide(scope),
          Effect.exit,
        )
        if (Exit.isSuccess(result)) {
          entry.client = result.value.connection
          entry.tools = result.value.defs.map((def) => toTool(name, def))
          entry.status = { status: "connected" }
          watch(name, entry, result.value.connection)
          yield* Effect.logInfo("mcp connected", { server: name, tools: entry.tools.length })
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
        return Array.from(runtime, ([name, entry]) => info(name, entry)).toSorted((a, b) =>
          a.name.localeCompare(b.name),
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
          .pipe(Effect.mapError((error) => new ToolCallError({ server: target.name, tool: input.name, message: error.message })))
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
        yield* whenAllReady
        return []
      }),
      prompt: Effect.fn("MCP.prompt")(function* (input) {
        yield* gate(input.server)
        return undefined
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

export const node = makeLocationNode({ service: Service, layer, deps: [Config.node, Location.node, EventV2.node] })
