export * as EmbeddedHost from "./host"

import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { Session } from "@opencode/core/session"
import { Workspace } from "@opencode/core/workspace"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { isAllowedCorsOrigin } from "@opencode/server/cors"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import type { ServerOptions } from "@opencode/server/options"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Context, Effect, Layer, ManagedRuntime, Scope } from "effect"
import { HttpEffect, HttpMiddleware, HttpRouter, HttpServer, HttpServerRequest } from "effect/unstable/http"
import { context, layer, type LogOptions } from "../logging"
import { OwnedFetch } from "./fetch"
import { SdkInstances } from "./instances"

/**
 * `password` requires Basic auth on `http`, as `opencode serve` does; in-process SDK calls are authorized
 * automatically.
 */
export interface CreateOptions<R = never> extends Omit<ServerOptions, "hostname" | "port"> {
  readonly log?: LogOptions
  readonly workspaceProviders?: Readonly<Record<string, WorkspaceDriver.Interface>>
  readonly instances?: SdkInstances.Options<R>
  /**
   * Addresses where the embedder serves `http`, reported by `/api/info` and used for pairing links. Read on
   * every request, so addresses known only after startup are reported once they exist.
   */
  readonly urls?: () => ReadonlyArray<string>
}

/** Host hooks for embedding opencode on a non-default runtime profile. */
export interface EmbedOptions {
  readonly overrides?: LayerNode.Replacements
}

export const create = Effect.fn("EmbeddedHost.create")(function* <R = never>(
  options: CreateOptions<R> = {},
  embed: EmbedOptions = {},
) {
  const { log, workspaceProviders, instances, urls, ...server } = options
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
      urls,
    ).pipe(Layer.provide(HttpServer.layerServices), Layer.provideMerge(layer(log))),
  )

  return yield* Effect.gen(function* () {
    const services = yield* runtime.contextEffect
    // The sweep is a no-op when nothing is suspended. ManagedRuntime owns the
    // fiber so recovery never delays startup but still stops with the host.
    runtime.runFork(Context.get(services, SessionRestart.Service).resumeSuspendedSessions)
    const http = Context.get(services, HttpRouter.HttpRouter).asHttpEffect()
    const handler = HttpEffect.toWebHandlerWith<never, HttpServerRequest.HttpServerRequest | Scope.Scope>(
      context(services),
    )(http)
    const authorization = server.password && `Basic ${btoa(`opencode:${server.password}`)}`
    const transport = OwnedFetch.make(
      authorization
        ? (request) => {
            const authorized = new Request(request)
            authorized.headers.set("authorization", authorization)
            return handler(authorized)
          }
        : handler,
      runtime.dispose,
    )

    return {
      runtime,
      http: http.pipe(
        HttpMiddleware.cors({ allowedOrigins: (origin) => isAllowedCorsOrigin(origin, server), maxAge: 86_400 }),
        Effect.provideContext(context(services)),
      ),
      fetch: transport.fetch,
      plugins: Context.get(services, SdkPlugins.Service),
      sessions: Context.get(services, Session.Service),
      workspace: Context.get(services, Workspace.Service),
      close: transport.close,
    }
  }).pipe(Effect.onError(() => runtime.disposeEffect))
})

export type Interface = Effect.Success<ReturnType<typeof create>>
