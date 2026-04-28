import { Context, Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/unstable/http"
import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Command } from "@/command"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import * as Observability from "@opencode-ai/core/effect/observability"
import { File } from "@/file"
import { Ripgrep } from "@/file/ripgrep"
import { Format } from "@/format"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { Installation } from "@/installation"
import { Project } from "@/project/project"
import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"
import { Pty } from "@/pty"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { Skill } from "@/skill"
import { ToolRegistry } from "@/tool/registry"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import { Vcs } from "@/project/vcs"
import { Worktree } from "@/worktree"
import { authorizationLayer } from "./auth"
import { ConfigApi, configHandlers } from "./config"
import { ControlApi, controlHandlers } from "./control"
import { eventRoute } from "./event"
import { FileApi, fileHandlers } from "./file"
import { ExperimentalApi, experimentalHandlers } from "./experimental"
import { GlobalApi, globalHandlers } from "./global"
import { InstanceApi, instanceHandlers } from "./instance"
import { McpApi, mcpHandlers } from "./mcp"
import { PermissionApi, permissionHandlers } from "./permission"
import { ProjectApi, projectHandlers } from "./project"
import { PtyApi, ptyConnectRoute, ptyHandlers } from "./pty"
import { ProviderApi, providerHandlers } from "./provider"
import { QuestionApi, questionHandlers } from "./question"
import { SessionApi, sessionHandlers } from "./session"
import { SyncApi, syncHandlers } from "./sync"
import { TuiApi, tuiHandlers } from "./tui"
import { WorkspaceApi, workspaceHandlers } from "./workspace"
import { disposeMiddleware } from "./lifecycle"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import * as ServerBackend from "@/server/backend"

const Query = Schema.Struct({
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  auth_token: Schema.optional(Schema.String),
})

const Headers = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  "x-opencode-directory": Schema.optional(Schema.String),
})

export const context = Context.empty() as Context.Context<unknown>

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function currentDirectory() {
  try {
    return Instance.directory
  } catch {
    return process.cwd()
  }
}

const instance = HttpRouter.middleware()(
  Effect.gen(function* () {
    return (effect) =>
      Effect.gen(function* () {
        const query = yield* HttpServerRequest.schemaSearchParams(Query)
        const headers = yield* HttpServerRequest.schemaHeaders(Headers)
        const raw = query.directory || headers["x-opencode-directory"] || currentDirectory()
        const workspace = query.workspace || undefined
        const ctx = yield* Effect.promise(() =>
          Instance.provide({
            directory: Filesystem.resolve(decode(raw)),
            init: () => AppRuntime.runPromise(InstanceBootstrap),
            fn: () => Instance.current,
          }),
        )

        const next = workspace ? effect.pipe(Effect.provideService(WorkspaceRef, workspace)) : effect
        return yield* next.pipe(Effect.provideService(InstanceRef, ctx))
      })
  }),
).layer

const runtime = HttpRouter.middleware()(
  Effect.succeed((effect) =>
    Effect.gen(function* () {
      const selected = ServerBackend.select()
      yield* Effect.annotateCurrentSpan(ServerBackend.attributes(ServerBackend.force(selected, "effect-httpapi")))
      return yield* effect
    }),
  ),
).layer

const rootApiRoutes = Layer.mergeAll(HttpApiBuilder.layer(ControlApi), HttpApiBuilder.layer(GlobalApi)).pipe(
  Layer.provide([controlHandlers, globalHandlers]),
)
const instanceApiRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(ConfigApi),
  HttpApiBuilder.layer(ExperimentalApi),
  HttpApiBuilder.layer(FileApi),
  HttpApiBuilder.layer(InstanceApi),
  HttpApiBuilder.layer(McpApi),
  HttpApiBuilder.layer(ProjectApi),
  HttpApiBuilder.layer(PtyApi),
  HttpApiBuilder.layer(QuestionApi),
  HttpApiBuilder.layer(PermissionApi),
  HttpApiBuilder.layer(ProviderApi),
  HttpApiBuilder.layer(SessionApi),
  HttpApiBuilder.layer(SyncApi),
  HttpApiBuilder.layer(TuiApi),
  HttpApiBuilder.layer(WorkspaceApi),
).pipe(
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

const instanceRoutes = Layer.mergeAll(eventRoute, ptyConnectRoute, instanceApiRoutes).pipe(
  Layer.provide([authorizationLayer, instance]),
)

export const routes = Layer.mergeAll(rootApiRoutes, instanceRoutes).pipe(
  Layer.provide([
    runtime,
    Account.defaultLayer,
    Agent.defaultLayer,
    Auth.defaultLayer,
    Command.defaultLayer,
    Config.defaultLayer,
    File.defaultLayer,
    Format.defaultLayer,
    LSP.defaultLayer,
    Installation.defaultLayer,
    MCP.defaultLayer,
    Permission.defaultLayer,
    Project.defaultLayer,
    ProviderAuth.defaultLayer,
    Provider.defaultLayer,
    Pty.defaultLayer,
    Question.defaultLayer,
    Ripgrep.defaultLayer,
    Session.defaultLayer,
    SessionRunState.defaultLayer,
    SessionStatus.defaultLayer,
    SessionSummary.defaultLayer,
    Skill.defaultLayer,
    Todo.defaultLayer,
    ToolRegistry.defaultLayer,
    Vcs.defaultLayer,
    Worktree.defaultLayer,
    Bus.layer,
    HttpServer.layerServices,
  ]),
  Layer.provideMerge(Observability.layer),
)

export const webHandler = lazy(() =>
  HttpRouter.toWebHandler(routes, {
    memoMap,
    middleware: disposeMiddleware,
  }),
)

export * as ExperimentalHttpApiServer from "./server"
