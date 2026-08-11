import { OpenCode } from "@opencode-ai/client/effect"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { createEmbeddedRoutes } from "@opencode-ai/server/routes"
import type { ServerOptions } from "@opencode-ai/server/options"
import { Context, Effect, Layer, ManagedRuntime, Scope } from "effect"
import { FetchHttpClient, HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from "effect/unstable/http"
import * as Logging from "./logging"

export type { LogEntry, LogLevel, LogOptions, LogWriter } from "./logging"
import type { LogOptions } from "./logging"

export type CreateOptions = ServerOptions & {
  readonly log?: LogOptions
}

export const create = Effect.fn("OpenCode.create")(function* (options: CreateOptions = {}) {
  const { log, ...server } = options
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() =>
      ManagedRuntime.make(
        createEmbeddedRoutes({
          ...server,
          app: { ...server.app, name: server.app?.name ?? "sdk" },
          database: { path: ":memory:", ...server.database },
        }).pipe(Layer.provide(HttpServer.layerServices), Layer.provideMerge(Logging.layer(log))),
      ),
    ),
    (runtime) => runtime.disposeEffect,
  )
  const context = yield* runtime.contextEffect
  const plugins = Context.get(context, SdkPlugins.Service)
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
    // The embedded host contributes plugins through the ordinary discovery flow:
    // each plugin's `effect` runs inside every Location with the real
    // `PluginContext`, so `ctx.agent.transform` and every other hook behave exactly
    // as they do for a config-discovered plugin. Define agent profiles here at
    // startup, then select one per Session with `sessions.create({ agent })`.
    plugin: Object.assign(plugins.register, client.plugin),
  }
})

export type Interface = Effect.Success<ReturnType<typeof create>>

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/sdk-next/OpenCode") {}

export const layer = Layer.effect(Service, create())
