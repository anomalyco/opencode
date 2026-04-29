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

const instance = HttpRouter.middleware()(
  Effect.gen(function* () {
    return (effect) =>
      Effect.gen(function* () {
        const query = yield* HttpServerRequest.schemaSearchParams(Query)
        const headers = yield* HttpServerRequest.schemaHeaders(Headers)
        const raw = query.directory || headers["x-opencode-directory"] || process.cwd()
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

const controlRoutes = HttpApiBuilder.layer(ControlApi).pipe(Layer.provide(controlHandlers))
const globalRoutes = HttpApiBuilder.layer(GlobalApi).pipe(Layer.provide(globalHandlers))
const instanceApiRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(ConfigApi).pipe(Layer.provide(configHandlers)),
  HttpApiBuilder.layer(ExperimentalApi).pipe(Layer.provide(experimentalHandlers)),
  HttpApiBuilder.layer(FileApi).pipe(Layer.provide(fileHandlers)),
  HttpApiBuilder.layer(InstanceApi).pipe(Layer.provide(instanceHandlers)),
  HttpApiBuilder.layer(McpApi).pipe(Layer.provide(mcpHandlers)),
  HttpApiBuilder.layer(ProjectApi).pipe(Layer.provide(projectHandlers)),
  HttpApiBuilder.layer(PtyApi).pipe(Layer.provide(ptyHandlers)),
  HttpApiBuilder.layer(QuestionApi).pipe(Layer.provide(questionHandlers)),
  HttpApiBuilder.layer(PermissionApi).pipe(Layer.provide(permissionHandlers)),
  HttpApiBuilder.layer(ProviderApi).pipe(Layer.provide(providerHandlers)),
  HttpApiBuilder.layer(SessionApi).pipe(Layer.provide(sessionHandlers)),
  HttpApiBuilder.layer(SyncApi).pipe(Layer.provide(syncHandlers)),
  HttpApiBuilder.layer(TuiApi).pipe(Layer.provide(tuiHandlers)),
  HttpApiBuilder.layer(WorkspaceApi).pipe(Layer.provide(workspaceHandlers)),
)

const instanceRoutes = Layer.mergeAll(eventRoute, ptyConnectRoute, instanceApiRoutes).pipe(
  Layer.provide(authorizationLayer),
  Layer.provide(instance),
)

export const routes = Layer.mergeAll(controlRoutes, globalRoutes, instanceRoutes)
  .pipe(
    Layer.provide(Account.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(File.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(Installation.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(Project.defaultLayer),
    Layer.provide(ProviderAuth.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Pty.defaultLayer),
    Layer.provide(Question.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Session.defaultLayer),
  )
  .pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(Skill.defaultLayer),
    Layer.provide(Todo.defaultLayer),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(Vcs.defaultLayer),
    Layer.provide(Worktree.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(HttpServer.layerServices),
    Layer.provideMerge(Observability.layer),
  )

export const webHandler = lazy(() =>
  HttpRouter.toWebHandler(routes, {
    memoMap,
    middleware: disposeMiddleware,
  }),
)

export * as ExperimentalHttpApiServer from "./server"
