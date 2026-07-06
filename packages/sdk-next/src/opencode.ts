import { OpenCode } from "@opencode-ai/client/effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { Project } from "@opencode-ai/core/project"
import { createEmbeddedRoutes } from "@opencode-ai/server/routes"
import { Context, Effect, Layer, Scope } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http"

export const create = Effect.fn("OpenCode.create")(function* () {
  const scope = yield* Scope.Scope
  const memoMap = yield* Layer.makeMemoMap
  const sdkPlugins = SdkPlugins.makeStore()
  const context = yield* Layer.buildWithMemoMap(
    AppNodeBuilder.build(LayerNode.group([EventV2.node, PermissionSaved.node, Project.node, SdkPlugins.node]), [
      [SdkPlugins.node, SdkPlugins.layerWithStore(sdkPlugins)],
    ]),
    memoMap,
    scope,
  )
  const plugins = Context.get(context, SdkPlugins.Service)
  const permissions = Context.get(context, PermissionSaved.Service)
  const project = Context.get(context, Project.Service)
  const web = yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        createEmbeddedRoutes(sdkPlugins).pipe(
          HttpRouter.provideRequest(Layer.succeed(PermissionSaved.Service, permissions)),
          HttpRouter.provideRequest(Layer.succeed(Project.Service, project)),
          Layer.provide(HttpServer.layerServices),
        ),
        { disableLogger: true, memoMap },
      ),
    ),
    (web) => Effect.promise(web.dispose),
  )
  const fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => web.handler(new Request(input, init)), {
    preconnect: () => undefined,
  }) satisfies typeof globalThis.fetch
  const client = yield* OpenCode.make({ baseUrl: "http://opencode.local" }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
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
