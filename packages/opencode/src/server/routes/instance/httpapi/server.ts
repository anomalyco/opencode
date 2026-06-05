import { Config as EffectConfig, Context, Effect, Layer } from "effect"
import { HttpApiBuilder, OpenApi } from "effect/unstable/httpapi"
import {
  FetchHttpClient,
  HttpClient,
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { Command } from "@/command"
import * as Observability from "@opencode-ai/core/effect/observability"
import { Ripgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { Format } from "@/format"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Installation } from "@/installation"
import { InstanceLayer } from "@/project/instance-layer"
import { Plugin } from "@/plugin"
import { Project } from "@/project/project"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { ProviderAuth } from "@/provider/auth"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { LLM } from "@/session/llm"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { SessionShare } from "@/share/session"
import { ShareNext } from "@/share/share-next"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Database } from "@opencode-ai/core/database/database"
import { Skill } from "@/skill"
import { Snapshot } from "@/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { lazy } from "@/util/lazy"
import { Vcs } from "@/project/vcs"
import { Worktree } from "@/worktree"
import { Workspace } from "@/control-plane/workspace"
import { CorsConfig, isAllowedCorsOrigin, type CorsOptions } from "@/server/cors"
import { serveUIEffect } from "@/server/shared/ui"
import { ServerAuth } from "@/server/auth"
import { InstanceHttpApi, RootHttpApi } from "./api"
import { V2Api } from "@opencode-ai/server/api"
import { PublicApi } from "./public"
import {
  authorizationLayer,
  authorizationRouterMiddleware,
  ptyConnectAuthorizationLayer,
  v2AuthorizationLayer,
} from "./middleware/authorization"
import { EventApi } from "./groups/event"
import { PtyConnectApi } from "./groups/pty"
import { eventHandlers } from "./handlers/event"
import { configHandlers } from "./handlers/config"
import { controlHandlers } from "./handlers/control"
import { controlPlaneHandlers } from "./handlers/control-plane"
import { experimentalHandlers } from "./handlers/experimental"
import { fileHandlers } from "./handlers/file"
import { globalHandlers } from "./handlers/global"
import { instanceHandlers } from "./handlers/instance"
import { mcpHandlers } from "./handlers/mcp"
import { permissionHandlers } from "./handlers/permission"
import { projectHandlers } from "./handlers/project"
import { projectCopyHandlers } from "./handlers/project-copy"
import { providerHandlers } from "./handlers/provider"
import { ptyConnectHandlers, ptyHandlers } from "./handlers/pty"
import { questionHandlers } from "./handlers/question"
import { sessionHandlers } from "./handlers/session"
import { syncHandlers } from "./handlers/sync"
import { tuiHandlers } from "./handlers/tui"
import { v2Handlers } from "@opencode-ai/server/handlers"
import { schemaErrorLayer as v2SchemaErrorLayer } from "@opencode-ai/server/middleware/schema-error"
import { workspaceHandlers } from "./handlers/workspace"
import { instanceContextLayer } from "./middleware/instance-context"
import { workspaceRoutingLayer } from "./middleware/workspace-routing"
import { disposeMiddleware } from "./lifecycle"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import { compressionLayer } from "./middleware/compression"
import { corsVaryFix } from "./middleware/cors-vary"
import { errorLayer } from "./middleware/error"
import { fenceLayer } from "./middleware/fence"
import { schemaErrorLayer } from "./middleware/schema-error"

export const context = Context.makeUnsafe<unknown>(new Map())

const cors = (corsOptions?: CorsOptions) =>
  HttpRouter.middleware(
    HttpMiddleware.cors({
      allowedOrigins: (origin) => isAllowedCorsOrigin(origin, corsOptions),
      maxAge: 86_400,
    }),
    { global: true },
  )

