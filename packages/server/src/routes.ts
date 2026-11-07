import { Database } from "@Mackery6969/core/database/database"
import { V1Migration } from "@Mackery6969/core/database/v1-migration"
import { App } from "@Mackery6969/core/app"
import { LayerNode } from "@Mackery6969/util/effect/layer-node"
import { Node } from "@Mackery6969/util/effect/app-node"
import { fetchLayer, httpClient, httpFetch } from "@Mackery6969/util/effect/app-node-platform"
import { AppNodeBuilder } from "@Mackery6969/core/effect/app-node-builder"
import { Bus } from "@Mackery6969/core/bus"
import { EventLogger } from "@Mackery6969/core/event-logger"
import { FileSystemSearch } from "@Mackery6969/core/filesystem/search"
import { Credential } from "@Mackery6969/core/credential"
import { Config } from "@Mackery6969/core/config"
import { PermissionSaved } from "@Mackery6969/core/permission/saved"
import { PtyTicket } from "@Mackery6969/core/pty/ticket"
import { PersistentPty } from "@Mackery6969/core/persistent-pty"
import { Project } from "@Mackery6969/core/project"
import { Worktree } from "@Mackery6969/core/worktree"
import { Session } from "@Mackery6969/core/session"
import { Instance } from "@Mackery6969/core/instance/service"
import { SessionTransfer } from "@Mackery6969/core/session/transfer"
import { InstructionEntry } from "@Mackery6969/core/session/instruction-entry"
import { ShellSelect } from "@Mackery6969/core/shell/select"
import { Job } from "@Mackery6969/core/job"
import { KV } from "@Mackery6969/core/kv"
import { Mcp } from "@Mackery6969/core/mcp/index"
import { Global } from "@Mackery6969/util/global"
import { FSUtil } from "@Mackery6969/util/fs-util"
import { InstructionDiscovery } from "@Mackery6969/core/instruction-discovery"
import { LocationServiceMap } from "@Mackery6969/core/location-service-map"
import { LocationActivity } from "@Mackery6969/core/location-activity"
import { ModelsDev } from "@Mackery6969/core/models-dev"
import { SessionRestart } from "@Mackery6969/core/session/execution/restart"
import { Schedule } from "@Mackery6969/core/schedule"
import { PluginUpdate } from "@Mackery6969/core/plugin/update"
import { SdkPlugins } from "@Mackery6969/core/plugin/sdk"
import { WellKnown } from "@Mackery6969/core/wellknown"
import { Workspace } from "@Mackery6969/core/workspace"
import { Watcher } from "@Mackery6969/core/filesystem/watcher"
import { FileWatch } from "@Mackery6969/core/filesystem/file-watch"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Context, Effect, Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { CorsConfig } from "./cors"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { ServerPairing } from "./pairing"
import { layer } from "./location"
import { formLocationLayer } from "./middleware/form-location"
import { sessionLocationLayer } from "./middleware/session-location"
import { ServerInfo } from "./server-info"
import type { ServerOptions } from "./options"

const applicationServiceNodes = [
  Global.node,
  FSUtil.node,
  Database.node,
  KV.node,
  Bus.node,
  EventLogger.node,
  httpClient,
  Job.node,
  Project.node,
  Project.sweepNode,
  Worktree.node,
  Session.node,
  Instance.node,
  SessionTransfer.node,
  InstructionEntry.node,
  SdkPlugins.node,
  PluginUpdate.node,
  PermissionSaved.node,
  PtyTicket.node,
  PersistentPty.node,
  Credential.node,
  WellKnown.node,
  ServerPairing.node,
  LocationServiceMap.node,
  LocationActivity.node,
  SessionRestart.node,
  Schedule.node,
  Workspace.node,
  FileWatch.node,
] as const
const applicationServices = LayerNode.group(applicationServiceNodes)

