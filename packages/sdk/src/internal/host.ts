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
import { layer, type LogOptions } from "../logging"
import { OwnedFetch } from "./fetch"
import { SdkInstances } from "./instances"

export interface CreateOptions<R = never> extends AppOptions {
  readonly log?: LogOptions
  readonly plugins?: ReadonlyArray<Plugin>
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
}

export const create = Effect.fn("EmbeddedHost.create")(function* <R = never>(
  options: CreateOptions<R> = {},
  embed: EmbedOptions = {},
) {
  const { log, plugins, workspaceProviders, instances, ...server } = options
  const selector = instances ? SdkInstances.provide(instances, yield* Effect.context<R>()) : undefined
  // The runtime builds on its own root fiber, so the host never inherits the caller's services, clock or trace.
  const runtime = ManagedRuntime.make(
    Layer.effectContext(
      ServerFetch.build(
        createEmbeddedRoutes(
          {
            ...server,
            app: { ...server.app, name: server.app?.name ?? "sdk" },
            database: { path: ":memory:", ...server.database },
          },
          [
            ...(selector ? [Instance.node.replace(SdkInstances.node(selector))] : []),
            ...(embed.overrides ?? []),
            ...(workspaceProviders
              ? [WorkspaceDriver.node.replace(WorkspaceDriver.registryNode(workspaceProviders))]
              : []),
          ],
        ).pipe(Layer.provideMerge(layer(log))),
      ),
    ),
  )

  return yield* Effect.gen(function* () {
    const services = yield* runtime.contextEffect
    const sdkPlugins = Context.get(services, SdkPlugins.Service)
    for (const plugin of plugins ?? []) yield* sdkPlugins.register(plugin)
    // On the runtime, like the build, so recovery belongs to the runtime's scope as `runtime.runFork` did and never
    // sees the caller's services.
    const handler = runtime.runSync(ServerFetch.serve(services).pipe(Effect.provideService(Scope.Scope, runtime.scope)))
    const transport = OwnedFetch.make(handler, runtime.dispose)

    return {
      runtime,
      fetch: transport.fetch,
      plugins: sdkPlugins,
      sessions: Context.get(services, Session.Service),
      workspace: Context.get(services, Workspace.Service),
      close: transport.close,
    }
  }).pipe(Effect.onError(() => runtime.disposeEffect))
})

export type Interface = Effect.Success<ReturnType<typeof create>>
