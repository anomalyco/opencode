import { OpenCode } from "@opencode-ai/client/effect"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { createEmbeddedRoutes } from "@opencode-ai/server/routes"
import { Context, Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient, HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"

export const create = Effect.fn("OpenCode.create")(function* () {
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() => ManagedRuntime.make(createEmbeddedRoutes().pipe(Layer.provide(HttpServer.layerServices)))),
    (runtime) => runtime.disposeEffect,
  )
  const context = yield* runtime.contextEffect
  const plugins = Context.get(context, SdkPlugins.Service)
  const router = Context.get(context, HttpRouter.HttpRouter)
  const handler = HttpEffect.toWebHandler(router.asHttpEffect())
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
