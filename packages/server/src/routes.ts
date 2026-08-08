import { Database } from "@opencode-ai/core/database/database"
import { V1Migration } from "@opencode-ai/core/database/v1-migration"
import { App } from "@opencode-ai/core/app"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { httpClient } from "@opencode-ai/util/effect/app-node-platform"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Bus } from "@opencode-ai/core/bus"
import { EventLogger } from "@opencode-ai/core/event-logger"
import { FileSystemSearch } from "@opencode-ai/core/filesystem/search"
import { Observability } from "@opencode-ai/util/observability"
import { Credential } from "@opencode-ai/core/credential"
import { Config } from "@opencode-ai/core/config"
import { Command } from "@opencode-ai/core/command"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { Pty } from "@opencode-ai/core/pty"
import { Project } from "@opencode-ai/core/project"
import { Session } from "@opencode-ai/core/session"
import { SessionTransfer } from "@opencode-ai/core/session/transfer"
import { Shell } from "@opencode-ai/core/shell"
import { Job } from "@opencode-ai/core/job"
import { MCP } from "@opencode-ai/core/mcp/index"
import { Global } from "@opencode-ai/util/global"
import { InstructionDiscovery } from "@opencode-ai/core/instruction-discovery"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { WellKnown } from "@opencode-ai/core/wellknown"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Context, Effect, Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { PtyEnvironment } from "./pty-environment"
import { layer } from "./location"
import { formLocationLayer } from "./middleware/form-location"
import { sessionLocationLayer } from "./middleware/session-location"
import { ServerInfo } from "./server-info"
import type { ServerOptions } from "./options"
import { modalWorkspaceDriver, provider as modalProvider } from "./workspace/modal-workspace"

const applicationServices = LayerNode.group([
  Database.node,
  Bus.node,
  EventLogger.node,
  httpClient,
  Job.node,
  Project.node,
  Session.node,
  SessionTransfer.node,
  PluginRuntime.providerNode,
  SdkPlugins.node,
  PermissionSaved.node,
  PtyTicket.node,
  Credential.node,
  WellKnown.node,
  PtyEnvironment.node,
  LocationServiceMap.node,
  SessionRestart.node,
])

export function createRoutes(options: ServerOptions = {}, serviceURLs: () => ReadonlyArray<string> = () => []) {
  return makeRoutes(
    options.password
      ? ServerAuth.Config.configLayer({ password: Option.some(options.password) })
      : ServerAuth.Config.layer,
    options,
    serviceURLs,
  )
}

export function createEmbeddedRoutes(options: ServerOptions = {}) {
  return makeRoutes(ServerAuth.Config.configLayer({ password: Option.none() }), options, () => [])
}

function makeRoutes<AuthError, AuthServices>(
  auth: Layer.Layer<ServerAuth.Config, AuthError, AuthServices>,
  options: ServerOptions,
  serviceURLs: () => ReadonlyArray<string>,
) {
  const pluginRuntimeCell = PluginRuntime.makeCell()
  const replacements: LayerNode.Replacements = [
    [Database.node, Database.configured(options.database)],
    [Bus.node, Bus.configured({ persist: options.events?.persist })],
    [App.node, App.configured(options.app)],
    [ModelsDev.node, ModelsDev.configured(options.models)],
    [Watcher.node, Watcher.configured({ enabled: options.fs?.filewatcher })],
    [FileSystemSearch.node, FileSystemSearch.configured({ fff: options.fs?.fff })],
    [Global.node, Global.layerWith(options.config?.directory ? { config: options.config.directory } : {})],
    [
      Config.node,
      Config.configured({
        project: options.config?.project,
        file: options.config?.file,
        content: options.config?.content,
      }),
    ],
    [InstructionDiscovery.node, InstructionDiscovery.configured({ project: options.config?.project })],
    [Command.node, Command.configured({ gitbash: options.windows?.gitbash })],
    [Pty.node, Pty.configured({ gitbash: options.windows?.gitbash })],
    [Shell.node, Shell.configured({ gitbash: options.windows?.gitbash })],
    [
      MCP.node,
      MCP.configured({
        clientInfo: {
          name: options.app?.name ?? "opencode",
          version: options.app?.version ?? "unknown",
        },
      }),
    ],
    [PluginRuntime.node, PluginRuntime.layerWithCell(pluginRuntimeCell)],
    [PluginRuntime.providerNode, PluginRuntime.providerNodeWithCell(pluginRuntimeCell)],
    [
      WorkspaceDriver.node,
      WorkspaceDriver.registryNode({ [modalProvider]: modalWorkspaceDriver({ app: "opencode-workspaces" }) }),
    ],
  ]
  const serviceLayer = options.simulation
    ? Layer.unwrap(
        Effect.gen(function* () {
          const { simulationReplacements } = yield* Effect.promise(() => import("@opencode-ai/simulation/backend"))
          const simulation = yield* simulationReplacements({ version: App.make(options.app).version })
          return AppNodeBuilder.build(applicationServices, [...replacements, ...simulation])
        }),
      )
    : AppNodeBuilder.build(applicationServices, replacements)
  const observability = Observability.layer({
    ...options.observability,
    client: options.app?.name,
    version: options.app?.version,
    channel: options.app?.channel,
  })

  return serviceLayer.pipe(
    Layer.flatMap((context) => {
      const services = Layer.succeedContext(context)
      const requestServices = Layer.merge(
        Layer.succeedContext(
          Context.pick(Database.Service, PermissionSaved.Service, Project.Service, WellKnown.Service)(context),
        ),
        ServerInfo.layer(serviceURLs, options.app),
      )
      const api = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
        Layer.provide(handlers.pipe(Layer.provide(services))),
        Layer.provide(formLocationLayer),
        Layer.provide(sessionLocationLayer),
        Layer.provide(layer),
        Layer.provide(authorizationLayer),
        Layer.provide(schemaErrorLayer),
        Layer.provide(auth),
        HttpRouter.provideRequest(requestServices),
        Layer.provideMerge(services),
        Layer.provideMerge(HttpRouter.layer),
      )
      return Layer.merge(api, V1Migration.layer.pipe(Layer.provide(services)))
    }),
    Layer.provide(observability),
  )
}
