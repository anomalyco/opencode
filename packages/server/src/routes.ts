import { Database } from "@opencode/core/database/database"
import { V1Migration } from "@opencode/core/database/v1-migration"
import { App } from "@opencode/core/app"
import { CodeModeApi } from "@opencode/core/codemode/api"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Node } from "@opencode/util/effect/app-node"
import { fetchLayer, httpClient, httpFetch } from "@opencode/util/effect/app-node-platform"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { EventLogger } from "@opencode/core/event-logger"
import { FileSystemSearch } from "@opencode/core/filesystem/search"
import { Credential } from "@opencode/core/credential"
import { Config } from "@opencode/core/config"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { BrowserTunnelGateway } from "@opencode/core/experimental/browser-tunnel"
import { PtyTicket } from "@opencode/core/pty/ticket"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { Project } from "@opencode/core/project"
import { BlobStore } from "@opencode/core/blob-store"
import { VideoGeneration } from "@opencode/core/video-generation"
import { Worktree } from "@opencode/core/worktree"
import { Session } from "@opencode/core/session"
import { Instance } from "@opencode/core/instance/service"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { InstructionEntry } from "@opencode/core/session/instruction-entry"
import { ShellSelect } from "@opencode/core/shell/select"
import { Shell } from "@opencode/core/shell"
import { Job } from "@opencode/core/job"
import { KV } from "@opencode/core/kv"
import { Mcp } from "@opencode/core/mcp/index"
import { Global } from "@opencode/util/global"
import { FSUtil } from "@opencode/util/fs-util"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { LocationActivity } from "@opencode/core/location-activity"
import { Identity } from "@opencode/core/machine/identity"
import { Machines } from "@opencode/core/machine/machines"
import { SessionSearchBuild } from "@opencode/core/session/search-build"
import { ModelsDev } from "@opencode/core/models-dev"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { Automation } from "@opencode/core/automation"
import { PluginUpdate } from "@opencode/core/plugin/update"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { WellKnown } from "@opencode/core/wellknown"
import { PushList } from "@opencode/core/push/list"
import { PushSender } from "@opencode/core/push/sender"
import { PushWatcher } from "@opencode/core/push/watcher"
import { Workspace } from "@opencode/core/workspace"
import { WorkspaceConnector } from "@opencode/core/environment/workspace-connector"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { FileWatch } from "@opencode/core/filesystem/file-watch"
import { HttpEffect, HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Context, Effect, Layer, Option } from "effect"
import { Base64 } from "effect/encoding"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { SpaceStore } from "./space-store"
import { CorsConfig } from "./cors"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { defectResponseLayer } from "./middleware/defect-response"
import { ServerPairing } from "./pairing"
import { layer } from "./location"
import { formLocationLayer } from "./middleware/form-location"
import { sessionLocationLayer } from "./middleware/session-location"
import { ServerInfo } from "./server-info"
import type { ServerOptions } from "./options"

const applicationServiceNodes = [
  App.node,
  CodeModeApi.node,
  Global.node,
  FSUtil.node,
  Database.node,
  KV.node,
  Bus.node,
  // Before the jobs and sessions, so they are released after them: a shutdown's interrupted shell calls and jobs
  // still reach the daemon to stop their commands, and a command being created never falls back to spawning.
  PersistentPty.node,
  // Daemon-run shell commands belong to the server, so a Location closing never takes them down.
  Shell.daemonNode,
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
  BrowserTunnelGateway.node,
  Credential.node,
  WellKnown.node,
  ServerPairing.node,
  SpaceStore.node,
  LocationServiceMap.node,
  LocationActivity.node,
  SessionRestart.node,
  Automation.node,
  // Read by the blob route.
  BlobStore.node,
  // Started with the server, so its leader election and polling resume jobs even before anyone calls the video API.
  VideoGeneration.node,
  SessionSearchBuild.node,
  Workspace.node,
  // The machine list: where a carrier hands over the workers dialing in from other computers.
  Machines.node,
  // The home's key, which the link's handshake signs with.
  Identity.node,
  FileWatch.node,
  PushList.node,
  PushSender.node,
  PushWatcher.node,
] as const
const applicationServices = LayerNode.group(applicationServiceNodes)

export function createRoutes(
  options: ServerOptions = {},
  serviceURLs: () => ReadonlyArray<string> = () => [],
  overrides: LayerNode.Replacements = [],
) {
  return makeRoutes(options.password ? Option.some(options.password) : Option.none(), options, serviceURLs, overrides)
}

type InstanceNode = (
  replacements: () => LayerNode.Replacements,
) => LayerNode.Provider<Instance.Service, never, typeof Node.tags.values.global>

export function createEmbeddedRoutes(
  options: ServerOptions = {},
  overrides: LayerNode.Replacements = [],
  instances?: InstanceNode,
) {
  return makeRoutes(Option.none(), options, () => [], overrides, instances)
}

function makeRoutes(
  password: Option.Option<string>,
  options: ServerOptions,
  serviceURLs: () => ReadonlyArray<string>,
  // Runtime-profile replacements (e.g. workerd) applied after the standard set, so later entries win.
  overrides: LayerNode.Replacements,
  instances?: InstanceNode,
) {
  const auth = ServerAuth.Config.configLayer({ password })
  // Code Mode `opencode://` fetches go straight to this router, set once the router below is built. They carry the
  // server's own credential, added here after the script handed the request over, so the script never sees it.
  const credential = Option.map(password, (value) => `Basic ${Base64.encode(`opencode:${value}`)}`)
  let internal: ((request: Request) => Promise<Response>) | undefined
  const standard: LayerNode.Replacements = [
    CodeModeApi.node.replace(
      Layer.succeed(
        CodeModeApi.Service,
        CodeModeApi.Service.of({
          fetch: (request) =>
            Effect.suspend(() => {
              const handle = internal
              if (!handle) return Effect.fail(new Error("The OpenCode API is not ready yet."))
              if (Option.isSome(credential)) request.headers.set("authorization", credential.value)
              return Effect.tryPromise({
                try: () => handle(request),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              })
            }),
        }),
      ),
    ),
    Database.node.replace(Database.configured(options.database)),
    WorkspaceConnector.node.replace(Workspace.connectorNode),
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
    InstructionDiscovery.node.replace(
      InstructionDiscovery.configured({
        project: options.config?.project,
        claude: options.instructions?.claude,
      }),
    ),
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
          const { simulationReplacements } = yield* Effect.promise(() => import("@opencode/simulation/backend"))
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
        Layer.merge(defectResponseLayer),
        Layer.provideMerge(services),
        // MCP server names are path parameters, and clients name servers longer than find-my-way's default 100 characters.
        Layer.provideMerge(
          HttpRouter.layer.pipe(Layer.provide(Layer.succeed(HttpRouter.RouterConfig)({ maxParamLength: 512 }))),
        ),
        Layer.tap((context) =>
          Effect.sync(() => {
            internal = Context.get(context, HttpRouter.HttpRouter)
              .asHttpEffect()
              .pipe(HttpEffect.toWebHandlerWith(context))
          }),
        ),
      )
      return Layer.merge(api, V1Migration.layer.pipe(Layer.provide(services)))
    }),
  )
}
