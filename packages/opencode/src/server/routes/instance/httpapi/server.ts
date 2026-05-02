import { Context, Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { FetchHttpClient, HttpClient, HttpMiddleware, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Command } from "@/command"
import * as Observability from "@opencode-ai/core/effect/observability"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { Ripgrep } from "@/file/ripgrep"
import { Format } from "@/format"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Installation } from "@/installation"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Plugin } from "@/plugin"
import { Project } from "@/project/project"
import { ProviderAuth } from "@/provider/auth"
import { ModelsDev } from "@/provider/models"
import { Provider } from "@/provider/provider"
import { Pty } from "@/pty"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { SessionShare } from "@/share/session"
import { ShareNext } from "@/share/share-next"
import { Skill } from "@/skill"
import { Snapshot } from "@/snapshot"
import { SyncEvent } from "@/sync"
import { ToolRegistry } from "@/tool/registry"
import { lazy } from "@/util/lazy"
import { Vcs } from "@/project/vcs"
import { Worktree } from "@/worktree"
import { Workspace } from "@/control-plane/workspace"
import { isAllowedCorsOrigin, type CorsOptions } from "@/server/cors"
import { serveUIEffect } from "@/server/routes/ui"
import { InstanceHttpApi, RootHttpApi } from "./api"
import { ServerAuthConfig, authorizationLayer, authorizationRouterMiddleware } from "./middleware/authorization"
import { EventApi, eventHandlers } from "./event"
import { configHandlers } from "./handlers/config"
import { controlHandlers } from "./handlers/control"
import { experimentalHandlers } from "./handlers/experimental"
import { fileHandlers } from "./handlers/file"
import { globalHandlers } from "./handlers/global"
import { instanceHandlers } from "./handlers/instance"
import { mcpHandlers } from "./handlers/mcp"
import { permissionHandlers } from "./handlers/permission"
import { projectHandlers } from "./handlers/project"
import { providerHandlers } from "./handlers/provider"
import { ptyConnectRoute, ptyHandlers } from "./handlers/pty"
import { questionHandlers } from "./handlers/question"
import { sessionHandlers } from "./handlers/session"
import { syncHandlers } from "./handlers/sync"
import { tuiHandlers } from "./handlers/tui"
import { workspaceHandlers } from "./handlers/workspace"
import { instanceContextLayer, instanceRouterMiddleware } from "./middleware/instance-context"
import { workspaceRouterMiddleware, workspaceRoutingLayer } from "./middleware/workspace-routing"
import { disposeMiddleware } from "./lifecycle"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import * as ServerBackend from "@/server/backend"

export const context = Context.makeUnsafe<unknown>(new Map())

const runtime = HttpRouter.middleware()(
  Effect.succeed((effect) =>
    Effect.gen(function* () {
      const selected = ServerBackend.select()
      yield* Effect.annotateCurrentSpan(ServerBackend.attributes(ServerBackend.force(selected, "effect-httpapi")))
      return yield* effect
    }),
  ),
).layer

const cors = (corsOptions?: CorsOptions) =>
  HttpRouter.middleware(
    HttpMiddleware.cors({
      allowedOrigins: (origin) => isAllowedCorsOrigin(origin, corsOptions),
      maxAge: 86_400,
    }),
    { global: true },
  )

const rootApiRoutes = HttpApiBuilder.layer(RootHttpApi).pipe(Layer.provide([controlHandlers, globalHandlers]))
const instanceRouterLayer = authorizationRouterMiddleware
  .combine(instanceRouterMiddleware)
  .combine(workspaceRouterMiddleware)
  .layer.pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal), Layer.provide(ServerAuthConfig.defaultLayer))
const eventApiRoutes = HttpApiBuilder.layer(EventApi).pipe(
  Layer.provide(eventHandlers),
  Layer.provide(instanceRouterLayer),
)
const instanceApiRoutes = HttpApiBuilder.layer(InstanceHttpApi).pipe(
  Layer.provide([
    configHandlers,
    experimentalHandlers,
    fileHandlers,
    instanceHandlers,
    mcpHandlers,
    projectHandlers,
    ptyHandlers,
    questionHandlers,
    permissionHandlers,
    providerHandlers,
    sessionHandlers,
    syncHandlers,
    tuiHandlers,
    workspaceHandlers,
  ]),
)

const rawInstanceRoutes = Layer.mergeAll(ptyConnectRoute).pipe(Layer.provide(instanceRouterLayer))
const instanceRoutes = Layer.mergeAll(rawInstanceRoutes, instanceApiRoutes).pipe(
  Layer.provide([
    authorizationLayer.pipe(Layer.provide(ServerAuthConfig.defaultLayer)),
    workspaceRoutingLayer.pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
    instanceContextLayer,
  ]),
)

const uiRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const client = yield* HttpClient.HttpClient
    yield* router.add("*", "/*", (request) => serveUIEffect(request, { fs, client }))
  }),
).pipe(Layer.provide(authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuthConfig.defaultLayer))))

export function createRoutes(corsOptions?: CorsOptions) {
  return Layer.mergeAll(rootApiRoutes, eventApiRoutes, instanceRoutes, uiRoute).pipe(
    Layer.provide([
      cors(corsOptions),
      runtime,
      Account.defaultLayer,
      Agent.defaultLayer,
      Auth.defaultLayer,
      Command.defaultLayer,
      Config.defaultLayer,
      File.defaultLayer,
      FileWatcher.defaultLayer,
      Format.defaultLayer,
      LSP.defaultLayer,
      Installation.defaultLayer,
      InstanceRuntime.layer,
      MCP.defaultLayer,
      ModelsDev.defaultLayer,
      Permission.defaultLayer,
      Plugin.defaultLayer,
      Project.defaultLayer,
      ProviderAuth.defaultLayer,
      Provider.defaultLayer,
      Pty.defaultLayer,
      Question.defaultLayer,
      Ripgrep.defaultLayer,
      Session.defaultLayer,
      SessionCompaction.defaultLayer,
      SessionPrompt.defaultLayer,
      SessionRevert.defaultLayer,
      SessionShare.defaultLayer,
      SessionRunState.defaultLayer,
      SessionStatus.defaultLayer,
      SessionSummary.defaultLayer,
      ShareNext.defaultLayer,
      Snapshot.defaultLayer,
      SyncEvent.defaultLayer,
      Skill.defaultLayer,
      Todo.defaultLayer,
      ToolRegistry.defaultLayer,
      Vcs.defaultLayer,
      Workspace.defaultLayer,
      Worktree.defaultLayer,
      Bus.layer,
      AppFileSystem.defaultLayer,
      FetchHttpClient.layer,
      HttpServer.layerServices,
    ]),
    Layer.provideMerge(Observability.layer),
  )
}

export const routes = createRoutes()

const defaultWebHandler = lazy(() =>
  HttpRouter.toWebHandler(routes, {
    memoMap,
    middleware: disposeMiddleware,
  }),
)

export function webHandler(corsOptions?: CorsOptions) {
  if (!corsOptions?.cors?.length) return defaultWebHandler()
  return HttpRouter.toWebHandler(createRoutes(corsOptions), {
    // Server-level CORS options are dynamic; don't reuse the default route layer memoized without them.
    memoMap: Layer.makeMemoMapUnsafe(),
    middleware: disposeMiddleware,
  })
}

export * as ExperimentalHttpApiServer from "./server"