// Route tree:
// - rootApiRoutes: typed /global/* and control routes; auth is declared by RootHttpApi.
// - eventApiRoutes: typed SSE route with instance routing context and its existing API contract.
// - ptyConnectApiRoutes: typed WebSocket upgrade route with ticket-aware auth.
// - instanceApiRoutes: remaining typed instance routes.
// - uiRoute: raw catch-all fallback; auth is router middleware so public static assets can bypass it.
const authOnlyRouterLayer = authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))
const httpApiAuthLayer = authorizationLayer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))
const ptyConnectHttpApiAuthLayer = ptyConnectAuthorizationLayer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))
const v2HttpApiAuthLayer = v2AuthorizationLayer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))
const workspaceRoutingLive = workspaceRoutingLayer.pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))
const rootApiRoutes = HttpApiBuilder.layer(RootHttpApi).pipe(
  Layer.provide([controlHandlers, controlPlaneHandlers, globalHandlers]),
  Layer.provide(schemaErrorLayer),
  Layer.provide(httpApiAuthLayer),
)
const eventApiRoutes = HttpApiBuilder.layer(EventApi).pipe(
  Layer.provide(eventHandlers),
  Layer.provide([httpApiAuthLayer, workspaceRoutingLive, instanceContextLayer]),
)
const ptyConnectApiRoutes = HttpApiBuilder.layer(PtyConnectApi).pipe(
  Layer.provide(ptyConnectHandlers),
  Layer.provide([ptyConnectHttpApiAuthLayer, workspaceRoutingLive, instanceContextLayer]),
)
const instanceApiRoutes = HttpApiBuilder.layer(InstanceHttpApi).pipe(
  Layer.provide([
    configHandlers,
    experimentalHandlers,
    fileHandlers,
    instanceHandlers,
    mcpHandlers,
    projectHandlers,
    projectCopyHandlers,
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

const instanceRoutes = instanceApiRoutes.pipe(
  Layer.provide([httpApiAuthLayer, workspaceRoutingLive, instanceContextLayer, schemaErrorLayer]),
)
const v2Routes = HttpApiBuilder.layer(V2Api).pipe(
  Layer.provide(v2Handlers),
  Layer.provide([v2HttpApiAuthLayer, v2SchemaErrorLayer]),
)

// `OpenApi.fromApi` is non-trivial; defer until /doc is actually hit so
// processes that never serve it (CLI, scripts) don't pay at module load.
// `HttpServerResponse.jsonUnsafe` runs JSON.stringify eagerly, so caching
// the response also caches the serialized body — every /doc request reuses
// the same Uint8Array instead of re-stringifying the spec.
const docResponse = lazy(() => HttpServerResponse.jsonUnsafe(OpenApi.fromApi(PublicApi)))

const docRoute = HttpRouter.use((router) => router.add("GET", "/doc", () => Effect.succeed(docResponse()))).pipe(
  Layer.provide(authOnlyRouterLayer),
)

const uiRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const client = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service
    yield* router.add("*", "/*", (request) =>
      serveUIEffect(request, { fs, client, disableEmbeddedWebUi: flags.disableEmbeddedWebUi }),
    )
  }),
).pipe(Layer.provide(authOnlyRouterLayer))

type RouteRequirements =
  | HttpRouter.HttpRouter
  | HttpRouter.Request<"Error", unknown>
  | HttpRouter.Request<"GlobalError", unknown>
  | HttpRouter.Request<"Requires", unknown>
  | HttpRouter.Request<"GlobalRequires", never>

export function createRoutes(
  corsOptions?: CorsOptions,
): Layer.Layer<never, EffectConfig.ConfigError, RouteRequirements> {
  return Layer.mergeAll(
    rootApiRoutes,
    eventApiRoutes,
    ptyConnectApiRoutes,
    instanceRoutes,
    v2Routes,
    docRoute,
    uiRoute,
  ).pipe(
    Layer.provide([
      errorLayer,
      compressionLayer,
      corsVaryFix,
      fenceLayer.pipe(Layer.provide(Database.defaultLayer)),
      cors(corsOptions),
      Database.defaultLayer,
      Account.defaultLayer,
      Agent.defaultLayer,
      Auth.defaultLayer,
      BackgroundJob.defaultLayer,
      Command.defaultLayer,
      Config.defaultLayer,
      Format.defaultLayer,
      LSP.defaultLayer,
      LLM.defaultLayer,
      Installation.defaultLayer,
      MCP.defaultLayer,
      ModelsDev.defaultLayer,
      Permission.defaultLayer,
      Plugin.defaultLayer,
      Project.defaultLayer,
      ProjectV2.defaultLayer,
      ProjectCopy.defaultLayer,
      MoveSession.defaultLayer,
      ProviderAuth.defaultLayer,
      Provider.defaultLayer,
      PtyTicket.defaultLayer,
      Question.defaultLayer,
      Ripgrep.defaultLayer,
      RuntimeFlags.defaultLayer,
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
      EventV2Bridge.defaultLayer,
      EventV2.defaultLayer,
      Skill.defaultLayer,
      Todo.defaultLayer,
      ToolRegistry.defaultLayer,
      Vcs.defaultLayer,
      Workspace.defaultLayer,
      Worktree.appLayer,
      FSUtil.defaultLayer,
      FetchHttpClient.layer,
      HttpServer.layerServices,
    ]),
    Layer.provide(Layer.succeed(CorsConfig)(corsOptions)),
    Layer.provide(InstanceLayer.layer),
    Layer.provide(Observability.layer),
  )
}

export const routes = createRoutes()

export const webHandler = lazy(() =>
  HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap,
    middleware: disposeMiddleware,
  }),
)

export * as HttpApiApp from "./server"
