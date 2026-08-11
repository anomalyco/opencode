import { OpenCode } from "@opencode-ai/client/effect"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { createEmbeddedRoutes } from "@opencode-ai/server/routes"
import type { ServerOptions } from "@opencode-ai/server/options"
import { Context, Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient, HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"

export type CredentialSource = {
  readonly path: string
}

export const Credentials = {
  fromLocalDatabase: (input: Partial<CredentialSource> = {}): CredentialSource => ({
    path: input.path ?? process.env.OPENCODE_DB ?? "opencode.db",
  }),
}

export type CreateOptions = ServerOptions & {
  readonly credentials?: CredentialSource
}

export const create = Effect.fn("OpenCode.create")(function* (options: CreateOptions = {}) {
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() =>
      ManagedRuntime.make(
        createEmbeddedRoutes({
          ...options,
          app: { ...options.app, name: options.app?.name ?? "sdk" },
          database: { path: ":memory:", ...options.database },
        }).pipe(Layer.provide(HttpServer.layerServices)),
      ),
    ),
    (runtime) => runtime.disposeEffect,
  )
  const context = yield* runtime.contextEffect
  if (options.credentials) {
    const database = Context.get(context, Database.Service)
    yield* Credential.importFromDatabase(options.credentials).pipe(Effect.provideService(Database.Service, database))
  }
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
