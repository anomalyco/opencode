export * as EmbeddedHost from "./host"

import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import { Workspace } from "@opencode-ai/core/workspace"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { createEmbeddedRoutes } from "@opencode-ai/server/routes"
import type { ServerOptions } from "@opencode-ai/server/options"
import type { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Context, Effect, Layer, ManagedRuntime, Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from "effect/unstable/http"
import { context, layer, type LogOptions } from "../logging"
import { OwnedFetch } from "./fetch"
import { SdkInstances } from "./instances"

export interface CreateOptions<R = never> extends Omit<ServerOptions, "hostname" | "port" | "password"> {
  readonly log?: LogOptions
  readonly workspaceProviders?: Readonly<Record<string, WorkspaceDriver.Interface>>
  readonly instances?: SdkInstances.Options<R>
}

/** Host hooks for embedding opencode on a non-default runtime profile. */
export interface EmbedOptions {
  readonly overrides?: LayerNode.Replacements
}

export const create = Effect.fn("EmbeddedHost.create")(function* <R = never>(
  options: CreateOptions<R> = {},
  embed: EmbedOptions = {},
) {
  const { log, workspaceProviders, instances, ...server } = options
  const selector = instances ? SdkInstances.provide(instances, yield* Effect.context<R>()) : undefined
  const runtime = ManagedRuntime.make(
    createEmbeddedRoutes(
      {
        ...server,
        app: { ...server.app, name: server.app?.name ?? "sdk" },
        database: { path: ":memory:", ...server.database },
      },
      workspaceProviders
        ? [...(embed.overrides ?? []), WorkspaceDriver.node.replace(WorkspaceDriver.registryNode(workspaceProviders))]
        : embed.overrides,
      selector ? (replacements) => SdkInstances.node(selector, replacements) : undefined,
    ).pipe(Layer.provide(HttpServer.layerServices), Layer.provideMerge(layer(log))),
  )

  return yield* Effect.gen(function* () {
    const services = yield* runtime.contextEffect
    // The sweep is a no-op when nothing is suspended. ManagedRuntime owns the
    // fiber so recovery never delays startup but still stops with the host.
    runtime.runFork(Context.get(services, SessionRestart.Service).resumeSuspendedSessions)
    const handler = HttpEffect.toWebHandlerWith<never, HttpServerRequest.HttpServerRequest | Scope.Scope>(
      context(services),
    )(Context.get(services, HttpRouter.HttpRouter).asHttpEffect())
    const transport = OwnedFetch.make(handler, runtime.dispose)

    return {
      runtime,
      fetch: transport.fetch,
      plugins: Context.get(services, SdkPlugins.Service),
      workspace: Context.get(services, Workspace.Service),
      close: transport.close,
    }
  }).pipe(Effect.onError(() => runtime.disposeEffect))
})

export type Interface = Effect.Success<ReturnType<typeof create>>
