export * as EmbeddedHost from "./host"

import { Instance } from "@opencode/core/instance/service"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import type { Plugin } from "@opencode/plugin/effect/plugin"
import { Session } from "@opencode/core/session"
import { Workspace } from "@opencode/core/workspace"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { ServerFetch } from "@opencode/server/fetch"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import type { AppOptions, ServerOptions } from "@opencode/server/options"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Context, Effect, Layer, ManagedRuntime, Scope } from "effect"
import { Base64 } from "effect/encoding"
import { layer, type LogOptions } from "../logging"
import { OwnedFetch } from "./fetch"
import { SdkInstances } from "./instances"

export interface CreateOptions<R = never> extends AppOptions {
  readonly log?: LogOptions
  readonly plugins?: ReadonlyArray<Plugin>
  /**
   * Drivers for remote workspaces, by the provider name `workspace.create` and `workspace.attach` take. Build each with
   * `WorkspaceDriver.make` from `@opencode/sdk/effect`.
   */
  readonly workspaceProviders?: Readonly<Record<string, WorkspaceDriver.Interface>>
  readonly instances?: SdkInstances.Options<R>
  /**
   * @deprecated An HTTP listener option: the embedded host serves no browser, so nothing reads the allowlist but the
   * WebSocket origin checks. Removed in the next minor.
   */
  readonly cors?: ServerOptions["cors"]
  /** @deprecated The server's `OPENCODE_SIMULATE` switch, not an SDK option. Removed in the next minor. */
  readonly simulation?: ServerOptions["simulation"]
}

/** Host hooks for embedding opencode on a non-default runtime profile. */
export interface EmbedOptions {
  readonly overrides?: LayerNode.Replacements
  /** Builds and serves a runtime profile's routes in place of the embedded routes and the host's application options. */
  readonly profile?: Profile
}

type Routes = ReturnType<typeof createEmbeddedRoutes>

/**
 * A runtime profile's own server, such as `ServerWorkerd.routes` and `ServerWorkerd.serve`: the host still adds its
 * instances, plugins and workspace providers, and registers plugins between building and serving.
 */
export interface Profile {
  /** The route layer, with the host's replacements applied after the profile's own. */
  readonly routes: (overrides: LayerNode.Replacements) => Routes
  /** Serves the built context to requests from outside the host. */
  readonly serve: (
    context: Context.Context<Layer.Success<Routes>>,
  ) => Effect.Effect<(request: Request) => Promise<Response>, never, Scope.Scope>
  /** The routes' Basic auth password, which the host's in-process client sends. */
  readonly password?: string
}

export const create = Effect.fn("EmbeddedHost.create")(function* <R = never>(
  options: CreateOptions<R> = {},
  embed: EmbedOptions = {},
) {
  const { log, plugins, workspaceProviders, instances, ...server } = options
  const selector = instances ? SdkInstances.provide(instances, yield* Effect.context<R>()) : undefined
  // The runtime builds on its own root fiber, so the host never inherits the caller's services, clock or trace.
  const overrides = [
    ...(selector ? [Instance.node.replace(SdkInstances.node(selector))] : []),
    ...(embed.overrides ?? []),
    ...(workspaceProviders ? [WorkspaceDriver.node.replace(WorkspaceDriver.registryNode(workspaceProviders))] : []),
  ]
  const routes = embed.profile
    ? embed.profile.routes(overrides)
    : createEmbeddedRoutes(
        {
          ...server,
          app: { ...server.app, name: server.app?.name ?? "sdk" },
          database: { path: ":memory:", ...server.database },
        },
        overrides,
      )
  const runtime = ManagedRuntime.make(
    Layer.effectContext(ServerFetch.build(routes.pipe(Layer.provideMerge(layer(log))))),
  )

  return yield* Effect.gen(function* () {
    const services = yield* runtime.contextEffect
    const sdkPlugins = Context.get(services, SdkPlugins.Service)
    for (const plugin of plugins ?? []) yield* sdkPlugins.register(plugin)
    // On the runtime, like the build, so recovery belongs to the runtime's scope as `runtime.runFork` did and never
    // sees the caller's services.
    const serve = embed.profile ? embed.profile.serve(services) : ServerFetch.serve(services)
    const handler = runtime.runSync(serve.pipe(Effect.provideService(Scope.Scope, runtime.scope)))
    const transport = OwnedFetch.make(handler, runtime.dispose)

    return {
      runtime,
      /** The in-process client's transport, which carries the host's own password like Code Mode's requests do. */
      fetch: withPassword(transport.fetch, embed.profile?.password),
      /** Requests from outside the host, checked like any listener's when a profile serves them. */
      handler: (request: Request) => transport.fetch(request),
      plugins: sdkPlugins,
      sessions: Context.get(services, Session.Service),
      workspace: Context.get(services, Workspace.Service),
      close: transport.close,
    }
  }).pipe(Effect.onError(() => runtime.disposeEffect))
})

export type Interface = Effect.Success<ReturnType<typeof create>>

function withPassword(fetch: typeof globalThis.fetch, password: string | undefined) {
  if (!password) return fetch
  const authorization = `Basic ${Base64.encode(`opencode:${password}`)}`
  return Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      request.headers.set("authorization", authorization)
      return fetch(request)
    },
    { preconnect: () => undefined },
  ) satisfies typeof globalThis.fetch
}
