import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/effect"
import type { Database } from "@opencode-ai/core/database/database"
import type { ModelsDev } from "@opencode-ai/core/models-dev"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import { Workspace } from "@opencode-ai/core/workspace"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { createEmbeddedRoutes } from "@opencode-ai/server/routes"
import type { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Config, Context, Effect, Layer, ManagedRuntime, Scope } from "effect"
import { FetchHttpClient, HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from "effect/unstable/http"
import * as Logging from "./logging"

export type { LogEntry, LogLevel, LogOptions, LogWriter } from "./logging"
import type { LogOptions } from "./logging"

export interface CreateOptions {
  readonly app?: {
    readonly name?: string
    readonly version?: string
    readonly channel?: string
  }
  readonly hostname?: string
  readonly port?: number
  readonly password?: string
  readonly simulation?: boolean
  readonly database?: Database.Options
  readonly events?: { readonly persist?: boolean }
  readonly models?: ModelsDev.Options
  readonly config?: {
    readonly directory?: string
    readonly project?: boolean
    readonly file?: string
    readonly content?: string
  }
  readonly windows?: { readonly gitbash?: string }
  readonly fs?: {
    readonly filewatcher?: boolean
    readonly fff?: boolean
  }
  readonly log?: LogOptions
  readonly workspaceProviders?: Readonly<Record<string, WorkspaceDriver.Interface>>
}

/** Host hooks for embedding opencode on a non-default runtime profile (e.g. workerd). */
export interface EmbedOptions {
  readonly overrides?: LayerNode.Replacements
}

export type Interface = Omit<OpenCodeClient, "plugin" | "workspace"> & {
  readonly sessions: OpenCodeClient["session"]
  readonly events: OpenCodeClient["event"]
  readonly workspace: {
    readonly create: (options: { readonly provider: string }) => ReturnType<Workspace.Interface["create"]>
    readonly provision: (options: {
      readonly workspaceID: Workspace.ID
    }) => ReturnType<Workspace.Interface["provision"]>
    readonly destroy: (options: { readonly workspaceID: Workspace.ID }) => ReturnType<Workspace.Interface["destroy"]>
  }
  readonly plugin: SdkPlugins.Interface["register"] & OpenCodeClient["plugin"]
}

export const create: (
  options?: CreateOptions,
  embed?: EmbedOptions,
) => Effect.Effect<Interface, Config.ConfigError | Error, Scope.Scope> = Effect.fn("OpenCode.create")(function* (
  options: CreateOptions = {},
  embed: EmbedOptions = {},
) {
  const { log, workspaceProviders, ...server } = options
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() =>
      ManagedRuntime.make(
        createEmbeddedRoutes(
          {
            ...server,
            app: { ...server.app, name: server.app?.name ?? "sdk" },
            database: { path: ":memory:", ...server.database },
          },
          workspaceProviders
            ? [...(embed.overrides ?? []), [WorkspaceDriver.node, WorkspaceDriver.registryNode(workspaceProviders)]]
            : embed.overrides,
        ).pipe(Layer.provide(HttpServer.layerServices), Layer.provideMerge(Logging.layer(log))),
      ),
    ),
    (runtime) => runtime.disposeEffect,
  )
  const context = yield* runtime.contextEffect
  // Unconditional, as on every runtime: the sweep is a no-op when nothing is
  // suspended (always, for the default in-memory database). Forked so the
  // returned client is never delayed; resumed drains are already logged and
  // durably recorded by the execution layer.
  yield* Effect.forkDetach(Context.get(context, SessionRestart.Service).resumeSuspendedSessions)
  const plugins = Context.get(context, SdkPlugins.Service)
  const workspace = Context.get(context, Workspace.Service)
  const router = Context.get(context, HttpRouter.HttpRouter)
  const handler = HttpEffect.toWebHandlerWith<never, HttpServerRequest.HttpServerRequest | Scope.Scope>(
    Logging.context(context),
  )(router.asHttpEffect())
  const fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init)), {
    preconnect: () => undefined,
  }) satisfies typeof globalThis.fetch
  const client = yield* OpenCode.make({ baseUrl: "http://opencode.local" }).pipe(
    Effect.provide(FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)), Layer.fresh)),
  )
  return {
    ...client,
    sessions: client.session,
    events: client.event,
    workspace: {
      create: ({ provider }: { readonly provider: string }) => workspace.create(provider),
      provision: ({ workspaceID }: { readonly workspaceID: Workspace.ID }) => workspace.provision(workspaceID),
      destroy: ({ workspaceID }: { readonly workspaceID: Workspace.ID }) => workspace.destroy(workspaceID),
    },
    // The embedded host contributes plugins through the ordinary discovery flow:
    // each plugin's `effect` runs inside every Location with the real
    // `PluginContext`, so `ctx.agent.transform` and every other hook behave exactly
    // as they do for a config-discovered plugin. Define agent profiles here at
    // startup, then select one per Session with `sessions.create({ agent })`.
    plugin: Object.assign(plugins.register, client.plugin),
  }
})

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/sdk/OpenCode") {}

export const layer = (options: CreateOptions = {}): Layer.Layer<Service, Config.ConfigError | Error> =>
  Layer.effect(Service, create(options))