export function createRoutes(
  options: ServerOptions = {},
  serviceURLs: () => ReadonlyArray<string> = () => [],
  overrides: LayerNode.Replacements = [],
) {
  return makeRoutes(
    options.password
      ? ServerAuth.Config.configLayer({ password: Option.some(options.password) })
      : ServerAuth.Config.layer,
    options,
    serviceURLs,
    overrides,
  )
}

type InstanceNode = (
  replacements: () => LayerNode.Replacements,
) => LayerNode.Provider<Instance.Service, never, typeof Node.tags.values.global>

export function createEmbeddedRoutes(
  options: ServerOptions = {},
  overrides: LayerNode.Replacements = [],
  instances?: InstanceNode,
) {
  return makeRoutes(ServerAuth.Config.configLayer({ password: Option.none() }), options, () => [], overrides, instances)
}

function makeRoutes<AuthError, AuthServices>(
  auth: Layer.Layer<ServerAuth.Config, AuthError, AuthServices>,
  options: ServerOptions,
  serviceURLs: () => ReadonlyArray<string>,
  // Runtime-profile replacements (e.g. workerd) applied after the standard set, so later entries win.
  overrides: LayerNode.Replacements,
  instances?: InstanceNode,
) {
  const standard: LayerNode.Replacements = [
    Database.node.replace(Database.configured(options.database)),
    PersistentPty.node.replace(PersistentPty.configured(options.pty)),
    Bus.node.replace(Bus.configured({ persist: options.events?.persist })),
    App.node.replace(App.configured(options.app)),
    ModelsDev.node.replace(ModelsDev.configured(options.models)),
    httpFetch.replace(fetchLayer(options.fetch)),
    Watcher.node.replace(Watcher.configured({ enabled: options.fs?.filewatcher })),
    FileWatch.node.replace(FileWatch.configured({ enabled: options.fs?.filewatcher })),
    FileSystemSearch.node.replace(FileSystemSearch.configured({ fff: options.fs?.fff })),
    Global.node.replace(Global.layerWith(options.config?.directory ? { config: options.config.directory } : {})),
    Config.node.replace(
      Config.configured({
        project: options.config?.project,
        claude: options.config?.claude,
        file: options.config?.file,
        content: options.config?.content,
      }),
    ),
    InstructionDiscovery.node.replace(InstructionDiscovery.configured({ project: options.config?.project })),
    ShellSelect.node.replace(ShellSelect.configured({ gitbash: options.windows?.gitbash })),
    Mcp.node.replace(
      Mcp.configured({
        clientInfo: {
          name: "opencode",
          version: options.app?.version ?? "unknown",
        },
      }),
    ),
  ]
  const build = (overrides: LayerNode.Replacements) => {
    const replacements: LayerNode.Replacements = [
      ...standard,
      // Private instances resolve this list lazily so they inherit the complete host graph, including the selector.
      ...(instances ? [Instance.node.replace(instances(() => replacements))] : []),
      ...overrides,
    ]
    return AppNodeBuilder.build(applicationServices, replacements)
  }
  const serviceLayer = options.simulation
    ? Layer.unwrap(
        Effect.gen(function* () {
          const { simulationReplacements } = yield* Effect.promise(() => import("@Mackery6969/simulation/backend"))
          const simulation = yield* simulationReplacements({ version: App.make(options.app).version })
          return build([...overrides, ...simulation])
        }),
      )
    : build(overrides)
  return serviceLayer.pipe(
    Layer.flatMap((context) => {
      const services = Layer.succeedContext(context)
      const requestServices = Layer.merge(
        Layer.succeedContext(
          Context.pick(
            Database.Service,
            Credential.Service,
            PermissionSaved.Service,
            PluginUpdate.Service,
            Project.Service,
            WellKnown.Service,
          )(context),
        ),
        ServerInfo.layer(serviceURLs, Context.get(context, Global.Service).tmp, options.app),
      )
      const api = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
        Layer.provide(handlers.pipe(Layer.provide(services), Layer.provide(Layer.succeed(CorsConfig, options)))),
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
  )
}
